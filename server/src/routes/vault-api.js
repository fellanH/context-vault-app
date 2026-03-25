/**
 * vault-api.js — REST API routes for vault operations (Cloudflare Workers / Turso).
 *
 * 15 endpoints:
 *   GET    /api/vault/entries          List/browse with filters + pagination
 *   GET    /api/vault/entries/:id      Get single entry by ULID
 *   POST   /api/vault/entries          Create entry
 *   PUT    /api/vault/entries/:id      Partial update (omitted fields preserved)
 *   DELETE /api/vault/entries/:id      Delete entry + vector (no files in Workers)
 *   POST   /api/vault/search           FTS search (vector search: future)
 *   POST   /api/vault/import/bulk      Bulk import entries (up to 500)
 *   POST   /api/vault/import           Single-entry import
 *   POST   /api/vault/import/stream    NDJSON streaming import (async embedding)
 *   POST   /api/vault/ingest           Fetch URL and save as entry
 *   GET    /api/vault/manifest         Lightweight entry list for sync (paginated)
 *   GET    /api/vault/status           Vault diagnostics + usage stats
 *   GET    /api/vault/jobs/:id         Import job status
 *   POST   /api/vault/jobs/:id/process Background embedding processor (self-fetch chain)
 *   GET    /api/vault/openapi.json     OpenAPI spec (unauthenticated)
 *
 * Context is accessed via c.get("ctx") -> { db, r2, ai, config, env }
 * Authenticated user is c.get("authUser") -> { id, email, tier, ... } | null
 */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { queryAll, queryOne, execute } from "../storage/turso.js";
import { ulid, embed, embedBatch } from "../storage/workers-ctx.js";
import { validateEntryInput } from "../validation/entry-validation.js";
import { hasScope } from "../auth/scopes.js";
import { generateOpenApiSpec } from "../api/openapi.js";
import { getTierLimits } from "../billing/stripe.js";

// ─── Inlined constants (formerly @context-vault/core/constants) ──────────────

const MAX_BODY_LENGTH = 102400; // 100 KB
const MAX_TITLE_LENGTH = 500;
const MAX_KIND_LENGTH = 64;
const MAX_TAG_LENGTH = 100;
const MAX_TAGS_COUNT = 20;
const MAX_META_LENGTH = 10240; // 10 KB
const MAX_SOURCE_LENGTH = 200;
const MAX_IDENTITY_KEY_LENGTH = 200;


// ─── Inlined helpers (formerly @context-vault/core) ──────────────────────────

/**
 * Normalize a kind string: lowercase, strip non-alphanumeric/hyphen chars.
 * @param {string} kind
 * @returns {string}
 */
export function normalizeKind(kind) {
  return kind.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

/**
 * Derive the category for a given kind.
 * @param {string} kind
 * @returns {"event"|"entity"|"knowledge"}
 */
export function categoryFor(kind) {
  if (kind === "events" || kind === "session") return "event";
  if (
    kind === "contact" ||
    kind === "project" ||
    kind === "tool" ||
    kind === "source" ||
    kind === "bucket"
  )
    return "entity";
  return "knowledge";
}

/**
 * Check if a user (free tier) has exceeded their entry limit.
 * Pro/team tiers have no entry limit.
 *
 * @param {string} tier
 * @param {number} currentCount
 * @returns {boolean}
 */
function isOverEntryLimit(tier, currentCount) {
  const limits = getTierLimits(tier);
  if (!Number.isFinite(limits.maxEntries)) return false;
  return currentCount >= limits.maxEntries;
}

// ─── Format helpers ───────────────────────────────────────────────────────────

/**
 * Format a Turso row into a clean API entry response.
 * Parses JSON strings for tags/meta and normalizes nulls.
 *
 * @param {object} row
 * @returns {object}
 */
export function formatEntry(row) {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: row.title || null,
    body: row.body || null,
    tags: row.tags ? JSON.parse(row.tags) : [],
    meta: row.meta
      ? typeof row.meta === "string"
        ? JSON.parse(row.meta)
        : row.meta
      : {},
    source: row.source || null,
    identity_key: row.identity_key || null,
    expires_at: row.expires_at || null,
    team_id: row.team_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at || null,
  };
}

// ─── Core DB operations ───────────────────────────────────────────────────────

/**
 * Insert a new vault entry into Turso and optionally generate an embedding.
 * FTS5 triggers on the vault table handle search indexing automatically.
 *
 * @param {object} db - Turso client
 * @param {object} ai - Workers AI binding (may be null)
 * @param {object} data - Entry fields
 * @returns {Promise<string>} The new entry's ID
 */
