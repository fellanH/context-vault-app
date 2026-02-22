/**
 * auth.js — Authentication middleware for Hono.
 *
 * bearerAuth()        — API key only (used by /mcp endpoint)
 * cookieOrBearerAuth() — Session cookie first, API key fallback (used by REST API)
 */

import { getCookie } from "hono/cookie";
import {
  validateApiKey,
  prepareMetaStatements,
  getMetaDb,
} from "../auth/meta-db.js";
import { verifySessionToken } from "../auth/session.js";

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
 * Hono middleware that requires a valid API key via Authorization: Bearer.
 * Used exclusively by the /mcp endpoint.
 */
export function bearerAuth() {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header || !header.startsWith("Bearer ")) {
      return c.json(
        {
          error: "Missing or invalid Authorization header. Use: Bearer cv_...",
        },
        401,
      );
    }

    const token = header.slice(7);
    const user = validateApiKey(token);
    if (!user) {
      return c.json({ error: "Invalid or expired API key" }, 401);
    }

    // Extract optional encryption secret for split-authority decryption
    const vaultSecret = c.req.header("X-Vault-Secret");
    if (vaultSecret && vaultSecret.startsWith("cvs_")) {
      user.clientKeyShare = vaultSecret;
    }

    c.set("user", user);

    // Fire-and-forget: log API key activity
    try {
      const stmts = prepareMetaStatements(getMetaDb());
      const operation = deriveOperation(c.req.path, c.req.method);
      stmts.logKeyActivity.run(user.userId, user.keyId, operation, "success");
    } catch {}

    await next();
  };
}

/**
 * Hono middleware that accepts either a session cookie or a Bearer API key.
 * Cookie is tried first (web app); API key is the fallback (power users / scripts).
 * Used by all REST API routes.
 */
export function cookieOrBearerAuth() {
  return async (c, next) => {
    // ── 1. Session cookie ────────────────────────────────────────────────────
    const sessionToken = getCookie(c, "cv_session");
    if (sessionToken) {
      const payload = await verifySessionToken(sessionToken);
      if (payload?.sub) {
        const stmts = prepareMetaStatements(getMetaDb());
        const row = stmts.getUserById.get(payload.sub);
        if (row) {
          const user = {
            userId: row.id,
            email: row.email,
            tier: row.tier,
            scopes: ["*"],
            stripeCustomerId: row.stripe_customer_id || null,
          };
          const vaultSecret = c.req.header("X-Vault-Secret");
          if (vaultSecret && vaultSecret.startsWith("cvs_")) {
            user.clientKeyShare = vaultSecret;
          }
          c.set("user", user);
          return next();
        }
      }
    }

    // ── 2. Bearer API key ────────────────────────────────────────────────────
    const header = c.req.header("Authorization");
    if (header?.startsWith("Bearer ")) {
      const user = validateApiKey(header.slice(7));
      if (user) {
        const vaultSecret = c.req.header("X-Vault-Secret");
        if (vaultSecret && vaultSecret.startsWith("cvs_")) {
          user.clientKeyShare = vaultSecret;
        }
        c.set("user", user);

        // Fire-and-forget: log API key activity
        try {
          const stmts = prepareMetaStatements(getMetaDb());
          const operation = deriveOperation(c.req.path, c.req.method);
          stmts.logKeyActivity.run(
            user.userId,
            user.keyId,
            operation,
            "success",
          );
        } catch {}

        return next();
      }
    }

    return c.json({ error: "Unauthorized" }, 401);
  };
}
