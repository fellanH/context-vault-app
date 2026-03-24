/**
 * auth.js — Authentication middleware for Hono (Cloudflare Workers).
 *
 * requireAuth()    — Reads authUser set by better-auth session middleware.
 * bearerAuth()     — API key only via Authorization: Bearer (used by /mcp endpoint).
 * cookieOrBearerAuth() — Session cookie first, API key fallback (used by REST API).
 *
 * In the Workers version, better-auth handles sessions and sets c.get("authUser").
 * The vault-api routes rely on c.get("user") being set by these middlewares.
 */

/** Derive a short, readable operation name from request path + method. */
function deriveOperation(path, method) {
  if (path === "/mcp" || path.startsWith("/mcp?")) return "mcp";
  if (path.includes("/vault/search")) return "vault:search";
  if (path.includes("/vault/export")) return "vault:export";
  if (path.includes("/vault/import")) return "vault:import";
  if (path.includes("/vault/status")) return "vault:status";
  if (path.includes("/vault/entries")) {
    const hasId = /\/vault\/entries\/[^/]+/.test(path);
    if (hasId) {
      if (method === "GET") return "vault:read";
      if (method === "PUT" || method === "PATCH") return "vault:update";
      if (method === "DELETE") return "vault:delete";
    } else {
      if (method === "GET") return "vault:list";
      if (method === "POST") return "vault:create";
    }
  }
  // Fallback: first two path segments
  return path.split("/").filter(Boolean).slice(0, 2).join("/") || "api";
}

/**
 * Minimal auth check for routes protected by better-auth session middleware.
 * Reads c.get("authUser") and normalises it into c.get("user").
 */
export function requireAuth() {
  return async (c, next) => {
    const authUser = c.get("authUser");
    if (!authUser) return c.json({ error: "Unauthorized" }, 401);

    const vaultSecret = c.req.header("X-Vault-Secret");
    const user = {
      userId: authUser.user?.id ?? authUser.id,
      email: authUser.user?.email ?? authUser.email,
      tier: authUser.user?.tier ?? authUser.tier ?? "free",
      scopes: ["*"],
      stripeCustomerId:
        authUser.user?.stripeCustomerId ??
        authUser.stripeCustomerId ??
        null,
    };

    if (vaultSecret && vaultSecret.startsWith("cvs_")) {
      user.clientKeyShare = vaultSecret;
    }

    c.set("user", user);
    await next();
  };
}

/**
 * Validate an API key against the Turso database.
 * Returns the user object or null.
 *
 * @param {import("@libsql/client").Client} db
 * @param {string} token
 */
async function validateApiKeyFromDb(db, token) {
  // better-auth stores API keys hashed; look up by the key prefix for fast lookup
  // then verify. The actual key verification logic depends on how better-auth
  // stores keys. We query for an active key matching the token.
  const result = await db.execute({
    sql: `
      SELECT ak.id as key_id, ak.user_id, ak.name, ak.scopes,
             u.email, u.tier, u.stripe_customer_id
      FROM api_keys ak
      JOIN users u ON u.id = ak.user_id
      WHERE ak.key = ? AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))
        AND ak.enabled = 1
      LIMIT 1
    `,
    args: [token],
  });

  if (!result.rows || result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    userId: row.user_id,
    email: row.email,
    tier: row.tier || "free",
    keyId: row.key_id,
    scopes: row.scopes ? JSON.parse(row.scopes) : ["*"],
    stripeCustomerId: row.stripe_customer_id || null,
  };
}

/**
 * Fire-and-forget: log API key activity to usage_log.
 *
 * @param {import("@libsql/client").Client} db
 * @param {string} userId
 * @param {string} keyId
 * @param {string} operation
 */
async function logKeyActivity(db, userId, keyId, operation) {
  try {
    await db.execute({
      sql: `INSERT INTO usage_log (user_id, api_key_id, operation, status) VALUES (?, ?, ?, 'success')`,
      args: [userId, keyId, operation],
    });
  } catch {
    // Non-critical — never surface to caller
  }
}

/**
 * Hono middleware that requires a valid API key via Authorization: Bearer.
 * Used exclusively by the /mcp endpoint.
 */
