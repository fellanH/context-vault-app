/**
 * management.js -- Management API routes for Cloudflare Workers + Turso.
 *
 * Covers:
 *   GET  /api/me                  -- User profile (from better-auth session)
 *   GET  /api/billing/usage       -- Usage stats from Turso
 *   POST /api/billing/checkout    -- Stripe checkout session
 *   POST /api/billing/portal      -- Stripe customer portal
 *   POST /api/billing/webhook     -- Stripe webhook receiver
 *   DELETE /api/account           -- Account deletion
 *   GET  /api/vault/export        -- Paginated JSON export
 *
 * Auth, API keys, and organizations are handled by better-auth at /api/auth/*.
 * No filesystem access. No node:crypto. No process.env.
 */

import { Hono } from "hono";
import {
  createCheckoutSession,
  createPortalSession,
  verifyWebhookEvent,
  getStripe,
  getTierLimits,
} from "../billing/stripe.js";
import { queryOne, queryAll, execute } from "../storage/turso.js";

/**
 * Get the authenticated user from the better-auth session.
 * Returns null if not authenticated.
 *
 * @param {import("hono").Context} c
 * @returns {{ id: string, email: string, name: string|null, tier: string, stripeCustomerId: string|null } | null}
 */
function getUser(c) {
  const user = c.get("authUser");
  if (!user) return null;
  return user;
}

/**
 * Create management API routes.
 *
 * @returns {import("hono").Hono}
 */
