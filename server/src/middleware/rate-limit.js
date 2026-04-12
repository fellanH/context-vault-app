/**
 * rate-limit.js — Tier-based rate limiting and usage metering.
 *
 * Free tier: 5,000 requests/day, 1 GB storage.
 * Pro / Team tier: Unlimited requests.
 *
 * Uses Turso (libSQL) via c.get("ctx").db instead of better-sqlite3.
 * All DB calls are async.
 */

import { getTierLimits } from "../billing/stripe.js";
import { checkAndSendUsageAlerts } from "../email/usage-alerts.js";

/**
 * Hono middleware that enforces tier-based rate limits.
 * Must run after auth middleware so c.get("user") is available.
 */
export function rateLimit() {
  return async (c, next) => {
    // Support both auth shapes: c.get("user").userId and c.get("authUser").id
    const rawUser = c.get("user") || c.get("authUser");
    if (!rawUser) return c.json({ error: "Unauthorized" }, 401);

    const user = {
      userId: rawUser.userId || rawUser.id,
      email: rawUser.email,
      tier: rawUser.tier || "free",
    };

    const limits = getTierLimits(user.tier);
    const db = c.get("ctx")?.db;
    if (!db) return c.json({ error: "Service unavailable" }, 503);

    // Check daily request limit for free tier
    if (limits.requestsPerDay !== Infinity) {
      const countResult = await db.execute({
        sql: `SELECT COUNT(*) as c FROM usage_log WHERE user_id = ? AND operation = 'mcp_request' AND timestamp >= date('now')`,
        args: [user.userId],
      });
      const count = Number(countResult.rows[0]?.c ?? 0);
      const remaining = Math.max(0, limits.requestsPerDay - count);

      const resetDate = new Date();
      resetDate.setUTCHours(24, 0, 0, 0);
      const resetTs = String(Math.floor(resetDate.getTime() / 1000));

      if (count >= limits.requestsPerDay) {
        c.header("X-RateLimit-Limit", String(limits.requestsPerDay));
        c.header("X-RateLimit-Remaining", "0");
        c.header("X-RateLimit-Reset", resetTs);
        return c.json(
          {
            error: `Daily request limit reached (${limits.requestsPerDay}/day). Upgrade to Pro for unlimited usage.`,
            code: "RATE_LIMIT_EXCEEDED",
          },
          429,
        );
      }

      // Set rate limit headers for successful requests
      c.header("X-RateLimit-Limit", String(limits.requestsPerDay));
      c.header("X-RateLimit-Remaining", String(remaining - 1));
      c.header("X-RateLimit-Reset", resetTs);
    }

    // Log usage (before processing — count the attempt)
    try {
      await db.execute({
        sql: `INSERT INTO usage_log (user_id, operation, status) VALUES (?, 'mcp_request', 'success')`,
        args: [user.userId],
      });
    } catch {}

    await next();

    // Fire-and-forget: check thresholds and send alert emails if needed.
    // Runs after the response is sent — no latency impact on the API caller.
    if (limits.requestsPerDay !== Infinity && user.email) {
      // Use ctx from closure — do not await, intentionally fire-and-forget
      (async () => {
        try {
          const todayResult = await db.execute({
            sql: `SELECT COUNT(*) as c FROM usage_log WHERE user_id = ? AND operation = 'mcp_request' AND timestamp >= date('now')`,
            args: [user.userId],
          });
          const requestsToday = Number(todayResult.rows[0]?.c ?? 0);

          const env = c.env;
          await checkAndSendUsageAlerts(
            {
              userId: user.userId,
              email: user.email,
              tier: user.tier,
              requestsToday,
              storageMbUsed: 0, // storage checked separately in vault-api routes
            },
            db,
            env,
          );
        } catch {
          // Never let alert errors surface to the caller
        }
      })();
    }
  };
}
