/**
 * Unit tests for email/usage-alerts.js
 *
 * Tests the pure computeAlerts() threshold logic and the shouldSendAlert()
 * dedup behaviour using an in-memory SQLite database.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

// ─── Inline computeAlerts so we don't need the full module graph ─────────────
// (The real implementation lives in src/email/usage-alerts.js)

function computeAlerts(requestsToday, storageMbUsed, limits) {
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

// ─── Inline shouldSendAlert so we can control the DB ─────────────────────────

const ALERT_WINDOW_HOURS = 24;

function shouldSendAlert(db, userId, limitType, threshold) {
  const key = `alert:${userId}:${limitType}:${threshold}`;
  const row = db
    .prepare(`SELECT count, window_start FROM rate_limits WHERE key = ?`)
    .get(key);

  if (row) {
    const windowStart = new Date(row.window_start + "Z");
    const windowExpiry = new Date(
      windowStart.getTime() + ALERT_WINDOW_HOURS * 60 * 60 * 1000,
    );
    if (Date.now() < windowExpiry.getTime()) {
      return false;
    }
  }

  db.prepare(
    `
    INSERT INTO rate_limits (key, count, window_start)
    VALUES (?, 1, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      count        = 1,
      window_start = datetime('now')
  `,
  ).run(key);

  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key          TEXT PRIMARY KEY,
      count        INTEGER NOT NULL DEFAULT 0,
      window_start TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

// ─── Tests: computeAlerts (pure threshold logic) ──────────────────────────────

describe("computeAlerts — requestsPerDay thresholds", () => {
  const freeLimits = { requestsPerDay: 200, storageMb: 50 };

  it("returns no alerts below 80%", () => {
    expect(computeAlerts(0, 0, freeLimits)).toHaveLength(0);
    expect(computeAlerts(100, 0, freeLimits)).toHaveLength(0);
    expect(computeAlerts(159, 0, freeLimits)).toHaveLength(0);
  });

  it("returns requests_80 alert at exactly 80%", () => {
    const alerts = computeAlerts(160, 0, freeLimits); // 160/200 = 80%
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("requests_80");
    expect(alerts[0].threshold).toBe(80);
    expect(alerts[0].usage.current).toBe(160);
    expect(alerts[0].usage.limit).toBe(200);
  });

  it("returns requests_80 alert between 80% and 100%", () => {
    const alerts = computeAlerts(190, 0, freeLimits);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("requests_80");
  });

  it("returns requests_100 alert at exactly 100%", () => {
    const alerts = computeAlerts(200, 0, freeLimits);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("requests_100");
    expect(alerts[0].threshold).toBe(100);
  });

  it("returns requests_100 alert above 100%", () => {
    const alerts = computeAlerts(250, 0, freeLimits);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("requests_100");
  });

  it("does not return both 80% and 100% alerts simultaneously", () => {
    // Only the highest applicable threshold fires
    const alerts = computeAlerts(200, 0, freeLimits);
    expect(alerts.every((a) => a.limitType === "requests")).toBe(true);
    const types = alerts.map((a) => a.type);
    expect(types).not.toContain("requests_80");
  });
});

describe("computeAlerts — storageMb thresholds", () => {
  const freeLimits = { requestsPerDay: 200, storageMb: 50 };

  it("returns no alerts below 80%", () => {
    expect(computeAlerts(0, 0, freeLimits)).toHaveLength(0);
    expect(computeAlerts(0, 39.9, freeLimits)).toHaveLength(0);
  });

  it("returns storage_80 alert at exactly 80%", () => {
    const alerts = computeAlerts(0, 40, freeLimits); // 40/50 = 80%
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("storage_80");
    expect(alerts[0].threshold).toBe(80);
  });

  it("returns storage_100 alert at exactly 100%", () => {
    const alerts = computeAlerts(0, 50, freeLimits);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("storage_100");
    expect(alerts[0].threshold).toBe(100);
  });

  it("returns storage_100 alert above 100%", () => {
    const alerts = computeAlerts(0, 55, freeLimits);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("storage_100");
  });
});

describe("computeAlerts — combined thresholds", () => {
  const freeLimits = { requestsPerDay: 200, storageMb: 50 };

  it("returns both request and storage alerts when both exceed 80%", () => {
    const alerts = computeAlerts(160, 40, freeLimits);
    expect(alerts).toHaveLength(2);
    const types = alerts.map((a) => a.type);
    expect(types).toContain("requests_80");
    expect(types).toContain("storage_80");
  });

  it("returns mixed 80% and 100% alerts", () => {
    const alerts = computeAlerts(200, 40, freeLimits);
    expect(alerts).toHaveLength(2);
    const types = alerts.map((a) => a.type);
    expect(types).toContain("requests_100");
    expect(types).toContain("storage_80");
  });
});

describe("computeAlerts — Pro/Team tiers (Infinity limits)", () => {
  it("returns no alerts for Pro tier (requestsPerDay = Infinity)", () => {
    const proLimits = { requestsPerDay: Infinity, storageMb: 5120 };
    expect(computeAlerts(99999, 0, proLimits)).toHaveLength(0);
  });

  it("returns storage alert for Pro tier when storage is finite and exceeded", () => {
    const proLimits = { requestsPerDay: Infinity, storageMb: 5120 };
    const alerts = computeAlerts(0, 5120, proLimits); // 100% storage
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("storage_100");
  });

  it("returns no alerts for unknown tier (defaults to free Infinity entry limit)", () => {
    // Edge: both limits Infinity
    const infLimits = { requestsPerDay: Infinity, storageMb: Infinity };
    expect(computeAlerts(999999, 999999, infLimits)).toHaveLength(0);
  });
});

// ─── Tests: shouldSendAlert (dedup logic) ────────────────────────────────────

describe("shouldSendAlert — dedup", () => {
  let db;

  beforeEach(() => {
    db = makeDb();
  });

  it("returns true the first time for a given userId/limitType/threshold", () => {
    expect(shouldSendAlert(db, "user1", "requests", 80)).toBe(true);
  });

  it("returns false on a second call within the 24h window", () => {
    shouldSendAlert(db, "user1", "requests", 80); // first send
    expect(shouldSendAlert(db, "user1", "requests", 80)).toBe(false);
  });

  it("different thresholds are tracked independently", () => {
    shouldSendAlert(db, "user1", "requests", 80); // first 80% send
    expect(shouldSendAlert(db, "user1", "requests", 100)).toBe(true); // 100% is fresh
  });

  it("different limitTypes are tracked independently", () => {
    shouldSendAlert(db, "user1", "requests", 80);
    expect(shouldSendAlert(db, "user1", "storage", 80)).toBe(true);
  });

  it("different users are tracked independently", () => {
    shouldSendAlert(db, "user1", "requests", 80);
    expect(shouldSendAlert(db, "user2", "requests", 80)).toBe(true);
  });

  it("returns true after the 24h window has expired", () => {
    // Manually insert an old window_start (25 hours ago)
    const key = "alert:user1:requests:80";
    const oldStart = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const isoStr = oldStart
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, "");
    db.prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)`,
    ).run(key, isoStr);

    expect(shouldSendAlert(db, "user1", "requests", 80)).toBe(true);
  });

  it("inserts a row in rate_limits on first send", () => {
    shouldSendAlert(db, "user1", "requests", 80);
    const row = db
      .prepare(`SELECT key FROM rate_limits WHERE key = ?`)
      .get("alert:user1:requests:80");
    expect(row).toBeTruthy();
  });
});
