/**
 * vault-db.js -- Middleware that routes vault API requests to per-user databases.
 *
 * After vaultAuth() sets the authenticated user, this middleware resolves
 * the user's dedicated vault DB and replaces ctx.db for the request.
 *
 * Graceful fallback: if per-user DBs are not configured (no TURSO_API_TOKEN),
 * the shared DB is used with user_id filtering (existing behavior).
 */

import { resolveUserVaultClient } from "../storage/user-vault-db.js";

/**
 * Hono middleware that resolves the user's vault database.
 * Must run after vaultAuth() (requires authUser to be set).
 *
 * If the user has a dedicated vault DB, replaces ctx.db with that client.
 * If not configured or provisioning fails, falls through to shared DB.
 */
export function vaultDbRouting() {
  return async (c, next) => {
    const user = c.get("authUser");
    if (!user?.id) return next(); // No auth, let route handle 401

    const ctx = c.get("ctx");
    if (!ctx?.db) return next();

    try {
      const vaultClient = await resolveUserVaultClient(ctx.db, ctx.env, user.id);

      if (vaultClient) {
        // Replace the DB in context for this request only.
        // The shared DB is still accessible via ctx.sharedDb for cross-user queries.
        const vaultCtx = {
          ...ctx,
          db: vaultClient,
          sharedDb: ctx.db,
          isPerUserVault: true,
        };
        c.set("ctx", vaultCtx);
      }
    } catch (err) {
      // Log but don't fail -- fall back to shared DB
      console.error(
        `[vault-db] Failed to resolve per-user DB for ${user.id}: ${err.message}`,
      );
    }

    await next();
  };
}