export async function insertEntry(db, ai, data) {
  const id = ulid();
  const kind = normalizeKind(data.kind);
  const category = categoryFor(kind);
  const tags = data.tags
    ? JSON.stringify(Array.isArray(data.tags) ? data.tags : [])
    : null;
  const meta = data.meta ? JSON.stringify(data.meta) : null;
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  // Compute content hash for sync diffing
  const contentHash = await computeContentHash(
    data.title || "",
    data.body,
    tags || "[]",
    meta || "{}",
  );

  await execute(
    db,
    `INSERT INTO vault
       (id, user_id, team_id, kind, category, title, body, meta, tags, source,
        identity_key, expires_at, content_hash, embedded, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      data.userId,
      data.teamId || null,
      kind,
      category,
      data.title || null,
      data.body,
      meta,
      tags,
      data.source || "rest-api",
      data.identity_key || null,
      data.expires_at || null,
      contentHash,
      now,
      now,
    ],
  );

  // Fire-and-forget embedding generation (non-blocking)
  if (ai && data.body) {
    embed(ai, `${data.title ? data.title + "\n" : ""}${data.body}`).catch(
      () => {},
    );
  }

  return id;
}

/**
 * Update an existing vault entry in Turso.
 * Only fields present in `updates` are changed; omitted fields are preserved.
 *
 * @param {object} db - Turso client
 * @param {object} ai - Workers AI binding (may be null)
 * @param {object} existing - Existing row from DB
 * @param {object} updates - Partial update fields
 * @returns {Promise<void>}
 */
async function updateEntry(db, ai, existing, updates) {
  const fields = [];
  const args = [];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  if (updates.title !== undefined) {
    fields.push("title = ?");
    args.push(updates.title || null);
  }
  if (updates.body !== undefined) {
    fields.push("body = ?");
    args.push(updates.body || null);
  }
  if (updates.tags !== undefined) {
    fields.push("tags = ?");
    args.push(
      updates.tags
        ? JSON.stringify(Array.isArray(updates.tags) ? updates.tags : [])
        : null,
    );
  }
  if (updates.meta !== undefined) {
    // Shallow-merge: merge existing meta with incoming meta
    let merged = {};
    if (existing.meta) {
      try {
        merged =
          typeof existing.meta === "string"
            ? JSON.parse(existing.meta)
            : existing.meta;
      } catch {}
    }
    if (updates.meta && typeof updates.meta === "object") {
      merged = { ...merged, ...updates.meta };
    }
    fields.push("meta = ?");
    args.push(JSON.stringify(merged));
  }
  if (updates.source !== undefined) {
    fields.push("source = ?");
    args.push(updates.source || null);
  }
  if (updates.expires_at !== undefined) {
    fields.push("expires_at = ?");
    args.push(updates.expires_at || null);
  }

  if (fields.length === 0) return;

  fields.push("updated_at = ?");
  args.push(now);
  args.push(existing.id);

  await execute(
    db,
    `UPDATE vault SET ${fields.join(", ")} WHERE id = ?`,
    args,
  );

  // Fire-and-forget re-embedding if body or title changed
  if (ai && (updates.body !== undefined || updates.title !== undefined)) {
    const newBody = updates.body ?? existing.body ?? "";
    const newTitle = updates.title ?? existing.title ?? "";
    embed(ai, `${newTitle ? newTitle + "\n" : ""}${newBody}`).catch(() => {});
  }
}

/**
 * FTS-only search on vault table.
 * Returns rows with a synthetic score based on FTS rank.
 *
 * @param {object} db - Turso client
 * @param {string} userId
 * @param {string} query
 * @param {object} opts
 * @returns {Promise<object[]>}
 */
async function ftsSearch(db, userId, query, opts = {}) {
  const {
    kindFilter = null,
    categoryFilter = null,
    since = null,
    until = null,
    limit = 20,
    offset = 0,
  } = opts;

  // Sanitize query for FTS5: strip special chars that break the parser
  const safeQuery = query.replace(/['"*()]/g, " ").trim();
  if (!safeQuery) return [];

  const clauses = [
    "v.user_id = ?",
    "(v.expires_at IS NULL OR v.expires_at > datetime('now'))",
    "fts.vault_fts MATCH ?",
  ];
  const args = [userId, `"${safeQuery}" OR ${safeQuery}*`];

  if (kindFilter) {
    clauses.push("v.kind = ?");
    args.push(kindFilter);
  }
  if (categoryFilter) {
    clauses.push("v.category = ?");
    args.push(categoryFilter);
  }
  if (since) {
    clauses.push("v.created_at >= ?");
    args.push(since);
  }
  if (until) {
    clauses.push("v.created_at <= ?");
    args.push(until);
  }

  args.push(limit, offset);

  const sql = `
    SELECT v.*, (1.0 / (1.0 + rank)) as score
    FROM vault v
    JOIN vault_fts fts ON fts.rowid = v.rowid
    WHERE ${clauses.join(" AND ")}
    ORDER BY score DESC
    LIMIT ? OFFSET ?
  `;

  return await queryAll(db, sql, args);
}

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * Create vault REST API routes for Cloudflare Workers + Turso.
 * Context is read per-request via c.get("ctx") and c.get("authUser").
 *
 * @returns {Hono}
 */
export function createVaultApiRoutes() {
  const api = new Hono();

  // ─── OpenAPI spec (unauthenticated, public) ─────────────────────────────────

  api.get("/api/vault/openapi.json", (c) => {
    const ctx = c.get("ctx");
    const serverUrl = ctx?.config?.apiUrl || null;
    const spec = generateOpenApiSpec({ version: "2.0.0", serverUrl });
    return c.json(spec);
  });

  // ─── Privacy policy (required for ChatGPT GPT publishing) ───────────────────

  api.get("/privacy", (c) => {
    return c.text(
      "Context Vault Privacy Policy\n\n" +
        "Context Vault stores knowledge entries you explicitly save. " +
        "Data is encrypted at rest (AES-256-GCM) and isolated per user. " +
        "We do not sell, share, or use your data for training. " +
        "You can export or delete all your data at any time via the API.\n\n" +
        "Contact: https://github.com/fellanH/context-vault",
    );
  });

  // ─── GET /api/vault/entries — List/browse with filters + pagination ──────────

  api.get("/api/vault/entries", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");

    const kind = c.req.query("kind") || null;
    const category = c.req.query("category") || null;
    const since = c.req.query("since") || null;
    const until = c.req.query("until") || null;
    const limit = Math.min(
      parseInt(c.req.query("limit") || "20", 10) || 20,
      100,
    );
    const offset = parseInt(c.req.query("offset") || "0", 10) || 0;

    const clauses = [
      "user_id = ?",
      "(expires_at IS NULL OR expires_at > datetime('now'))",
    ];
    const args = [user.id];

    if (kind) {
      clauses.push("kind = ?");
      args.push(normalizeKind(kind));
    }
    if (category) {
      clauses.push("category = ?");
      args.push(category);
    }
    if (since) {
      clauses.push("created_at >= ?");
      args.push(since);
    }
    if (until) {
      clauses.push("created_at <= ?");
      args.push(until);
    }

    const where = `WHERE ${clauses.join(" AND ")}`;

    const countRow = await queryOne(
      db,
      `SELECT COUNT(*) as c FROM vault ${where}`,
      args,
    );
    const total = Number(countRow?.c ?? 0);

    const rows = await queryAll(
      db,
      `SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );

    return c.json({ entries: rows.map(formatEntry), total, limit, offset });
  });

  // ─── GET /api/vault/entries/:id — Get single entry by ULID ──────────────────

  api.get("/api/vault/entries/:id", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");
    const id = c.req.param("id");

    const entry = await queryOne(
      db,
      "SELECT * FROM vault WHERE id = ? AND user_id = ?",
      [id, user.id],
    );
    if (!entry)
      return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);

    return c.json(formatEntry(entry));
  });

  // ─── POST /api/vault/entries — Create entry ──────────────────────────────────

  api.post("/api/vault/entries", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:write")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:write", code: "FORBIDDEN" },
        403,
      );
    }

    const { db, ai } = c.get("ctx");

    const data = await c.req.json().catch(() => null);
    if (!data)
      return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    const validationError = validateEntryInput(data);
    if (validationError) {
      return c.json(
        { error: validationError.error, code: "INVALID_INPUT" },
        validationError.status,
      );
    }

    // Entity kind requires identity_key
    if (categoryFor(data.kind) === "entity" && !data.identity_key) {
      return c.json(
        {
          error: `Entity kind "${data.kind}" requires identity_key`,
          code: "MISSING_IDENTITY_KEY",
        },
        400,
      );
    }

    // Entry limit enforcement for free tier
    const countRow = await queryOne(
      db,
      "SELECT COUNT(*) as c FROM vault WHERE user_id = ?",
      [user.id],
    );
    const entryCount = Number(countRow?.c ?? 0);
    if (isOverEntryLimit(user.tier ?? "free", entryCount)) {
      return c.json(
        { error: "Entry limit reached. Upgrade to Pro.", code: "LIMIT_EXCEEDED" },
        403,
      );
    }

    try {
      const id = await insertEntry(db, ai, {
        kind: data.kind,
        title: data.title,
        body: data.body,
        meta: data.meta,
        tags: data.tags,
        source: data.source || "rest-api",
        identity_key: data.identity_key,
        expires_at: data.expires_at,
        userId: user.id,
      });

      const entry = await queryOne(db, "SELECT * FROM vault WHERE id = ?", [id]);
      return c.json(formatEntry(entry), 201);
    } catch (err) {
      console.error(`[vault-api] Create entry error: ${err.message}`);
      return c.json(
        { error: "Failed to create entry", code: "CREATE_FAILED" },
        500,
      );
    }
  });

  // ─── PUT /api/vault/entries/:id — Partial update ─────────────────────────────

  api.put("/api/vault/entries/:id", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:write")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:write", code: "FORBIDDEN" },
        403,
      );
    }

    const { db, ai } = c.get("ctx");
    const id = c.req.param("id");

    const data = await c.req.json().catch(() => null);
    if (!data)
      return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    const validationError = validateEntryInput(data, {
      requireKind: false,
      requireBody: false,
    });
    if (validationError) {
      return c.json(
        { error: validationError.error, code: "INVALID_INPUT" },
        validationError.status,
      );
    }

    const existing = await queryOne(
      db,
      "SELECT * FROM vault WHERE id = ? AND user_id = ?",
      [id, user.id],
    );
    if (!existing)
      return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);

    // Cannot change kind or identity_key
    if (data.kind && normalizeKind(data.kind) !== existing.kind) {
      return c.json(
        {
          error: `Cannot change kind (current: "${existing.kind}"). Delete and re-create instead.`,
          code: "INVALID_UPDATE",
        },
        400,
      );
    }
    if (data.identity_key && data.identity_key !== existing.identity_key) {
      return c.json(
        {
          error: "Cannot change identity_key. Delete and re-create instead.",
          code: "INVALID_UPDATE",
        },
        400,
      );
    }

    try {
      await updateEntry(db, ai, existing, {
        title: data.title,
        body: data.body,
        tags: data.tags,
        meta: data.meta,
        source: data.source,
        expires_at: data.expires_at,
      });

      const updated = await queryOne(
        db,
        "SELECT * FROM vault WHERE id = ?",
        [id],
      );
      return c.json(formatEntry(updated));
    } catch (err) {
      console.error(`[vault-api] Update entry error: ${err.message}`);
      return c.json(
        { error: "Failed to update entry", code: "UPDATE_FAILED" },
        500,
      );
    }
  });

  // ─── DELETE /api/vault/entries/:id — Delete entry ────────────────────────────

  api.delete("/api/vault/entries/:id", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:write")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:write", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");
    const id = c.req.param("id");

    const entry = await queryOne(
      db,
      "SELECT id, kind, title FROM vault WHERE id = ? AND user_id = ?",
      [id, user.id],
    );
    if (!entry)
      return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);

    // Delete DB row (FTS5 triggers handle vault_fts cleanup automatically)
    await execute(db, "DELETE FROM vault WHERE id = ? AND user_id = ?", [
      id,
      user.id,
    ]);

    return c.json({
      deleted: true,
      id,
      kind: entry.kind,
      title: entry.title || null,
    });
  });

  // ─── GET /api/vault/search — FTS search via query params ─────────────────────

  api.get("/api/vault/search", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");

    const query = c.req.query("q")?.trim();
    if (!query)
      return c.json({ error: "q query parameter is required", code: "INVALID_INPUT" }, 400);

    const limit = Math.min(parseInt(c.req.query("limit") || "20", 10) || 20, 100);
    const offset = parseInt(c.req.query("offset") || "0", 10) || 0;
    const tagsParam = c.req.query("tags");

    try {
      const rows = await ftsSearch(db, user.id, query, {
        kindFilter: c.req.query("kind") ? normalizeKind(c.req.query("kind")) : null,
        categoryFilter: c.req.query("category") || null,
        since: c.req.query("since") || null,
        until: c.req.query("until") || null,
        limit,
        offset,
      });

      let results = rows.map((row) => {
        const entry = formatEntry(row);
        entry.score = Math.round((Number(row.score) || 0) * 1000) / 1000;
        return entry;
      });

      // Client-side tag filtering (FTS doesn't natively filter by tag array)
      if (tagsParam) {
        const filterTags = tagsParam.split(",").map((t) => t.trim().toLowerCase());
        results = results.filter((r) =>
          r.tags.some((t) => filterTags.includes(t.toLowerCase())),
        );
      }

      return c.json({ results, count: results.length, query });
    } catch (err) {
      console.error(`[vault-api] Search error: ${err.message}`);
      return c.json({ error: "Search failed", code: "SEARCH_FAILED" }, 500);
    }
  });

  // ─── POST /api/vault/search — FTS search (vector search: future) ─────────────

  api.post("/api/vault/search", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");

    const data = await c.req.json().catch(() => null);
    if (!data)
      return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);
    if (!data.query?.trim())
      return c.json({ error: "query is required", code: "INVALID_INPUT" }, 400);

    const limit = Math.min(parseInt(data.limit || 20, 10) || 20, 100);
    const offset = parseInt(data.offset || 0, 10) || 0;

    try {
      const rows = await ftsSearch(db, user.id, data.query, {
        kindFilter: data.kind ? normalizeKind(data.kind) : null,
        categoryFilter: data.category || null,
        since: data.since || null,
        until: data.until || null,
        limit,
        offset,
      });

      const results = rows.map((row) => {
        const entry = formatEntry(row);
        entry.score = Math.round((Number(row.score) || 0) * 1000) / 1000;
        return entry;
      });

      return c.json({ results, count: results.length, query: data.query });
    } catch (err) {
      console.error(`[vault-api] Search error: ${err.message}`);
      return c.json({ error: "Search failed", code: "SEARCH_FAILED" }, 500);
    }
  });

  // ─── POST /api/vault/recall — Signal-based retrieval ────────────────────────

  api.post("/api/vault/recall", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");

    const data = await c.req.json().catch(() => null);
    if (!data)
      return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);
    if (!data.signal?.trim())
      return c.json({ error: "signal is required", code: "INVALID_INPUT" }, 400);

    const signalType = data.signal_type || "prompt";
    const maxHints = Math.min(parseInt(data.max_hints || 3, 10) || 3, 10);
    const bucket = data.bucket || null;

    try {
      // Use FTS search on the signal text
      const rows = await ftsSearch(db, user.id, data.signal, {
        limit: maxHints,
        offset: 0,
      });

      const hints = rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title || null,
        body_preview: row.body ? row.body.slice(0, 200) : null,
        tags: row.tags ? JSON.parse(row.tags) : [],
        score: Math.round((Number(row.score) || 0) * 1000) / 1000,
      }));

      // If bucket filter requested, post-filter
      const filtered = bucket
        ? hints.filter((h) =>
            h.tags.some((t) => t.toLowerCase() === `bucket:${bucket.toLowerCase()}`),
          )
        : hints;

      return c.json({
        hints: filtered,
        count: filtered.length,
        signal_type: signalType,
      });
    } catch (err) {
      console.error(`[vault-api] Recall error: ${err.message}`);
      return c.json({ error: "Recall failed", code: "RECALL_FAILED" }, 500);
    }
  });

  // ─── POST /api/vault/import/bulk — Bulk import entries ──────────────────────

  api.post("/api/vault/import/bulk", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:write")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:write", code: "FORBIDDEN" },
        403,
      );
    }

    const { db, ai } = c.get("ctx");

    const data = await c.req.json().catch(() => null);
    if (!data || !Array.isArray(data.entries)) {
      return c.json(
        {
          error: "Invalid body — expected { entries: [...] }",
          code: "INVALID_INPUT",
        },
        400,
      );
    }

    if (data.entries.length > 500) {
      return c.json(
        { error: "Maximum 500 entries per request", code: "LIMIT_EXCEEDED" },
        400,
      );
    }

    // Entry limit enforcement for free tier
    const countRow = await queryOne(
      db,
      "SELECT COUNT(*) as c FROM vault WHERE user_id = ?",
      [user.id],
    );
    const entryCount = Number(countRow?.c ?? 0);
    if (isOverEntryLimit(user.tier ?? "free", entryCount)) {
      return c.json(
        { error: "Entry limit reached. Upgrade to Pro.", code: "LIMIT_EXCEEDED" },
        403,
      );
    }

    let imported = 0;
    let failed = 0;
    const errors = [];

    for (const entry of data.entries) {
      try {
        const validationError = validateEntryInput(entry);
        if (validationError) {
          failed++;
          errors.push(
            `${entry.title || entry.id || "unknown"}: ${validationError.error}`,
          );
          continue;
        }

        await insertEntry(db, ai, {
          kind: entry.kind,
          title: entry.title,
          body: entry.body,
          meta: entry.meta,
          tags: entry.tags,
          source: entry.source || "bulk-import",
          identity_key: entry.identity_key,
          expires_at: entry.expires_at,
          userId: user.id,
        });
        imported++;
      } catch (err) {
        failed++;
        errors.push(
          `${entry.title || entry.id || "unknown"}: ${err.message}`,
        );
      }
    }

    return c.json({ imported, failed, errors: errors.slice(0, 10) });
  });

  // ─── POST /api/vault/import — Single-entry import ────────────────────────────

  api.post("/api/vault/import", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:write")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:write", code: "FORBIDDEN" },
        403,
      );
    }

    const { db, ai } = c.get("ctx");

    const data = await c.req.json().catch(() => null);
    if (!data)
      return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    const validationError = validateEntryInput(data);
    if (validationError) {
      return c.json(
        { error: validationError.error, code: "INVALID_INPUT" },
        validationError.status,
      );
    }

    // Entry limit enforcement for free tier
    const countRow = await queryOne(
      db,
      "SELECT COUNT(*) as c FROM vault WHERE user_id = ?",
      [user.id],
    );
    const entryCount = Number(countRow?.c ?? 0);
    if (isOverEntryLimit(user.tier ?? "free", entryCount)) {
      return c.json(
        { error: "Entry limit reached. Upgrade to Pro.", code: "LIMIT_EXCEEDED" },
        403,
      );
    }

    try {
      const id = await insertEntry(db, ai, {
        kind: data.kind,
        title: data.title,
        body: data.body,
        meta: data.meta,
        tags: data.tags,
        source: data.source || "import",
        identity_key: data.identity_key,
        expires_at: data.expires_at,
        userId: user.id,
      });

      const entry = await queryOne(db, "SELECT * FROM vault WHERE id = ?", [id]);
      return c.json(formatEntry(entry), 201);
    } catch (err) {
      console.error(`[vault-api] Import entry error: ${err.message}`);
      return c.json(
        { error: "Failed to import entry", code: "IMPORT_FAILED" },
        500,
      );
    }
  });

  // NOTE: GET /api/vault/export is defined in management.js (with Pro tier check)

  // ─── POST /api/vault/ingest — Fetch URL and save as entry ───────────────────

  api.post("/api/vault/ingest", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:write")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:write", code: "FORBIDDEN" },
        403,
      );
    }

    const { db, ai } = c.get("ctx");

    const data = await c.req.json().catch(() => null);
    if (!data?.url)
      return c.json({ error: "url is required", code: "INVALID_INPUT" }, 400);

    try {
      // Fetch and extract text from the URL
      const response = await fetch(data.url, {
        headers: { "User-Agent": "context-vault/2.0 (ingestion)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return c.json(
          {
            error: `Failed to fetch URL: HTTP ${response.status}`,
            code: "INGEST_FAILED",
          },
          400,
        );
      }

      const contentType = response.headers.get("content-type") || "";
      let body = "";
      let title = data.url;

      if (contentType.includes("text/html")) {
        const html = await response.text();
        // Extract title tag
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) title = titleMatch[1].trim();
        // Strip HTML tags for body text
        body = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_BODY_LENGTH);
      } else {
        body = (await response.text()).slice(0, MAX_BODY_LENGTH);
      }

      if (!body) {
        return c.json(
          { error: "No content extracted from URL", code: "INGEST_FAILED" },
          400,
        );
      }

      const id = await insertEntry(db, ai, {
        kind: data.kind || "reference",
        title,
        body,
        tags: data.tags || [],
        source: data.url,
        userId: user.id,
      });

      const entry = await queryOne(db, "SELECT * FROM vault WHERE id = ?", [id]);
      return c.json(formatEntry(entry), 201);
    } catch (err) {
      console.error(`[vault-api] Ingest error: ${err.message}`);
      return c.json(
        { error: `Ingestion failed: ${err.message}`, code: "INGEST_FAILED" },
        500,
      );
    }
  });

  // ─── GET /api/vault/manifest — Lightweight entry list for sync ──────────────

  api.get("/api/vault/manifest", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");

    const cursor = c.req.query("cursor") || null;
    const limit = Math.min(parseInt(c.req.query("limit") || "10000", 10), 10000);

    let sql = `SELECT id, kind, title, created_at, updated_at, content_hash FROM vault
       WHERE user_id = ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))`;
    const args = [user.id];

    if (cursor) {
      sql += ` AND id > ?`;
      args.push(cursor);
    }

    sql += ` ORDER BY id ASC LIMIT ?`;
    args.push(limit);

    const rows = await queryAll(db, sql, args);

    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    return c.json({
      entries: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title || null,
        created_at: r.created_at,
        updated_at: r.updated_at || null,
        content_hash: r.content_hash || null,
      })),
      next_cursor: nextCursor,
    });
  });

  // ─── GET /api/vault/status — Vault diagnostics + usage stats ─────────────────

  api.get("/api/vault/status", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");
    const errors = [];

    try {
      // Total and by-kind counts
      const kindRows = await queryAll(
        db,
        "SELECT kind, COUNT(*) as c FROM vault WHERE user_id = ? GROUP BY kind ORDER BY c DESC",
        [user.id],
      );
      const categoryRows = await queryAll(
        db,
        "SELECT category, COUNT(*) as c FROM vault WHERE user_id = ? GROUP BY category",
        [user.id],
      );
      const expiredRow = await queryOne(
        db,
        "SELECT COUNT(*) as c FROM vault WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at <= datetime('now')",
        [user.id],
      );

      const total = kindRows.reduce((sum, k) => sum + Number(k.c), 0);
      const by_kind = Object.fromEntries(
        kindRows.map((k) => [k.kind, Number(k.c)]),
      );
      const by_category = Object.fromEntries(
        categoryRows.map((k) => [k.category, Number(k.c)]),
      );
      const expired = Number(expiredRow?.c ?? 0);

      return c.json({
        entries: { total, by_kind, by_category },
        files: { total: 0, directories: [] }, // no filesystem in Workers
        database: {
          size: "remote",
          size_bytes: null,
          stale_paths: 0,
          expired,
        },
        embeddings: null, // vector search not yet available in Workers
        embed_model_available: null,
        health: errors.length === 0 ? "ok" : "degraded",
        errors,
      });
    } catch (err) {
      console.error(`[vault-api] Status error: ${err.message}`);
      errors.push(err.message);
      return c.json(
        {
          entries: { total: 0, by_kind: {}, by_category: {} },
          files: { total: 0, directories: [] },
          database: { size: "unknown", size_bytes: null, stale_paths: 0, expired: 0 },
          embeddings: null,
          embed_model_available: null,
          health: "degraded",
          errors,
        },
        500,
      );
    }
  });

  // ─── POST /api/vault/import/stream — NDJSON streaming import ────────────────
  // Override global 512KB body limit: 16K entries at ~500 bytes each = ~8MB
  api.post("/api/vault/import/stream", bodyLimit({ maxSize: 32 * 1024 * 1024 }), async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:write")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:write", code: "FORBIDDEN" },
        403,
      );
    }

    const ctx = c.get("ctx");
    const { db } = ctx;
    const sharedDb = ctx.sharedDb || ctx.db;

    // Entry limit enforcement for free tier
    const countRow = await queryOne(
      db,
      "SELECT COUNT(*) as c FROM vault WHERE user_id = ?",
      [user.id],
    );
    const entryCount = Number(countRow?.c ?? 0);
    if (isOverEntryLimit(user.tier ?? "free", entryCount)) {
      return c.json(
        { error: "Entry limit reached. Upgrade to Pro.", code: "LIMIT_EXCEEDED" },
        403,
      );
    }

    // Create import job in shared DB
    const jobId = ulid();
    await execute(
      sharedDb,
      `INSERT INTO import_jobs (id, user_id, status) VALUES (?, ?, 'queued')`,
      [jobId, user.id],
    );

    // Read NDJSON body
    const body = await c.req.text();
    const lines = body.split("\n").filter((line) => line.trim());
    const errors = [];
    let uploaded = 0;

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        const validationError = validateEntryInput(entry);
        if (validationError) {
          errors.push(`${entry.title || entry.id || "unknown"}: ${validationError.error}`);
          continue;
        }

        const id = entry.id || ulid();
        const kind = normalizeKind(entry.kind);
        const category = categoryFor(kind);
        const tags = entry.tags
          ? JSON.stringify(Array.isArray(entry.tags) ? entry.tags : [])
          : null;
        const meta = entry.meta ? JSON.stringify(entry.meta) : null;
        const contentHash = await computeContentHash(
          entry.title || "",
          entry.body,
          tags || "[]",
          meta || "{}",
        );

        // Upsert: if ID exists, update; otherwise insert
        // Use INSERT OR REPLACE for simplicity
        await execute(
          db,
          `INSERT OR REPLACE INTO vault
             (id, user_id, kind, category, title, body, meta, tags, source,
              identity_key, expires_at, content_hash, embedded, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [
            id,
            user.id,
            kind,
            category,
            entry.title || null,
            entry.body,
            meta,
            tags,
            entry.source || "stream-import",
            entry.identity_key || null,
            entry.expires_at || null,
            contentHash,
            entry.created_at || now,
            entry.updated_at || now,
          ],
        );
        uploaded++;
      } catch (err) {
        errors.push(`line ${uploaded + errors.length + 1}: ${err.message}`);
      }
    }

    // Update job with results
    await execute(
      sharedDb,
      `UPDATE import_jobs
       SET status = 'processing', total_entries = ?, entries_uploaded = ?,
           errors = ?
       WHERE id = ?`,
      [uploaded, uploaded, errors.length ? JSON.stringify(errors.slice(0, 50)) : null, jobId],
    );

    // Fire-and-forget: trigger background embedding via self-fetch
    const apiUrl = ctx.config.apiUrl;
    const authHeader = c.req.header("Authorization") || "";
    c.executionCtx.waitUntil(
      fetch(`${apiUrl}/api/vault/jobs/${jobId}/process`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
        },
      }).catch((e) => {
        console.error(`[stream-import] Failed to trigger embedding processor: ${e.message}`);
      }),
    );

    return c.json({
      job_id: jobId,
      entries_uploaded: uploaded,
      errors: errors.slice(0, 10),
    });
  });

  // ─── GET /api/vault/jobs/:id — Import job status ────────────────────────────

  api.get("/api/vault/jobs/:id", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const ctx = c.get("ctx");
    const sharedDb = ctx.sharedDb || ctx.db;
    const jobId = c.req.param("id");

    const job = await queryOne(
      sharedDb,
      `SELECT * FROM import_jobs WHERE id = ? AND user_id = ?`,
      [jobId, user.id],
    );

    if (!job) {
      return c.json({ error: "Job not found", code: "NOT_FOUND" }, 404);
    }

    return c.json({
      id: job.id,
      status: job.status,
      total_entries: job.total_entries,
      entries_uploaded: job.entries_uploaded,
      entries_embedded: job.entries_embedded,
      errors: job.errors ? JSON.parse(job.errors) : [],
      created_at: job.created_at,
      completed_at: job.completed_at || null,
    });
  });

  // ─── POST /api/vault/jobs/:id/process — Background embedding processor ─────

  api.post("/api/vault/jobs/:id/process", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const ctx = c.get("ctx");
    const { db, ai } = ctx;
    const sharedDb = ctx.sharedDb || ctx.db;
    const jobId = c.req.param("id");

    // Verify job ownership
    const job = await queryOne(
      sharedDb,
      `SELECT * FROM import_jobs WHERE id = ? AND user_id = ?`,
      [jobId, user.id],
    );
    if (!job) {
      return c.json({ error: "Job not found", code: "NOT_FOUND" }, 404);
    }
    if (job.status === "complete" || job.status === "failed") {
      return c.json({ status: job.status, message: "Job already finished" });
    }

    // Fetch a batch of unembedded entries
    const BATCH_SIZE = 100;
    const rows = await queryAll(
      db,
      `SELECT id, title, body FROM vault
       WHERE user_id = ? AND embedded = 0
       ORDER BY id ASC LIMIT ?`,
      [user.id, BATCH_SIZE],
    );

    if (rows.length === 0) {
      // All done
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      await execute(
        sharedDb,
        `UPDATE import_jobs SET status = 'complete', completed_at = ? WHERE id = ?`,
        [now, jobId],
      );
      return c.json({ status: "complete", entries_embedded: job.entries_embedded });
    }

    // Build texts for batch embedding
    const texts = rows.map(
      (r) => `${r.title ? r.title + "\n" : ""}${r.body}`,
    );

    // Generate embeddings (results discarded for now; vector storage not yet implemented)
    await embedBatch(ai, texts);

    // Mark entries as embedded
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    await execute(
      db,
      `UPDATE vault SET embedded = 1 WHERE id IN (${placeholders})`,
      ids,
    );

    // Update job progress
    const newEmbedded = (job.entries_embedded || 0) + rows.length;
    await execute(
      sharedDb,
      `UPDATE import_jobs SET entries_embedded = ? WHERE id = ?`,
      [newEmbedded, jobId],
    );

    // If there might be more, chain another self-fetch
    if (rows.length === BATCH_SIZE) {
      const apiUrl = ctx.config.apiUrl;
      const authHeader = c.req.header("Authorization") || "";
      c.executionCtx.waitUntil(
        fetch(`${apiUrl}/api/vault/jobs/${jobId}/process`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
          },
        }).catch((e) => {
          console.error(`[embed-processor] Self-fetch chain error: ${e.message}`);
        }),
      );
    } else {
      // This was the last batch
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      await execute(
        sharedDb,
        `UPDATE import_jobs SET status = 'complete', completed_at = ? WHERE id = ?`,
        [now, jobId],
      );
    }

    return c.json({
      status: "processing",
      batch_embedded: rows.length,
      total_embedded: newEmbedded,
    });
  });

  return api;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 content hash for sync diffing.
 * Hash of: title || body || tags_json || meta_json
 *
 * @param {string} title
 * @param {string} body
 * @param {string} tagsJson
 * @param {string} metaJson
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
async function computeContentHash(title, body, tagsJson, metaJson) {
  const content = `${title || ""}${body || ""}${tagsJson || "[]"}${metaJson || "{}"}`;
  const encoded = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
