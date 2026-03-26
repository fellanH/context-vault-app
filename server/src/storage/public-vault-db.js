/**
 * public-vault-db.js -- Public vault database provisioning and routing.
 *
 * Each public vault gets its own Turso database (same pattern as user vaults).
 * The shared (admin) DB stores the mapping: vault slug -> DB URL/token + metadata.
 *
 * Provisioning flow:
 *   1. Curator creates a public vault via POST /api/public/vaults
 *   2. System provisions a dedicated Turso DB via Platform API
 *   3. Store DB URL/token + vault metadata in public_vaults table
 *   4. Initialize vault schema + public-vault-specific columns on new DB
 *   5. Route all consumer/curator calls to that DB
 */

import { createClient } from "@libsql/client/web";
import { queryOne, queryAll, execute } from "./turso.js";
import { VAULT_SCHEMA } from "./turso.js";

// ── Schema for the public_vaults mapping table (lives in shared/admin DB) ──

export const PUBLIC_VAULTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS public_vaults (
    id              TEXT PRIMARY KEY,
    slug            TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    curator_id      TEXT NOT NULL,
    visibility      TEXT DEFAULT 'free',
    domain_tags     TEXT,
    consumer_count  INTEGER DEFAULT 0,
    total_recalls   INTEGER DEFAULT 0,
    vault_db_url    TEXT,
    vault_db_token  TEXT,
    vault_db_name   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_public_vaults_slug ON public_vaults(slug);
  CREATE INDEX IF NOT EXISTS idx_public_vaults_curator ON public_vaults(curator_id);
  CREATE INDEX IF NOT EXISTS idx_public_vaults_visibility ON public_vaults(visibility);
`;

// ── Extra columns for public vault per-DB schema ──

export const PUBLIC_VAULT_EXTRAS = `
  ALTER TABLE vault ADD COLUMN recall_count INTEGER DEFAULT 0;
  ALTER TABLE vault ADD COLUMN distinct_consumers INTEGER DEFAULT 0;
  ALTER TABLE vault ADD COLUMN is_evergreen INTEGER DEFAULT 0;
  ALTER TABLE vault ADD COLUMN status TEXT DEFAULT 'active';
`;

// ── Recall count batching ──
// Buffer recall increments in memory, flush to Turso every 5min or 100 events.

const recallBuffer = new Map(); // key: `${vaultDbUrl}::${entryId}` -> { count, vaultDbUrl, vaultDbToken, entryId }
let recallBufferSize = 0;
let flushTimer = null;

const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FLUSH_THRESHOLD = 100; // flush after 100 buffered events

/**
 * Buffer a recall increment for an entry. Flushes to Turso when threshold or timer fires.
 *
 * @param {object} vault - Public vault row (needs vault_db_url, vault_db_token)
 * @param {string} entryId
 * @param {string|null} consumerFingerprint - Unique consumer identifier for distinct_consumers tracking
 */
export function bufferRecallIncrement(vault, entryId, consumerFingerprint = null) {
  const key = `${vault.vault_db_url}::${entryId}`;
  const existing = recallBuffer.get(key);
  if (existing) {
    existing.count++;
    if (consumerFingerprint) existing.consumers.add(consumerFingerprint);
  } else {
    const consumers = new Set();
    if (consumerFingerprint) consumers.add(consumerFingerprint);
    recallBuffer.set(key, {
      count: 1,
      vaultDbUrl: vault.vault_db_url,
      vaultDbToken: vault.vault_db_token,
      entryId,
      consumers,
    });
  }
  recallBufferSize++;

  if (recallBufferSize >= FLUSH_THRESHOLD) {
    flushRecallBuffer();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => flushRecallBuffer(), FLUSH_INTERVAL_MS);
  }
}

/**
 * Flush all buffered recall increments to Turso.
 * Safe to call multiple times; no-ops if buffer is empty.
 */
export async function flushRecallBuffer() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (recallBuffer.size === 0) return;

  const batch = new Map(recallBuffer);
  recallBuffer.clear();
  recallBufferSize = 0;

  // Group by vault DB URL to batch per-DB
  const byDb = new Map();
  for (const entry of batch.values()) {
    const dbKey = entry.vaultDbUrl;
    if (!byDb.has(dbKey)) {
      byDb.set(dbKey, { url: entry.vaultDbUrl, token: entry.vaultDbToken, entries: [] });
    }
    byDb.get(dbKey).entries.push(entry);
  }

  for (const { url, token, entries } of byDb.values()) {
    try {
      const client = getPublicVaultClient(url, token);
      for (const entry of entries) {
        await client.execute({
          sql: "UPDATE vault SET recall_count = recall_count + ?, distinct_consumers = distinct_consumers + ? WHERE id = ?",
          args: [entry.count, entry.consumers.size, entry.entryId],
        });
      }
    } catch (err) {
      console.error(`[public-vault-db] Recall flush error for ${url}: ${err.message}`);
      // Re-buffer failed entries so they aren't lost
      for (const entry of entries) {
        const key = `${entry.vaultDbUrl}::${entry.entryId}`;
        const existing = recallBuffer.get(key);
        if (existing) {
          existing.count += entry.count;
          for (const c of entry.consumers) existing.consumers.add(c);
        } else {
          recallBuffer.set(key, entry);
        }
        recallBufferSize += entry.count;
      }
    }
  }
}

// ── Stale entry auto-hide ──

/**
 * Hide stale entries: status='hidden' for entries with 0 recalls after 180 days.
 * Entries marked as evergreen are excluded.
 *
 * @param {import("@libsql/client").Client} vaultDb - Per-vault DB client
 * @returns {Promise<number>} Number of entries hidden
 */
export async function hideStaleEntries(vaultDb) {
  const result = await vaultDb.execute({
    sql: `UPDATE vault SET status = 'hidden', updated_at = datetime('now')
          WHERE status = 'active'
            AND is_evergreen = 0
            AND (recall_count IS NULL OR recall_count = 0)
            AND created_at < datetime('now', '-180 days')`,
    args: [],
  });
  return result.rowsAffected || 0;
}

// ── In-memory cache for public vault DB clients (per Worker instance) ──

const clientCache = new Map();

/**
 * Get or create a Turso client for a public vault DB.
 * Caches clients in memory for the Worker instance lifetime.
 *
 * @param {string} url - Turso database URL
 * @param {string} authToken - Turso auth token
 * @returns {import("@libsql/client").Client}
 */
function getPublicVaultClient(url, authToken) {
  if (clientCache.has(url)) {
    return clientCache.get(url);
  }
  const client = createClient({ url, authToken });
  clientCache.set(url, client);
  return client;
}

// Track which public vault DBs have been schema-initialized this instance
const initializedDbs = new Set();

/**
 * Ensure the vault schema + public vault extras exist on a public vault DB.
 * Runs once per Worker instance per DB URL.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} url - For dedup tracking
 */
async function ensurePublicVaultSchema(client, url) {
  if (initializedDbs.has(url)) return;
  await client.executeMultiple(VAULT_SCHEMA);
  // Apply public-vault-specific columns (idempotent)
  for (const sql of PUBLIC_VAULT_EXTRAS.split(";").map((s) => s.trim()).filter(Boolean)) {
    try {
      await client.execute(sql);
    } catch (e) {
      if (!e.message?.includes("duplicate column") && !e.message?.includes("already exists")) {
        console.warn(`[public-vault-db] Migration warning: ${e.message}`);
      }
    }
  }
  initializedDbs.add(url);
}

// ── CRUD for public_vaults table (admin DB) ──

/**
 * Look up a public vault by slug.
 *
 * @param {import("@libsql/client").Client} db - Shared/admin DB
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getPublicVaultBySlug(db, slug) {
  return queryOne(db, "SELECT * FROM public_vaults WHERE slug = ?", [slug]);
}

/**
 * Look up a public vault by ID.
 *
 * @param {import("@libsql/client").Client} db
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getPublicVaultById(db, id) {
  return queryOne(db, "SELECT * FROM public_vaults WHERE id = ?", [id]);
}

/**
 * List public vaults with optional filters and pagination.
 *
 * @param {import("@libsql/client").Client} db
 * @param {object} opts
 * @returns {Promise<{vaults: object[], total: number}>}
 */
export async function listPublicVaults(db, opts = {}) {
  const {
    domain = null,
    visibility = null,
    sort = "consumer_count",
    limit = 20,
    offset = 0,
  } = opts;

  const clauses = [];
  const args = [];

  if (domain) {
    clauses.push("domain_tags LIKE ?");
    args.push(`%"${domain}"%`);
  }
  if (visibility) {
    clauses.push("visibility = ?");
    args.push(visibility);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const sortCol = sort === "total_recalls" ? "total_recalls" :
    sort === "created_at" ? "created_at" : "consumer_count";

  const countRow = await queryOne(
    db,
    `SELECT COUNT(*) as c FROM public_vaults ${where}`,
    args,
  );
  const total = Number(countRow?.c ?? 0);

  const rows = await queryAll(
    db,
    `SELECT * FROM public_vaults ${where} ORDER BY ${sortCol} DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );

  return { vaults: rows, total };
}

