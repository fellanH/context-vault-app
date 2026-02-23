/**
 * rate-limit.js — Tier-based rate limiting and usage metering.
 *
 * Free tier: 100 searches/day, 500 entries max.
 * Pro tier: Unlimited.
 *
 * Note: We cannot read the request body here (it would consume it before
 * the MCP transport can read it). Instead, we do a simple per-request
 * rate limit based on the endpoint, and log usage after the response.
 */

import { prepareMetaStatements, getMetaDb } from "../auth/meta-db.js";
import { getTierLimits } from "../billing/stripe.js";
import { checkAndSendUsageAlerts } from "../email/usage-alerts.js";

/**
 * Hono middleware that enforces tier-based rate limits.
 * Must run after bearerAuth() so c.get("user") is available.
 */
export function rateLimit() {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const limits = getTierLimits(user.tier);
    const stmts = prepareMetaStatements(getMetaDb());

    // Check daily request limit for free tier
    if (limits.requestsPerDay !== Infinity) {
      const count = stmts.countUsageToday.get(user.userId, "mcp_request");
      const remaining = Math.max(0, limits.requestsPerDay - count.c);

      if (count.c >= limits.requestsPerDay) {
        const resetDate = new Date();
        resetDate.setUTCHours(24, 0, 0, 0);
        c.header("X-RateLimit-Limit", String(limits.requestsPerDay));
        c.header("X-RateLimit-Remaining", "0");
        c.header(
          "X-RateLimit-Reset",
          String(Math.floor(resetDate.getTime() / 1000)),
        );
        return c.json(
          {
            error: `Daily request limit reached (${limits.requestsPerDay}/day). Upgrade to Pro for unlimited usage.`,
            code: "RATE_LIMIT_EXCEEDED",
          },
          429,
        );
      }

      // Set rate limit headers for successful requests
      const resetDate = new Date();
      resetDate.setUTCHours(24, 0, 0, 0);
      c.header("X-RateLimit-Limit", String(limits.requestsPerDay));
      c.header("X-RateLimit-Remaining", String(remaining - 1));
      c.header(
        "X-RateLimit-Reset",
        String(Math.floor(resetDate.getTime() / 1000)),
      );
    }

    // Log usage (before processing — count the attempt)
    try {
      stmts.logUsage.run(user.userId, "mcp_request");
    } catch {}

    await next();

    // Fire-and-forget: check thresholds and send alert emails if needed.
    // Runs after the response is sent — no latency impact on the API caller.
    if (limits.requestsPerDay !== Infinity && user.email) {
      Promise.resolve().then(async () => {
        try {
          const db = getMetaDb();
          const requestsToday = db
            .prepare(
              `SELECT COUNT(*) as c FROM usage_log WHERE user_id = ? AND operation = 'mcp_request' AND timestamp >= date('now')`,
            )
            .get(user.userId).c;

          // Storage usage requires the user's vault DB — skip if unavailable.
          // The storage alert will be triggered on the next request that has
          // access to userCtx (vault-api routes call checkLimits directly).
          await checkAndSendUsageAlerts({
            userId: user.userId,
            email: user.email,
            tier: user.tier,
            requestsToday,
            storageMbUsed: 0, // storage checked separately in vault-api routes
          });
        } catch {
          // Never let alert errors surface to the caller
        }
      });
    }
  };
}
