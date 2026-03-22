/**
 * vault-status.js — Lightweight vault status gathering for the hosted server.
 *
 * Replaces the gatherVaultStatus that was in @context-vault/core v2 and
 * moved to @context-vault/local in v3 (not available to the hosted server).
 *
 * Only computes the subset of status data the hosted REST API needs:
 *   - kind counts, category counts
 *   - DB size, stale paths, expired entries
 *   - embedding coverage
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {object} ctx - User context with db, config
 * @param {object} [opts]
 * @returns {object} Status data matching the shape vault-api.js expects
 */
export function gatherVaultStatus(ctx, opts = {}) {
  const { db, config } = ctx;
  const errors = [];

  // File counts (per-user vault dir)
  let fileCount = 0;
  const subdirs = [];
  try {
    if (config.vaultDir && existsSync(config.vaultDir)) {
      for (const d of readdirSync(config.vaultDir, { withFileTypes: true })) {
        if (d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_")) {
          const dir = join(config.vaultDir, d.name);
          try {
            const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
            fileCount += files.length;
            if (files.length > 0) subdirs.push({ name: d.name, count: files.length });
          } catch {}
        }
      }
    }
  } catch (e) {
    errors.push(`File scan failed: ${e.message}`);
  }

  // Kind counts
  let kindCounts = [];
  try {
    kindCounts = db.prepare("SELECT kind, COUNT(*) as c FROM vault GROUP BY kind").all();
  } catch (e) {
    errors.push(`Kind count query failed: ${e.message}`);
  }

  // Category counts
  let categoryCounts = [];
  try {
    categoryCounts = db
      .prepare("SELECT category, COUNT(*) as c FROM vault GROUP BY category")
      .all();
  } catch (e) {
    errors.push(`Category count query failed: ${e.message}`);
  }

  // DB size
  let dbSize = "n/a";
  let dbSizeBytes = 0;
  try {
    if (config.dbPath && existsSync(config.dbPath)) {
      dbSizeBytes = statSync(config.dbPath).size;
      dbSize =
        dbSizeBytes > 1024 * 1024
          ? `${(dbSizeBytes / 1024 / 1024).toFixed(1)}MB`
          : `${(dbSizeBytes / 1024).toFixed(1)}KB`;
    }
  } catch (e) {
    errors.push(`DB size check failed: ${e.message}`);
  }

  // Stale paths
  let stalePaths = false;
  let staleCount = 0;
  try {
    if (config.vaultDir) {
      const result = db
        .prepare("SELECT COUNT(*) as c FROM vault WHERE file_path NOT LIKE ? || '%'")
        .get(config.vaultDir);
      staleCount = result?.c ?? 0;
      stalePaths = staleCount > 0;
    }
  } catch (e) {
    errors.push(`Stale path check failed: ${e.message}`);
  }

  // Expired entries
  let expiredCount = 0;
  try {
    const row = db
      .prepare(
        "SELECT COUNT(*) as c FROM vault WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
      )
      .get();
    expiredCount = row?.c ?? 0;
  } catch (e) {
    errors.push(`Expired count failed: ${e.message}`);
  }

  // Embedding coverage
  let embeddingStatus = null;
  let embedModelAvailable = false;
  try {
    const totalRow = db.prepare("SELECT COUNT(*) as c FROM vault").get();
    const indexedRow = db
      .prepare("SELECT COUNT(*) as c FROM vault WHERE rowid IN (SELECT rowid FROM vault_vec)")
      .get();
    const total = totalRow?.c ?? 0;
    const indexed = indexedRow?.c ?? 0;
    embeddingStatus = { indexed, total, missing: total - indexed };
  } catch (e) {
    errors.push(`Embedding status check failed: ${e.message}`);
  }

  return {
    fileCount,
    subdirs,
    kindCounts,
    categoryCounts,
    dbSize,
    dbSizeBytes,
    stalePaths,
    staleCount,
    expiredCount,
    embeddingStatus,
    embedModelAvailable,
    errors,
  };
}
