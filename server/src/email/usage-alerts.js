/**
 * usage-alerts.js — Email alerts when users approach or hit usage limits.
 *
 * Sends transactional emails via Resend at two thresholds:
 *   - 80% of requestsPerDay used
 *   - 100% of requestsPerDay used (limit hit)
 *   - 80% of storageMb used
 *   - 100% of storageMb used (limit hit)
 *
 * Dedup: no more than 1 alert email per threshold per rolling 24h.
 * Uses the Turso `rate_limits` table with namespaced keys.
 *
 * Cloudflare Workers compatible:
 *   - No process.env — env vars passed as parameters from callers
 *   - No getMetaDb() — Turso client passed as db parameter
 *   - Resend loaded dynamically per invocation (no module-level singleton)
 */

import { getTierLimits } from "../billing/stripe.js";

// ─── Dedup (rate_limits table via Turso) ──────────────────────────────────────

const ALERT_WINDOW_HOURS = 24;

/**
 * Check whether an alert was already sent within the rolling 24h window,
 * and record this send if not.
 *
 * Uses the `rate_limits` table with a namespaced key:
 *   alert:<userId>:<limitType>:<threshold>
 *
 * @param {import("@libsql/client").Client} db - Turso client
 * @param {string} userId
 * @param {"requests"|"storage"} limitType
 * @param {80|100} threshold
 * @returns {Promise<boolean>} true if the alert should be sent (not yet deduped)
 */
async function shouldSendAlert(db, userId, limitType, threshold) {
  const key = `alert:${userId}:${limitType}:${threshold}`;

  const result = await db.execute({
    sql: `SELECT count, window_start FROM rate_limits WHERE key = ?`,
    args: [key],
  });

  const row = result.rows[0] ?? null;

  if (row) {
    // Turso stores datetime('now') as "YYYY-MM-DD HH:MM:SS" in UTC (no Z suffix)
    const windowStart = new Date(row.window_start + "Z");
    const windowExpiry = new Date(
      windowStart.getTime() + ALERT_WINDOW_HOURS * 60 * 60 * 1000,
    );
    if (Date.now() < windowExpiry.getTime()) {
      return false; // Already sent within 24h — deduplicate
    }
  }

  // Record the send, resetting the window
  await db.execute({
    sql: `
      INSERT INTO rate_limits (key, count, window_start)
      VALUES (?, 1, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        count        = 1,
        window_start = datetime('now')
    `,
    args: [key],
  });

  return true;
}

// ─── Email templates ──────────────────────────────────────────────────────────

/**
 * Build the email content for a given alert type.
 *
 * @param {"requests_80"|"requests_100"|"storage_80"|"storage_100"} alertType
 * @param {{ current: number, limit: number }} usage
 * @param {string} billingUrl
 * @returns {{ subject: string, text: string, html: string }}
 */
