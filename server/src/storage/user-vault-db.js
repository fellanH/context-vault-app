/**
 * user-vault-db.js -- Per-user vault database provisioning and routing.
 *
 * Each user gets their own Turso database for structural isolation.
 * The shared (main) DB stores the mapping: user_id -> vault DB URL/token.
 * Vault API requests are routed to the user's specific DB.
 *
 * Provisioning flow:
 *   1. User signs up or first vault API call
 *   2. Check user_vaults table for existing DB
 *   3. If none, provision via Turso Platform API
 *   4. Store the DB URL/token in user_vaults
 *   5. Initialize vault schema on the new DB
 *   6. Route all subsequent vault calls to that DB
 */

import { createClient } from "@libsql/client/web";
import { queryOne, execute } from "./turso.js";
import { VAULT_SCHEMA } from "./turso.js";

// ── Schema for the user_vaults mapping table (lives in shared DB) ────────

export const USER_VAULTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS user_vaults (
    user_id         TEXT PRIMARY KEY,
    vault_db_url    TEXT NOT NULL,
    vault_db_token  TEXT NOT NULL,
    vault_db_name   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    last_accessed_at TEXT
  );
`;

// ── In-memory cache for vault DB clients (per Worker instance) ──────────

const clientCache = new Map();

/**
 * Get or create a Turso client for a user's vault DB.
 * Caches clients in memory for the Worker instance lifetime.
 *
 * @param {string} url - Turso database URL
 * @param {string} authToken - Turso auth token
 * @returns {import("@libsql/client").Client}
 */
function getVaultClient(url, authToken) {
  const cacheKey = url;
  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey);
  }
  const client = createClient({ url, authToken });
  clientCache.set(cacheKey, client);
  return client;
}

// Track which vault DBs have been schema-initialized this instance
const initializedDbs = new Set();

/**
 * Ensure the vault schema exists on a user's vault DB.
 * Runs once per Worker instance per DB URL.
 *
 * @param {import("@libsql/client").Client} client
 * @param {string} url - For dedup tracking
 */
async function ensureVaultSchema(client, url) {
  if (initializedDbs.has(url)) return;
  await client.executeMultiple(VAULT_SCHEMA);
  initializedDbs.add(url);
}

/**
 * Look up a user's vault DB from the shared database.
 *
 * @param {import("@libsql/client").Client} sharedDb
 * @param {string} userId
 * @returns {Promise<{url: string, token: string} | null>}
 */
export async function getUserVaultDb(sharedDb, userId) {
  const row = await queryOne(
    sharedDb,
    "SELECT vault_db_url, vault_db_token FROM user_vaults WHERE user_id = ?",
    [userId],
  );
  if (!row) return null;

  // Update last_accessed_at (fire-and-forget)
  execute(
    sharedDb,
    "UPDATE user_vaults SET last_accessed_at = datetime('now') WHERE user_id = ?",
    [userId],
  ).catch(() => {});

  return { url: row.vault_db_url, token: row.vault_db_token };
}

/**
 * Register a vault DB for a user in the shared database.
 *
 * @param {import("@libsql/client").Client} sharedDb
 * @param {string} userId
 * @param {string} dbUrl
 * @param {string} dbToken
 * @param {string} [dbName]
 */
export async function registerUserVaultDb(sharedDb, userId, dbUrl, dbToken, dbName) {
  await execute(
    sharedDb,
    `INSERT OR REPLACE INTO user_vaults (user_id, vault_db_url, vault_db_token, vault_db_name)
     VALUES (?, ?, ?, ?)`,
    [userId, dbUrl, dbToken, dbName || null],
  );
}

/**
 * Provision a new Turso database for a user via the Turso Platform API.
 *
 * Requires TURSO_API_TOKEN and TURSO_ORG env vars.
 * Creates a DB named "cv-vault-{userId-prefix}" in the user's group.
 *
 * @param {object} env - Workers env bindings
 * @param {string} userId
 * @returns {Promise<{url: string, token: string, name: string}>}
 */
export async function provisionVaultDb(env, userId) {
  const apiToken = env.TURSO_API_TOKEN;
  const org = env.TURSO_ORG;
  const group = env.TURSO_GROUP || "default";

  if (!apiToken || !org) {
    throw new Error(
      "TURSO_API_TOKEN and TURSO_ORG secrets required for vault DB provisioning",
    );
  }

  // Sanitize userId for DB name (alphanumeric + hyphens, max 32 chars)
  const safeId = userId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20);
  const dbName = `cv-vault-${safeId}`;

  // 1. Create the database
  const createRes = await fetch(
    `https://api.turso.tech/v1/organizations/${org}/databases`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: dbName,
        group,
      }),
    },
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    // If DB already exists, try to use it
    if (createRes.status === 409 || err.includes("already exists")) {
      console.log(`[user-vault-db] DB ${dbName} already exists, reusing`);
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
 * Resolve a user's vault DB client. Provisions if needed.
 * Returns a ready-to-use Turso client with vault schema initialized.
 *
 * @param {import("@libsql/client").Client} sharedDb - The shared/main DB
 * @param {object} env - Workers env bindings
 * @param {string} userId
 * @returns {Promise<import("@libsql/client").Client>}
 */
export async function resolveUserVaultClient(sharedDb, env, userId) {
  // 1. Check existing mapping
  let vaultInfo = await getUserVaultDb(sharedDb, userId);

  // 2. Provision if no vault DB exists
  if (!vaultInfo) {
    // Check if Turso Platform API is configured
    if (!env.TURSO_API_TOKEN || !env.TURSO_ORG) {
      // Fallback: use the shared DB (pre-migration behavior)
      // This allows the server to work before per-user DBs are configured
      return null;
    }

    const provisioned = await provisionVaultDb(env, userId);
    await registerUserVaultDb(
      sharedDb,
      userId,
      provisioned.url,
      provisioned.token,
      provisioned.name,
    );
    vaultInfo = { url: provisioned.url, token: provisioned.token };
  }

  // 3. Get cached client and ensure schema
  const client = getVaultClient(vaultInfo.url, vaultInfo.token);
  await ensureVaultSchema(client, vaultInfo.url);

  return client;
}