export function bearerAuth() {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header || !header.startsWith("Bearer ")) {
      return c.json(
        {
          error:
            "Missing or invalid Authorization header. Use: Bearer cv_...",
        },
        401,
      );
    }

    const token = header.slice(7);
    const db = c.get("ctx")?.db;
    if (!db) return c.json({ error: "Service unavailable" }, 503);

    const user = await validateApiKeyFromDb(db, token);
    if (!user) {
      return c.json({ error: "Invalid or expired API key" }, 401);
    }

    const vaultSecret = c.req.header("X-Vault-Secret");
    if (vaultSecret && vaultSecret.startsWith("cvs_")) {
      user.clientKeyShare = vaultSecret;
    }

    c.set("user", user);

    // Fire-and-forget: log API key activity
    const operation = deriveOperation(c.req.path, c.req.method);
    logKeyActivity(db, user.userId, user.keyId, operation);

    await next();
  };
}

/**
 * Hono middleware for vault API routes.
 * Normalizes both session and API key auth into c.get("authUser") with a
 * consistent shape: { id, email, tier, scopes, keyId? }.
 *
 * Session users get scopes: ["*"]. API key users get their key's scopes.
 * Vault routes read c.get("authUser") directly, so this must set that key.
 */
export function vaultAuth() {
  return async (c, next) => {
    // Skip auth for public endpoints
    const path = c.req.path;
    if (path.endsWith("/openapi.json") || path === "/privacy") {
      return next();
    }

    // 1. Session via better-auth (already set by global session middleware)
    const authUser = c.get("authUser");
    if (authUser) {
      // Normalize: ensure id/scopes/tier are always present
      if (!authUser.scopes) authUser.scopes = ["*"];
      if (!authUser.tier) authUser.tier = "free";
      return next();
    }

    // 2. Bearer API key fallback
    const header = c.req.header("Authorization");
    if (header?.startsWith("Bearer ")) {
      const token = header.slice(7);
      const db = c.get("ctx")?.db;
      if (!db) return c.json({ error: "Service unavailable" }, 503);

      const keyUser = await validateApiKeyFromDb(db, token);
      if (keyUser) {
        // Set authUser in the shape vault routes expect (id, not userId)
        c.set("authUser", {
          id: keyUser.userId,
          email: keyUser.email,
          tier: keyUser.tier,
          scopes: keyUser.scopes,
          keyId: keyUser.keyId,
          stripeCustomerId: keyUser.stripeCustomerId,
        });

        // Fire-and-forget: log API key activity
        const operation = deriveOperation(c.req.path, c.req.method);
        logKeyActivity(db, keyUser.userId, keyUser.keyId, operation);

        return next();
      }
    }

    return c.json({ error: "Unauthorized" }, 401);
  };
}

/**
 * Hono middleware that accepts either a session cookie or a Bearer API key.
 * Cookie is tried first (web app); API key is the fallback (power users / scripts).
 * Used by all REST API routes.
 */
export function cookieOrBearerAuth() {
  return async (c, next) => {
    // ── 1. Session via better-auth (authUser set by session middleware) ───────
    const authUser = c.get("authUser");
    if (authUser) {
      const vaultSecret = c.req.header("X-Vault-Secret");
      const user = {
        userId: authUser.user?.id ?? authUser.id,
        email: authUser.user?.email ?? authUser.email,
        tier: authUser.user?.tier ?? authUser.tier ?? "free",
        scopes: ["*"],
        stripeCustomerId:
          authUser.user?.stripeCustomerId ??
          authUser.stripeCustomerId ??
          null,
      };
      if (vaultSecret && vaultSecret.startsWith("cvs_")) {
        user.clientKeyShare = vaultSecret;
      }
      c.set("user", user);
      return next();
    }

    // ── 2. Bearer API key ────────────────────────────────────────────────────
    const header = c.req.header("Authorization");
    if (header?.startsWith("Bearer ")) {
      const token = header.slice(7);
      const db = c.get("ctx")?.db;
      if (!db) return c.json({ error: "Service unavailable" }, 503);

      const user = await validateApiKeyFromDb(db, token);
      if (user) {
        const vaultSecret = c.req.header("X-Vault-Secret");
        if (vaultSecret && vaultSecret.startsWith("cvs_")) {
          user.clientKeyShare = vaultSecret;
        }
        c.set("user", user);

        // Fire-and-forget: log API key activity
        const operation = deriveOperation(c.req.path, c.req.method);
        logKeyActivity(db, user.userId, user.keyId, operation);

        return next();
      }
    }

    return c.json({ error: "Unauthorized" }, 401);
  };
}
