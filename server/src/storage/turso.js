/**
 * turso.js -- Turso (libSQL) data layer for the hosted server.
 *
 * Single database for all hosted data: auth tables (managed by better-auth),
 * meta tables (usage, rate limits, webhooks), and per-user vault tables.
 *
 * In the current model, all users share one Turso database with user_id
 * filtering. Per-user databases can be added later via Turso's multi-DB
 * support without changing the query interface.
 */

import { createClient } from "@libsql/client/web";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const META_SCHEMA = `
  CREATE TABLE IF NOT EXISTS usage_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    api_key_id      TEXT,
    operation       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'success',
    timestamp       TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON usage_log(user_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_usage_key_ts ON usage_log(api_key_id, timestamp)
    WHERE api_key_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS processed_webhooks (
    event_id     TEXT PRIMARY KEY,
    event_type   TEXT NOT NULL,
    processed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    key          TEXT PRIMARY KEY,
    count        INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export const VAULT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS vault (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    kind            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'knowledge',
    title           TEXT,
    body            TEXT NOT NULL,
    meta            TEXT,
    tags            TEXT,
    source          TEXT,
    identity_key    TEXT,
    expires_at      TEXT,
    superseded_by   TEXT,
    tier            TEXT DEFAULT 'working' CHECK(tier IN ('ephemeral', 'working', 'durable')),
    related_to      TEXT,
    source_files    TEXT,
    hit_count       INTEGER DEFAULT 0,
    last_accessed_at TEXT,
    team_id         TEXT,
    body_encrypted  BLOB,
    title_encrypted BLOB,
    meta_encrypted  BLOB,
    iv              BLOB,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_vault_user ON vault(user_id);
  CREATE INDEX IF NOT EXISTS idx_vault_team ON vault(team_id) WHERE team_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_vault_kind ON vault(kind);
  CREATE INDEX IF NOT EXISTS idx_vault_category ON vault(category);
  CREATE INDEX IF NOT EXISTS idx_vault_category_created ON vault(category, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_vault_updated ON vault(updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_identity
    ON vault(user_id, kind, identity_key)
    WHERE identity_key IS NOT NULL AND category = 'entity';
  CREATE INDEX IF NOT EXISTS idx_vault_superseded ON vault(superseded_by)
    WHERE superseded_by IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_vault_tier ON vault(tier);

  CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
    title, body, tags, kind,
    content='vault', content_rowid='rowid'
  );

  CREATE TRIGGER IF NOT EXISTS vault_ai AFTER INSERT ON vault BEGIN
    INSERT INTO vault_fts(rowid, title, body, tags, kind)
      VALUES (new.rowid, new.title, new.body, new.tags, new.kind);
  END;
  CREATE TRIGGER IF NOT EXISTS vault_ad AFTER DELETE ON vault BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, title, body, tags, kind)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.kind);
  END;
  CREATE TRIGGER IF NOT EXISTS vault_au AFTER UPDATE ON vault BEGIN
    INSERT INTO vault_fts(vault_fts, rowid, title, body, tags, kind)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags, old.kind);
    INSERT INTO vault_fts(rowid, title, body, tags, kind)
      VALUES (new.rowid, new.title, new.body, new.tags, new.kind);
  END;
`;

export const IMPORT_JOBS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS import_jobs (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK(status IN ('queued', 'processing', 'complete', 'failed')),
    total_entries   INTEGER NOT NULL DEFAULT 0,
    entries_uploaded INTEGER NOT NULL DEFAULT 0,
    entries_embedded INTEGER NOT NULL DEFAULT 0,
    errors          TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    completed_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_import_jobs_user ON import_jobs(user_id, created_at DESC);
`;

// ─── Client ──────────────────────────────────────────────────────────────────

/**
 * Create a libSQL client for the hosted database.
 *
 * @param {string} url - Turso database URL (libsql://...)
 * @param {string} authToken - Turso auth token
 * @returns {import("@libsql/client").Client}
 */
export function createTursoClient(url, authToken) {
  return createClient({ url, authToken });
}

/**
 * Initialize schemas (idempotent). Call once on first request.
 *
 * @param {import("@libsql/client").Client} client
 */
export async function initSchemas(client) {
  await client.executeMultiple(META_SCHEMA);
  await client.executeMultiple(VAULT_SCHEMA);

  // Migrations: add columns that CREATE TABLE IF NOT EXISTS won't add
  // to existing tables. Each is idempotent (catches "duplicate column" errors).
  const migrations = [
    `ALTER TABLE vault ADD COLUMN team_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_vault_team ON vault(team_id) WHERE team_id IS NOT NULL`,
    `ALTER TABLE vault ADD COLUMN content_hash TEXT`,
    `ALTER TABLE vault ADD COLUMN embedded INTEGER DEFAULT 1`,
    `CREATE INDEX IF NOT EXISTS idx_vault_embedded ON vault(embedded) WHERE embedded = 0`,
  ];
  for (const sql of migrations) {
    try {
      await client.execute(sql);
    } catch (e) {
      // Ignore "duplicate column" or "already exists" errors
      if (!e.message?.includes("duplicate column") && !e.message?.includes("already exists")) {
        console.warn(`[turso] Migration warning: ${e.message}`);
      }
    }
  }
}

// ─── Query Helpers ───────────────────────────────────────────────────────────

/**
 * @param {import("@libsql/client").Client} db
 * @param {string} sql
 * @param {any[]} [args]
 */
export async function queryAll(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows;
}

/**
 * @param {import("@libsql/client").Client} db
 * @param {string} sql
 * @param {any[]} [args]
 */
export async function queryOne(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows[0] || null;
}

/**
 * @param {import("@libsql/client").Client} db
 * @param {string} sql
 * @param {any[]} [args]
 */
export async function execute(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
}