/**
 * Search public vaults by name, description, or domain tags.
 *
 * @param {import("@libsql/client").Client} db
 * @param {string} query
 * @param {object} opts
 * @returns {Promise<object[]>}
 */
export async function searchPublicVaults(db, query, opts = {}) {
  const { limit = 20, offset = 0 } = opts;
  const pattern = `%${query}%`;
  return queryAll(
    db,
    `SELECT * FROM public_vaults
     WHERE name LIKE ? OR description LIKE ? OR domain_tags LIKE ?
     ORDER BY consumer_count DESC
     LIMIT ? OFFSET ?`,
    [pattern, pattern, pattern, limit, offset],
  );
}

/**
 * Create a public vault record in the admin DB.
 *
 * @param {import("@libsql/client").Client} db
 * @param {object} data
 * @returns {Promise<string>} The vault ID
 */
export async function createPublicVaultRecord(db, data) {
  await execute(
    db,
    `INSERT INTO public_vaults (id, slug, name, description, curator_id, visibility, domain_tags, vault_db_url, vault_db_token, vault_db_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.slug,
      data.name,
      data.description || null,
      data.curatorId,
      data.visibility || "free",
      data.domainTags ? JSON.stringify(data.domainTags) : null,
      data.vaultDbUrl || null,
      data.vaultDbToken || null,
      data.vaultDbName || null,
    ],
  );
  return data.id;
}

/**
 * Update a public vault record.
 *
 * @param {import("@libsql/client").Client} db
 * @param {string} id
 * @param {object} updates
 */
export async function updatePublicVaultRecord(db, id, updates) {
  const sets = [];
  const args = [];

  if (updates.name !== undefined) { sets.push("name = ?"); args.push(updates.name); }
  if (updates.description !== undefined) { sets.push("description = ?"); args.push(updates.description); }
  if (updates.visibility !== undefined) { sets.push("visibility = ?"); args.push(updates.visibility); }
  if (updates.domainTags !== undefined) {
    sets.push("domain_tags = ?");
    args.push(JSON.stringify(updates.domainTags));
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  args.push(id);

  await execute(db, `UPDATE public_vaults SET ${sets.join(", ")} WHERE id = ?`, args);
}

/**
 * Delete a public vault record from the admin DB.
 *
 * @param {import("@libsql/client").Client} db
 * @param {string} id
 */
export async function deletePublicVaultRecord(db, id) {
  await execute(db, "DELETE FROM public_vaults WHERE id = ?", [id]);
}

/**
 * Increment consumer_count on a public vault.
 *
 * @param {import("@libsql/client").Client} db
 * @param {string} id
 */
export async function incrementConsumerCount(db, id) {
  await execute(
    db,
    "UPDATE public_vaults SET consumer_count = consumer_count + 1, updated_at = datetime('now') WHERE id = ?",
    [id],
  );
}

// ── Per-vault DB provisioning ──

/**
 * Provision a new Turso database for a public vault via the Turso Platform API.
 *
 * @param {object} env - Workers env bindings
 * @param {string} slug - Vault slug (used in DB name)
 * @returns {Promise<{url: string, token: string, name: string}>}
 */
export async function provisionPublicVaultDb(env, slug) {
  const apiToken = env.TURSO_API_TOKEN;
  const org = env.TURSO_ORG;
  const group = env.TURSO_GROUP || "default";

  if (!apiToken || !org) {
    throw new Error(
      "TURSO_API_TOKEN and TURSO_ORG secrets required for public vault DB provisioning",
    );
  }

  // Sanitize slug for DB name (alphanumeric + hyphens, max 32 chars)
  const safeSlug = slug.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24);
  const dbName = `cv-pub-${safeSlug}`;

  // 1. Create the database
  const createRes = await fetch(
    `https://api.turso.tech/v1/organizations/${org}/databases`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: dbName, group }),
    },
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    if (createRes.status === 409 || err.includes("already exists")) {
      console.log(`[public-vault-db] DB ${dbName} already exists, reusing`);
    } else {
      throw new Error(`Turso DB creation failed: ${createRes.status} ${err}`);
    }
  }

  // 2. Create an auth token for this database
  const tokenRes = await fetch(
    `https://api.turso.tech/v1/organizations/${org}/databases/${dbName}/auth/tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        permissions: { read_attach: { databases: ["*"] } },
      }),
    },
  );

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Turso token creation failed: ${tokenRes.status} ${err}`);
  }

  const tokenData = await tokenRes.json();
  const dbUrl = `libsql://${dbName}-${org}.turso.io`;
  const dbToken = tokenData.jwt;

  return { url: dbUrl, token: dbToken, name: dbName };
}

/**
 * Resolve a public vault's DB client. Ensures schema is initialized.
 *
 * @param {object} vault - Public vault row from admin DB (must have vault_db_url/vault_db_token)
 * @returns {Promise<import("@libsql/client").Client>}
 */
export async function resolvePublicVaultClient(vault) {
  if (!vault.vault_db_url || !vault.vault_db_token) {
    throw new Error(`Public vault ${vault.slug} has no provisioned database`);
  }

  const client = getPublicVaultClient(vault.vault_db_url, vault.vault_db_token);
  await ensurePublicVaultSchema(client, vault.vault_db_url);
  return client;
}

/**
 * Format a public_vaults row into a clean API response.
 *
 * @param {object} row
 * @returns {object}
 */
export function formatPublicVault(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || null,
    curator_id: row.curator_id,
    visibility: row.visibility,
    domain_tags: row.domain_tags ? JSON.parse(row.domain_tags) : [],
    consumer_count: Number(row.consumer_count || 0),
    total_recalls: Number(row.total_recalls || 0),
    created_at: row.created_at,
    updated_at: row.updated_at || null,
  };
}