export function createManagementRoutes() {
  const api = new Hono();

  // ─── User Profile ──────────────────────────────────────────────────────────

  /** Return the authenticated user's profile */
  api.get("/api/me", async (c) => {
    const user = getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    return c.json({
      userId: user.id,
      email: user.email,
      name: user.name || null,
      tier: user.tier || "free",
      createdAt: user.createdAt,
    });
  });

  // ─── Billing Usage ─────────────────────────────────────────────────────────

  /** Return tier limits and current usage stats */
  api.get("/api/billing/usage", async (c) => {
    const user = getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { db } = c.get("ctx");
    const tier = user.tier || "free";
    const limits = getTierLimits(tier);

    const todayRow = await queryOne(
      db,
      `SELECT COUNT(*) as c FROM usage_log
       WHERE user_id = ? AND operation = 'mcp_request'
         AND timestamp >= datetime('now', 'start of day')`,
      [user.id],
    );

    const weekRow = await queryOne(
      db,
      `SELECT COUNT(*) as c FROM usage_log
       WHERE user_id = ? AND operation = 'mcp_request'
         AND timestamp >= datetime('now', '-7 days')`,
      [user.id],
    );

    const entryRow = await queryOne(
      db,
      `SELECT COUNT(*) as c FROM vault WHERE user_id = ?`,
      [user.id],
    );

    const storageRow = await queryOne(
      db,
      `SELECT COALESCE(SUM(
         LENGTH(COALESCE(body,'')) +
         LENGTH(COALESCE(body_encrypted,'')) +
         LENGTH(COALESCE(title,'')) +
         LENGTH(COALESCE(meta,''))
       ), 0) as s FROM vault WHERE user_id = ?`,
      [user.id],
    );

    return c.json({
      tier,
      limits: {
        maxEntries:
          limits.maxEntries === Infinity ? "unlimited" : limits.maxEntries,
        requestsPerDay:
          limits.requestsPerDay === Infinity
            ? "unlimited"
            : limits.requestsPerDay,
        storageMb: limits.storageMb,
        exportEnabled: limits.exportEnabled,
      },
      usage: {
        requestsToday: Number(todayRow?.c ?? 0),
        requestsThisWeek: Number(weekRow?.c ?? 0),
        entriesUsed: Number(entryRow?.c ?? 0),
        storageMb:
          Math.round((Number(storageRow?.s ?? 0) / (1024 * 1024)) * 100) / 100,
      },
    });
  });

  // ─── Billing Checkout ──────────────────────────────────────────────────────

  /** Create a Stripe Checkout session for Pro or Team upgrade */
  api.post("/api/billing/checkout", async (c) => {
    const user = getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json().catch(() => ({}));

    const VALID_PLANS = ["pro_monthly", "pro_annual", "team"];
    const plan = VALID_PLANS.includes(body.plan) ? body.plan : "pro_monthly";
    const tier = user.tier || "free";

    if (plan !== "team" && (tier === "pro" || tier === "team")) {
      return c.json({ error: "Already on a paid tier" }, 400);
    }
    if (plan === "team" && tier === "team") {
      return c.json({ error: "Already on Team tier" }, 400);
    }

    const session = await createCheckoutSession(c.env, {
      userId: user.id,
      email: user.email,
      customerId: user.stripeCustomerId || null,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      plan,
    });

    if (!session) {
      return c.json(
        {
          error:
            "Stripe not configured. Set STRIPE_SECRET_KEY and the relevant STRIPE_PRICE_* variable.",
        },
        503,
      );
    }

    return c.json({ url: session.url, sessionId: session.sessionId });
  });

  // ─── Billing Portal ────────────────────────────────────────────────────────

  /** Create a Stripe Customer Portal session for managing subscriptions */
  api.post("/api/billing/portal", async (c) => {
    const user = getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const stripeCustomerId = user.stripeCustomerId || null;
    if (!stripeCustomerId) {
      return c.json({ error: "No active subscription found" }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const { config } = c.get("ctx");
    const returnUrl =
      body.returnUrl ||
      `${config.appUrl}/settings/billing` ||
      "https://app.context-vault.com/settings/billing";

    const session = await createPortalSession(c.env, {
      customerId: stripeCustomerId,
      returnUrl,
    });

    if (!session) {
      return c.json({ error: "Stripe not configured" }, 503);
    }

    return c.json({ url: session.url });
  });

  // ─── Billing Webhook ───────────────────────────────────────────────────────

  /** Stripe webhook endpoint */
  api.post("/api/billing/webhook", async (c) => {
    const body = await c.req.text();
    const signature = c.req.header("stripe-signature");

    if (!signature) return c.json({ error: "Missing stripe-signature" }, 400);

    const event = await verifyWebhookEvent(c.env, body, signature);
    if (!event) return c.json({ error: "Invalid webhook signature" }, 400);

    const { db } = c.get("ctx");

    // Idempotency gate -- INSERT first; UNIQUE constraint rejects duplicates
    try {
      await execute(
        db,
        `INSERT INTO processed_webhooks (event_id, event_type) VALUES (?, ?)`,
        [event.id, event.type],
      );
    } catch {
      // UNIQUE constraint violation -- already processed
      return c.json({ received: true, duplicate: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const userId = event.data.metadata?.userId;
        const customerId = event.data.customer;
        if (userId) {
          await execute(
            db,
            `UPDATE "user" SET tier = ? WHERE id = ?`,
            ["pro", userId],
          );
          if (customerId) {
            await execute(
              db,
              `UPDATE "user" SET "stripeCustomerId" = ? WHERE id = ?`,
              [customerId, userId],
            );
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const customerId = event.data.customer;
        if (customerId) {
          const userRow = await queryOne(
            db,
            `SELECT id FROM "user" WHERE "stripeCustomerId" = ?`,
            [customerId],
          );
          if (userRow) {
            await execute(
              db,
              `UPDATE "user" SET tier = ? WHERE id = ?`,
              ["free", userRow.id],
            );
          }
        }
        break;
      }
      case "invoice.payment_failed": {
        const customerId = event.data.customer;
        if (customerId) {
          const userRow = await queryOne(
            db,
            `SELECT id FROM "user" WHERE "stripeCustomerId" = ?`,
            [customerId],
          );
          if (userRow) {
            console.warn(
              JSON.stringify({
                level: "warn",
                event: "payment_failed",
                userId: userRow.id,
                ts: new Date().toISOString(),
              }),
            );
          }
        }
        break;
      }
      case "customer.subscription.updated": {
        const customerId = event.data.customer;
        const status = event.data.status;
        if (customerId && (status === "past_due" || status === "unpaid")) {
          const userRow = await queryOne(
            db,
            `SELECT id FROM "user" WHERE "stripeCustomerId" = ?`,
            [customerId],
          );
          if (userRow) {
            console.warn(
              JSON.stringify({
                level: "warn",
                event: "subscription_" + status,
                userId: userRow.id,
                ts: new Date().toISOString(),
              }),
            );
          }
        }
        break;
      }
    }

    // Periodic cleanup of old webhook records (non-critical)
    try {
      await execute(
        db,
        `DELETE FROM processed_webhooks
         WHERE processed_at < datetime('now', '-30 days')`,
      );
    } catch {}

    return c.json({ received: true });
  });

  // ─── Account Deletion ──────────────────────────────────────────────────────

  /** Delete the authenticated user's account and all associated data */
  api.delete("/api/account", async (c) => {
    const user = getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { db } = c.get("ctx");

    // 1. Cancel Stripe subscription if active
    const stripeCustomerId = user.stripeCustomerId || null;
    if (stripeCustomerId) {
      try {
        const s = await getStripe();
        if (s) {
          const subs = await s.subscriptions.list({
            customer: stripeCustomerId,
            status: "active",
          });
          for (const sub of subs.data) {
            await s.subscriptions.cancel(sub.id);
          }
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            context: "account_deletion_stripe",
            userId: user.id,
            error: err.message,
            ts: new Date().toISOString(),
          }),
        );
        // Continue with deletion even if Stripe cancellation fails
      }
    }

    // 2. Delete vault entries from Turso
    try {
      await execute(db, `DELETE FROM vault WHERE user_id = ?`, [user.id]);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          context: "account_deletion_vault",
          userId: user.id,
          error: err.message,
          ts: new Date().toISOString(),
        }),
      );
      return c.json({ error: "Failed to delete vault data" }, 500);
    }

    // 3. Delete usage logs
    try {
      await execute(db, `DELETE FROM usage_log WHERE user_id = ?`, [user.id]);
    } catch {}

    // 4. Delete the user record (better-auth manages the user table)
    try {
      await execute(db, `DELETE FROM "user" WHERE id = ?`, [user.id]);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          context: "account_deletion_user",
          userId: user.id,
          error: err.message,
          ts: new Date().toISOString(),
        }),
      );
      return c.json({ error: "Failed to delete user account" }, 500);
    }

    return c.json({ deleted: true });
  });

  // ─── Vault Export ──────────────────────────────────────────────────────────

  /**
   * Export vault entries as paginated JSON.
   * Supports ?kind=, ?category=, ?since=, ?until=, ?limit=N&offset=N
   */
  api.get("/api/vault/export", async (c) => {
    const user = getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const tier = user.tier || "free";
    const limits = getTierLimits(tier);
    if (!limits.exportEnabled) {
      return c.json(
        { error: "Export is not available on the free tier. Upgrade to Pro." },
        403,
      );
    }

    const { db } = c.get("ctx");

    // Pagination params
    const rawLimit = c.req.query("limit");
    const rawOffset = c.req.query("offset");
    const paginated = rawLimit != null || rawOffset != null;
    const limit = Math.max(1, Math.min(parseInt(rawLimit, 10) || 100, 1000));
    const offset = Math.max(0, parseInt(rawOffset, 10) || 0);

    // Filter params
    const filterKind = c.req.query("kind") || null;
    const filterCategory = c.req.query("category") || null;
    const filterSince = c.req.query("since") || null;
    const filterUntil = c.req.query("until") || null;

    const conditions = ["user_id = ?"];
    const baseArgs = [user.id];

    if (filterKind) {
      conditions.push("kind = ?");
      baseArgs.push(filterKind);
    } else if (filterCategory) {
      const categoryKinds = {
        knowledge: ["insight", "decision", "pattern", "reference"],
        entity: ["project", "contact", "tool"],
        event: ["session", "log"],
      };
      const kinds = categoryKinds[filterCategory];
      if (kinds) {
        conditions.push(`kind IN (${kinds.map(() => "?").join(",")})`);
        baseArgs.push(...kinds);
      }
    }
    if (filterSince) {
      conditions.push("created_at >= ?");
      baseArgs.push(filterSince);
    }
    if (filterUntil) {
      conditions.push("created_at <= ?");
      baseArgs.push(filterUntil);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const selectCols = [
      "id", "kind", "title", "body", "tags", "source",
      "created_at", "identity_key", "expires_at", "meta",
    ].join(", ");

    const totalRow = await queryOne(
      db,
      `SELECT COUNT(*) as c FROM vault ${whereClause}`,
      baseArgs,
    );
    const total = Number(totalRow?.c ?? 0);

    let rows;
    if (paginated) {
      rows = await queryAll(
        db,
        `SELECT ${selectCols} FROM vault ${whereClause}
         ORDER BY created_at ASC LIMIT ? OFFSET ?`,
        [...baseArgs, limit, offset],
      );
    } else {
      rows = await queryAll(
        db,
        `SELECT ${selectCols} FROM vault ${whereClause}
         ORDER BY created_at ASC`,
        baseArgs,
      );
    }

    const entries = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title || null,
      body: row.body,
      tags: row.tags ? JSON.parse(row.tags) : [],
      source: row.source || null,
      created_at: row.created_at,
      identity_key: row.identity_key || null,
      expires_at: row.expires_at || null,
      meta: row.meta
        ? typeof row.meta === "string"
          ? JSON.parse(row.meta)
          : row.meta
        : {},
    }));

    const response = { entries, total };
    if (paginated) {
      response.limit = limit;
      response.offset = offset;
      response.hasMore = offset + entries.length < total;
    }

    return c.json(response);
  });

  return api;
}