function buildEmail(alertType, usage, billingUrl) {
  const isRequests = alertType.startsWith("requests");
  const isHit = alertType.includes("100");
  const pct = isHit ? "100%" : "80%";

  const limitLabel = isRequests
    ? `daily requests (${usage.limit}/day)`
    : `storage (${usage.limit} MB)`;

  const usageLabel = isRequests
    ? `${usage.current} of ${usage.limit} requests used today`
    : `${usage.current.toFixed(1)} MB of ${usage.limit} MB used`;

  const subject = isHit
    ? `You've hit your ${isRequests ? "daily request" : "storage"} limit — upgrade to keep going`
    : `You've used ${pct} of your ${isRequests ? "daily request" : "storage"} limit`;

  const headlineText = isHit
    ? `You've reached your ${limitLabel} limit.`
    : `You've used ${pct} of your ${limitLabel} limit.`;

  const bodyText = isHit
    ? `Your account has reached its limit and new requests are being blocked. Upgrade to Pro for unlimited ${isRequests ? "daily requests" : "storage"}.`
    : `You're approaching your limit. Upgrade to Pro to avoid interruptions.`;

  const text = [
    headlineText,
    "",
    usageLabel,
    "",
    bodyText,
    "",
    `Upgrade now: ${billingUrl}`,
    "",
    "--",
    "You're receiving this because you have a free Context Vault account.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 24px;color:#1a1a1a;background:#fff">
  <h2 style="font-size:20px;margin-bottom:8px">${headlineText}</h2>
  <p style="color:#555;margin-top:0">${usageLabel}</p>
  <p>${bodyText}</p>
  <a href="${billingUrl}"
     style="display:inline-block;margin-top:8px;padding:12px 24px;background:#0070f3;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
    Upgrade to Pro
  </a>
  <p style="margin-top:32px;font-size:12px;color:#999">
    You're receiving this because you have a free Context Vault account.
  </p>
</body>
</html>`;

  return { subject, text, html };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check a user's current usage against their tier limits and send alert
 * emails if they've crossed an 80% or 100% threshold for the first time
 * in the past 24 hours.
 *
 * Designed to be called fire-and-forget after each authenticated request.
 * All errors are caught and logged — never throws.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.email
 * @param {string} opts.tier
 * @param {number} opts.requestsToday    - Current count of requests used today
 * @param {number} opts.storageMbUsed    - Current storage in MB
 * @param {import("@libsql/client").Client} db - Turso client
 * @param {object} env - Workers env bindings (RESEND_API_KEY, RESEND_FROM, APP_URL)
 */
export async function checkAndSendUsageAlerts(
  { userId, email, tier, requestsToday, storageMbUsed },
  db,
  env,
) {
  try {
    const limits = getTierLimits(tier);
    const alerts = computeAlerts(requestsToday, storageMbUsed, limits);
    if (alerts.length === 0) return;

    const resendApiKey = env?.RESEND_API_KEY;
    const appUrl = env?.APP_URL || "https://app.context-vault.com";
    const from = env?.RESEND_FROM || "Context Vault <alerts@context-vault.com>";
    const billingUrl = `${appUrl}/settings/billing`;

    if (!resendApiKey) {
      // Resend not configured — log intent for observability
      for (const alert of alerts) {
        if (await shouldSendAlert(db, userId, alert.limitType, alert.threshold)) {
          console.log(
            `[usage-alerts] Would send ${alert.type} alert to ${email} (RESEND_API_KEY not set)`,
          );
        }
      }
      return;
    }

    // Lazily import Resend (dynamic import works in Workers)
    let ResendClass = null;
    try {
      const mod = await import("resend");
      ResendClass = mod.Resend;
    } catch {
      console.error("[usage-alerts] resend package not available");
      return;
    }
    const client = new ResendClass(resendApiKey);

    for (const alert of alerts) {
      if (!(await shouldSendAlert(db, userId, alert.limitType, alert.threshold))) {
        continue; // Already sent within 24h — skip
      }

      const { subject, text, html } = buildEmail(alert.type, alert.usage, billingUrl);

      try {
        await client.emails.send({
          from,
          to: email,
          subject,
          text,
          html,
        });
        console.log(
          `[usage-alerts] Sent ${alert.type} alert to ${email} (user: ${userId})`,
        );
      } catch (err) {
        // Roll back the dedup record so we retry on the next request
        try {
          await db.execute({
            sql: `DELETE FROM rate_limits WHERE key = ?`,
            args: [`alert:${userId}:${alert.limitType}:${alert.threshold}`],
          });
        } catch {}
        console.error(
          `[usage-alerts] Failed to send ${alert.type} alert to ${email}: ${err.message}`,
        );
      }
    }
  } catch (err) {
    console.error(`[usage-alerts] Unexpected error: ${err.message}`);
  }
}

/**
 * Pure threshold computation — exposed for unit testing.
 * Returns which alert types should fire for the given usage/limits.
 *
 * @param {number} requestsToday
 * @param {number} storageMbUsed
 * @param {{ requestsPerDay: number, storageMb: number }} limits
 * @returns {Array<{ type: string, limitType: string, threshold: number, usage: { current: number, limit: number } }>}
 */
export function computeAlerts(requestsToday, storageMbUsed, limits) {
  const alerts = [];

  if (isFinite(limits.requestsPerDay) && limits.requestsPerDay > 0) {
    const pct = requestsToday / limits.requestsPerDay;
    if (pct >= 1.0) {
      alerts.push({
        type: "requests_100",
        limitType: "requests",
        threshold: 100,
        usage: { current: requestsToday, limit: limits.requestsPerDay },
      });
    } else if (pct >= 0.8) {
      alerts.push({
        type: "requests_80",
        limitType: "requests",
        threshold: 80,
        usage: { current: requestsToday, limit: limits.requestsPerDay },
      });
    }
  }

  if (isFinite(limits.storageMb) && limits.storageMb > 0) {
    const pct = storageMbUsed / limits.storageMb;
    if (pct >= 1.0) {
      alerts.push({
        type: "storage_100",
        limitType: "storage",
        threshold: 100,
        usage: { current: storageMbUsed, limit: limits.storageMb },
      });
    } else if (pct >= 0.8) {
      alerts.push({
        type: "storage_80",
        limitType: "storage",
        threshold: 80,
        usage: { current: storageMbUsed, limit: limits.storageMb },
      });
    }
  }

  return alerts;
}
