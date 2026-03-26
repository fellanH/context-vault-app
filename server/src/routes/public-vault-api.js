/**
 * public-vault-api.js -- Public vault REST API routes.
 *
 * Curator endpoints (require auth + ownership):
 *   POST   /api/public/vaults              Create public vault
 *   PUT    /api/public/:slug               Update vault metadata
 *   DELETE /api/public/:slug               Delete vault
 *   POST   /api/public/:slug/entries       Add entry (curator)
 *   PUT    /api/public/:slug/entries/:id   Update entry (curator)
 *   DELETE /api/public/:slug/entries/:id   Remove entry (curator)
 *   POST   /api/public/:slug/seed          Seed from personal vault
 *
 * Consumer endpoints (no auth for free vaults, Bearer for pro):
 *   GET    /api/public/vaults              List/browse public vaults
 *   GET    /api/public/vaults/search       Search vault directory
 *   GET    /api/public/:slug               Vault metadata + stats
 *   GET    /api/public/:slug/entries       List entries (paginated)
 *   GET    /api/public/:slug/search        Search entries (FTS)
 *   GET    /api/public/:slug/stats         Recall analytics
 */

import { Hono } from "hono";
import { queryAll, queryOne, execute } from "../storage/turso.js";
import { ulid } from "../storage/workers-ctx.js";
import { validateEntryInput } from "../validation/entry-validation.js";
import { scanEntry } from "../validation/privacy-scan.js";
import {
  normalizeKind,
  categoryFor,
  formatEntry,
  insertEntry,
} from "./vault-api.js";
import {
  getPublicVaultBySlug,
  listPublicVaults,
  searchPublicVaults,
  createPublicVaultRecord,
  updatePublicVaultRecord,
  deletePublicVaultRecord,
  provisionPublicVaultDb,
  resolvePublicVaultClient,
  formatPublicVault,
} from "../storage/public-vault-db.js";

// ── Slug validation ────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

function isValidSlug(slug) {
  return SLUG_RE.test(slug);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Require authenticated user. Returns user or sends 401.
 */
function getAuthUser(c) {
  const user = c.get("authUser");
  if (!user) return null;
  return user;
}

/**
 * Verify the authenticated user is the curator of the given vault.
 */
function isCurator(user, vault) {
  return user.id === vault.curator_id;
}

/**
 * Check if a vault requires auth for read access (pro vaults).
 * Returns true if access is allowed, false if blocked.
 */
function canReadVault(vault, user) {
  if (vault.visibility === "free") return true;
  // Pro vaults require any authenticated user
  return !!user;
}

/**
 * Format a vault entry for public API responses.
 * Extends the standard formatEntry with public-vault-specific fields.
 */
function formatPublicEntry(row) {
  const entry = formatEntry(row);
  entry.recall_count = Number(row.recall_count || 0);
  entry.distinct_consumers = Number(row.distinct_consumers || 0);
  entry.status = row.status || "active";
  entry.is_evergreen = Boolean(row.is_evergreen);
  return entry;
}

/**
 * FTS search within a public vault's dedicated DB.
 */
async function ftsSearchPublicVault(vaultDb, query, opts = {}) {
  const {
    kindFilter = null,
    categoryFilter = null,
    limit = 20,
    offset = 0,
  } = opts;

  const safeQuery = query.replace(/['"*()]/g, " ").trim();
  if (!safeQuery) return [];

  const clauses = [
    "v.status = 'active'",
    "(v.expires_at IS NULL OR v.expires_at > datetime('now'))",
    "fts.vault_fts MATCH ?",
  ];
  const args = [`"${safeQuery}" OR ${safeQuery}*`];

  if (kindFilter) {
    clauses.push("v.kind = ?");
    args.push(kindFilter);
  }
  if (categoryFilter) {
    clauses.push("v.category = ?");
    args.push(categoryFilter);
  }

  args.push(limit, offset);

  const sql = `
    SELECT v.*, (1.0 / (1.0 + rank)) AS relevance,
           (1.0 / (1.0 + rank)) * log(1.0 + COALESCE(v.recall_count, 0)) AS score
    FROM vault v
    JOIN vault_fts fts ON fts.rowid = v.rowid
    WHERE ${clauses.join(" AND ")}
    ORDER BY score DESC
    LIMIT ? OFFSET ?
  `;

  return queryAll(vaultDb, sql, args);
}

// ── Route factory ──────────────────────────────────────────────────────────

export function createPublicVaultApiRoutes() {
  const api = new Hono();

  // ════════════════════════════════════════════════════════════════════════
  // CONSUMER ENDPOINTS (no auth required for free vaults)
  // ════════════════════════════════════════════════════════════════════════

  // ── GET /api/public/vaults -- List/browse public vaults ────────────────

  api.get("/api/public/vaults", async (c) => {
    const { db } = c.get("ctx");

    const domain = c.req.query("domain") || null;
    const sort = c.req.query("sort") || "consumer_count";
    const limit = Math.min(parseInt(c.req.query("limit") || "20", 10) || 20, 100);
    const offset = parseInt(c.req.query("offset") || "0", 10) || 0;

    try {
      const { vaults, total } = await listPublicVaults(db, {
        domain,
        sort,
        limit,
        offset,
      });

      return c.json({
        vaults: vaults.map(formatPublicVault),
        total,
        limit,
        offset,
      });
    } catch (err) {
      console.error(`[public-vault-api] List vaults error: ${err.message}`);
      return c.json({ error: "Failed to list vaults", code: "LIST_FAILED" }, 500);
    }
  });

  // ── GET /api/public/vaults/search -- Search vault directory ────────────

  api.get("/api/public/vaults/search", async (c) => {
    const { db } = c.get("ctx");

    const query = c.req.query("q")?.trim();
    if (!query) {
      return c.json({ error: "q query parameter is required", code: "INVALID_INPUT" }, 400);
    }

    const limit = Math.min(parseInt(c.req.query("limit") || "20", 10) || 20, 100);
    const offset = parseInt(c.req.query("offset") || "0", 10) || 0;

    try {
      const vaults = await searchPublicVaults(db, query, { limit, offset });
      return c.json({
        vaults: vaults.map(formatPublicVault),
        count: vaults.length,
        query,
      });
    } catch (err) {
      console.error(`[public-vault-api] Search vaults error: ${err.message}`);
      return c.json({ error: "Search failed", code: "SEARCH_FAILED" }, 500);
    }
  });

  // ── GET /api/public/:slug -- Vault metadata + stats ────────────────────

  api.get("/api/public/:slug", async (c) => {
    const { db } = c.get("ctx");
    const slug = c.req.param("slug");

    const vault = await getPublicVaultBySlug(db, slug);
    if (!vault) {
      return c.json({ error: "Vault not found", code: "NOT_FOUND" }, 404);
    }

    const user = c.get("authUser");
    if (!canReadVault(vault, user)) {
      return c.json({ error: "Pro vault requires authentication", code: "AUTH_REQUIRED" }, 401);
    }

    return c.json(formatPublicVault(vault));
  });

  // ── GET /api/public/:slug/entries -- List entries (paginated) ──────────

  api.get("/api/public/:slug/entries", async (c) => {
    const { db } = c.get("ctx");
    const slug = c.req.param("slug");

    const vault = await getPublicVaultBySlug(db, slug);
    if (!vault) {
      return c.json({ error: "Vault not found", code: "NOT_FOUND" }, 404);
    }

    const user = c.get("authUser");
    if (!canReadVault(vault, user)) {
      return c.json({ error: "Pro vault requires authentication", code: "AUTH_REQUIRED" }, 401);
    }

    const kind = c.req.query("kind") || null;
    const category = c.req.query("category") || null;
    const limit = Math.min(parseInt(c.req.query("limit") || "20", 10) || 20, 100);
    const offset = parseInt(c.req.query("offset") || "0", 10) || 0;

    try {
      const vaultDb = await resolvePublicVaultClient(vault);

      const clauses = [
        "status = 'active'",
        "(expires_at IS NULL OR expires_at > datetime('now'))",
      ];
      const args = [];

      if (kind) {
        clauses.push("kind = ?");
        args.push(normalizeKind(kind));
      }
      if (category) {
        clauses.push("category = ?");
        args.push(category);
      }

      const where = `WHERE ${clauses.join(" AND ")}`;

      const countRow = await queryOne(
        vaultDb,
        `SELECT COUNT(*) as c FROM vault ${where}`,
        args,
      );
      const total = Number(countRow?.c ?? 0);

      const rows = await queryAll(
        vaultDb,
        `SELECT * FROM vault ${where} ORDER BY recall_count DESC, created_at DESC LIMIT ? OFFSET ?`,
        [...args, limit, offset],
      );

      return c.json({
        entries: rows.map(formatPublicEntry),
        total,
        limit,
        offset,
      });
    } catch (err) {
      console.error(`[public-vault-api] List entries error: ${err.message}`);
      return c.json({ error: "Failed to list entries", code: "LIST_FAILED" }, 500);
    }
  });

  // ── GET /api/public/:slug/search -- Search entries (FTS) ──────────────

  api.get("/api/public/:slug/search", async (c) => {
    const { db } = c.get("ctx");
    const slug = c.req.param("slug");

    const vault = await getPublicVaultBySlug(db, slug);
    if (!vault) {
      return c.json({ error: "Vault not found", code: "NOT_FOUND" }, 404);
    }

    const user = c.get("authUser");
    if (!canReadVault(vault, user)) {
      return c.json({ error: "Pro vault requires authentication", code: "AUTH_REQUIRED" }, 401);
    }

    const query = c.req.query("q")?.trim();
    if (!query) {
      return c.json({ error: "q query parameter is required", code: "INVALID_INPUT" }, 400);
    }

    const limit = Math.min(parseInt(c.req.query("limit") || "10", 10) || 10, 100);

    try {
      const vaultDb = await resolvePublicVaultClient(vault);

      const rows = await ftsSearchPublicVault(vaultDb, query, {
        kindFilter: c.req.query("kind") ? normalizeKind(c.req.query("kind")) : null,
        categoryFilter: c.req.query("category") || null,
        limit,
        offset: 0,
      });

      const results = rows.map((row) => {
        const entry = formatPublicEntry(row);
        entry.score = Math.round((Number(row.score) || 0) * 1000) / 1000;
        return entry;
      });

      return c.json({ results, count: results.length, query });
    } catch (err) {
      console.error(`[public-vault-api] Search entries error: ${err.message}`);
      return c.json({ error: "Search failed", code: "SEARCH_FAILED" }, 500);
    }
  });

  // ── GET /api/public/:slug/stats -- Recall analytics ────────────────────

  api.get("/api/public/:slug/stats", async (c) => {
    const { db } = c.get("ctx");
    const slug = c.req.param("slug");

    const vault = await getPublicVaultBySlug(db, slug);
    if (!vault) {
      return c.json({ error: "Vault not found", code: "NOT_FOUND" }, 404);
    }

    try {
      const vaultDb = await resolvePublicVaultClient(vault);

      const totalRow = await queryOne(vaultDb, "SELECT COUNT(*) as c FROM vault WHERE status = 'active'");
      const recallRow = await queryOne(vaultDb, "SELECT SUM(recall_count) as s FROM vault WHERE status = 'active'");
      const kindRows = await queryAll(
        vaultDb,
        "SELECT kind, COUNT(*) as c FROM vault WHERE status = 'active' GROUP BY kind ORDER BY c DESC",
      );
      const topEntries = await queryAll(
        vaultDb,
        "SELECT id, title, kind, recall_count, distinct_consumers FROM vault WHERE status = 'active' ORDER BY recall_count DESC LIMIT 10",
      );

      return c.json({
        slug: vault.slug,
        entry_count: Number(totalRow?.c ?? 0),
        total_recalls: Number(recallRow?.s ?? 0),
        consumer_count: Number(vault.consumer_count || 0),
        by_kind: Object.fromEntries(kindRows.map((k) => [k.kind, Number(k.c)])),
        top_entries: topEntries.map((e) => ({
          id: e.id,
          title: e.title,
          kind: e.kind,
          recall_count: Number(e.recall_count || 0),
          distinct_consumers: Number(e.distinct_consumers || 0),
        })),
      });
    } catch (err) {
      console.error(`[public-vault-api] Stats error: ${err.message}`);
      return c.json({ error: "Failed to load stats", code: "STATS_FAILED" }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // CURATOR ENDPOINTS (require auth + curator ownership)
  // ════════════════════════════════════════════════════════════════════════

  // ── POST /api/public/vaults -- Create public vault ─────────────────────

  api.post("/api/public/vaults", async (c) => {
    const user = getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    // Creating a public vault requires Pro tier
    if (user.tier !== "pro" && user.tier !== "team") {
      return c.json(
        { error: "Creating public vaults requires a Pro account", code: "PRO_REQUIRED" },
        403,
      );
    }

    const data = await c.req.json().catch(() => null);
    if (!data) return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    const { name, slug, description, visibility, domain_tags } = data;

    if (!name?.trim()) {
      return c.json({ error: "name is required", code: "INVALID_INPUT" }, 400);
    }
    if (!slug?.trim()) {
      return c.json({ error: "slug is required", code: "INVALID_INPUT" }, 400);
    }
    if (!isValidSlug(slug)) {
      return c.json(
        { error: "slug must be 3-64 lowercase alphanumeric chars with hyphens, no leading/trailing hyphens", code: "INVALID_SLUG" },
        400,
      );
    }
    if (visibility && !["free", "pro"].includes(visibility)) {
      return c.json({ error: 'visibility must be "free" or "pro"', code: "INVALID_INPUT" }, 400);
    }

    const { db } = c.get("ctx");
    const env = c.env;

    // Check slug uniqueness
    const existing = await getPublicVaultBySlug(db, slug);
    if (existing) {
      return c.json({ error: "A vault with this slug already exists", code: "SLUG_TAKEN" }, 409);
    }

    try {
      // Provision a dedicated Turso DB
      const provisioned = await provisionPublicVaultDb(env, slug);

      const id = ulid();
      await createPublicVaultRecord(db, {
        id,
        slug,
        name: name.trim(),
        description: description?.trim() || null,
        curatorId: user.id,
        visibility: visibility || "free",
        domainTags: Array.isArray(domain_tags) ? domain_tags : [],
        vaultDbUrl: provisioned.url,
        vaultDbToken: provisioned.token,
        vaultDbName: provisioned.name,
      });

      // Initialize the per-vault schema
      const vaultRecord = await getPublicVaultBySlug(db, slug);
      await resolvePublicVaultClient(vaultRecord);

      return c.json(formatPublicVault(vaultRecord), 201);
    } catch (err) {
      console.error(`[public-vault-api] Create vault error: ${err.message}`);
      return c.json({ error: "Failed to create vault", code: "CREATE_FAILED" }, 500);
    }
  });

  // ── PUT /api/public/:slug -- Update vault metadata ─────────────────────

  api.put("/api/public/:slug", async (c) => {
    const user = getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const { db } = c.get("ctx");
    const slug = c.req.param("slug");

    const vault = await getPublicVaultBySlug(db, slug);
    if (!vault) return c.json({ error: "Vault not found", code: "NOT_FOUND" }, 404);

    if (!isCurator(user, vault)) {
      return c.json({ error: "Only the curator can update this vault", code: "FORBIDDEN" }, 403);
    }

    const data = await c.req.json().catch(() => null);
    if (!data) return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    try {
      await updatePublicVaultRecord(db, vault.id, {
        name: data.name,
        description: data.description,
        visibility: data.visibility,
        domainTags: data.domain_tags,
      });

      const updated = await getPublicVaultBySlug(db, slug);
      return c.json(formatPublicVault(updated));
    } catch (err) {
      console.error(`[public-vault-api] Update vault error: ${err.message}`);
      return c.json({ error: "Failed to update vault", code: "UPDATE_FAILED" }, 500);
    }
  });

  // ── DELETE /api/public/:slug -- Delete vault ───────────────────────────

  api.delete("/api/public/:slug", async (c) => {
    const user = getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const { db } = c.get("ctx");
    const slug = c.req.param("slug");

    const vault = await getPublicVaultBySlug(db, slug);
    if (!vault) return c.json({ error: "Vault not found", code: "NOT_FOUND" }, 404);

    if (!isCurator(user, vault)) {
      return c.json({ error: "Only the curator can delete this vault", code: "FORBIDDEN" }, 403);
    }

    try {
      await deletePublicVaultRecord(db, vault.id);
      return c.json({ deleted: true, slug });
    } catch (err) {
      console.error(`[public-vault-api] Delete vault error: ${err.message}`);
      return c.json({ error: "Failed to delete vault", code: "DELETE_FAILED" }, 500);
    }
  });

  // ── POST /api/public/:slug/entries -- Add entry (curator) ──────────────

  api.post("/api/public/:slug/entries", async (c) => {
    const user = getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const { db, ai } = c.get("ctx");
    const slug = c.req.param("slug");

    const vault = await getPublicVaultBySlug(db, slug);
    if (!vault) return c.json({ error: "Vault not found", code: "NOT_FOUND" }, 404);

    if (!isCurator(user, vault)) {
      return c.json({ error: "Only the curator can add entries", code: "FORBIDDEN" }, 403);
    }

    const data = await c.req.json().catch(() => null);
    if (!data) return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    const validationError = validateEntryInput(data);
    if (validationError) {
      return c.json(
        { error: validationError.error, code: "INVALID_INPUT" },
        validationError.status,
      );
    }

    // Events cannot be published to public vaults
    if (categoryFor(data.kind) === "event") {
      return c.json(
        { error: "Event entries cannot be added to public vaults", code: "EVENT_FORBIDDEN" },
        403,
      );
    }

    // Privacy scan
    if (!data.force) {
      const scan = scanEntry({ title: data.title, body: data.body, meta: data.meta });
      if (!scan.clean) {
        return c.json(
          {
            error: "Entry contains potentially sensitive content",
            code: "PRIVACY_SCAN_FAILED",
            matches: scan.matches,
            hint: "Remove sensitive content or use force: true to override",
          },
          422,
        );
      }
    }

    try {
      const vaultDb = await resolvePublicVaultClient(vault);

      const id = await insertEntry(vaultDb, ai, {
        kind: data.kind,
        title: data.title,
        body: data.body,
        meta: data.meta,
        tags: data.tags,
        source: data.source || "public-vault-api",
        identity_key: data.identity_key,
        expires_at: data.expires_at,
        userId: user.id,
        teamId: null,
      });

      const entry = await queryOne(vaultDb, "SELECT * FROM vault WHERE id = ?", [id]);
      return c.json(formatPublicEntry(entry), 201);
    } catch (err) {
      console.error(`[public-vault-api] Create entry error: ${err.message}`);
      return c.json({ error: "Failed to create entry", code: "CREATE_FAILED" }, 500);
    }
  });

  // ── PUT /api/public/:slug/entries/:id -- Update entry (curator) ────────

  api.put("/api/public/:slug/entries/:id", async (c) => {
    const user = getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const { db } = c.get("ctx");
    const slug = c.req.param("slug");
    const entryId = c.req.param("id");

    const vault = await getPublicVaultBySlug(db, slug);
    if (!vault) return c.json({ error: "Vault not found", code: "NOT_FOUND" }, 404);

    if (!isCurator(user, vault)) {
      return c.json({ error: "Only the curator can update entries", code: "FORBIDDEN" }, 403);
    }

    const data = await c.req.json().catch(() => null);
    if (!data) return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    try {
      const vaultDb = await resolvePublicVaultClient(vault);

      const existing = await queryOne(vaultDb, "SELECT * FROM vault WHERE id = ?", [entryId]);
      if (!existing) {
        return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);
      }

      const sets = [];
      const args = [];

      if (data.title !== undefined) { sets.push("title = ?"); args.push(data.title); }
      if (data.body !== undefined) { sets.push("body = ?"); args.push(data.body); }
      if (data.tags !== undefined) {
        sets.push("tags = ?");
        args.push(JSON.stringify(Array.isArray(data.tags) ? data.tags : []));
      }
      if (data.meta !== undefined) {
        const existingMeta = existing.meta ? JSON.parse(existing.meta) : {};
        const merged = { ...existingMeta, ...data.meta };
        sets.push("meta = ?");
        args.push(JSON.stringify(merged));
      }
      if (data.source !== undefined) { sets.push("source = ?"); args.push(data.source); }
      if (data.status !== undefined && ["active", "deprecated", "hidden"].includes(data.status)) {
        sets.push("status = ?");
        args.push(data.status);
      }
      if (data.is_evergreen !== undefined) {
        sets.push("is_evergreen = ?");
        args.push(data.is_evergreen ? 1 : 0);
      }

      if (sets.length === 0) {
        return c.json({ error: "No fields to update", code: "INVALID_INPUT" }, 400);
      }

      sets.push("updated_at = ?");
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      args.push(now, entryId);

      await execute(vaultDb, `UPDATE vault SET ${sets.join(", ")} WHERE id = ?`, args);

      const updated = await queryOne(vaultDb, "SELECT * FROM vault WHERE id = ?", [entryId]);
      return c.json(formatPublicEntry(updated));
    } catch (err) {
      console.error(`[public-vault-api] Update entry error: ${err.message}`);
      return c.json({ error: "Failed to update entry", code: "UPDATE_FAILED" }, 500);
    }
  });

  // ── DELETE /api/public/:slug/entries/:id -- Remove entry (curator) ─────

  api.delete("/api/public/:slug/entries/:id", async (c) => {
    const user = getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const { db } = c.get("ctx");
    const slug = c.req.param("slug");
    const entryId = c.req.param("id");

    const vault = await getPublicVaultBySlug(db, slug);
    if (!vault) return c.json({ error: "Vault not found", code: "NOT_FOUND" }, 404);

    if (!isCurator(user, vault)) {
      return c.json({ error: "Only the curator can remove entries", code: "FORBIDDEN" }, 403);
    }

    try {
      const vaultDb = await resolvePublicVaultClient(vault);

      const entry = await queryOne(vaultDb, "SELECT * FROM vault WHERE id = ?", [entryId]);
      if (!entry) {
        return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);
      }

      await execute(vaultDb, "DELETE FROM vault WHERE id = ?", [entryId]);
      return c.json({ deleted: true, id: entryId });
    } catch (err) {
      console.error(`[public-vault-api] Delete entry error: ${err.message}`);
      return c.json({ error: "Failed to delete entry", code: "DELETE_FAILED" }, 500);
    }
  });

  // ── POST /api/public/:slug/seed -- Seed from personal vault ────────────

  api.post("/api/public/:slug/seed", async (c) => {
    const user = getAuthUser(c);
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

    const { db, ai } = c.get("ctx");
    const slug = c.req.param("slug");

    const vault = await getPublicVaultBySlug(db, slug);
    if (!vault) return c.json({ error: "Vault not found", code: "NOT_FOUND" }, 404);

    if (!isCurator(user, vault)) {
      return c.json({ error: "Only the curator can seed this vault", code: "FORBIDDEN" }, 403);
    }

    const data = await c.req.json().catch(() => null);
    if (!data) return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    const { entry_ids, tags, dry_run } = data;

    if (!entry_ids?.length && !tags?.length) {
      return c.json(
        { error: "Provide entry_ids or tags to filter personal entries", code: "INVALID_INPUT" },
        400,
      );
    }

    try {
      // Build query to find matching personal entries
      const clauses = ["user_id = ?"];
      const args = [user.id];

      if (entry_ids?.length) {
        const placeholders = entry_ids.map(() => "?").join(", ");
        clauses.push(`id IN (${placeholders})`);
        args.push(...entry_ids);
      }
      if (tags?.length) {
        // Match entries that have any of the specified tags
        const tagClauses = tags.map(() => "tags LIKE ?");
        clauses.push(`(${tagClauses.join(" OR ")})`);
        args.push(...tags.map((t) => `%"${t}"%`));
      }

      // Exclude events (private by design)
      clauses.push("category != 'event'");

      const sourceEntries = await queryAll(
        db,
        `SELECT * FROM vault WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 200`,
        args,
      );

      if (dry_run) {
        return c.json({
          dry_run: true,
          matched: sourceEntries.length,
          entries: sourceEntries.map((e) => ({
            id: e.id,
            kind: e.kind,
            title: e.title,
            category: e.category,
          })),
        });
      }

      const vaultDb = await resolvePublicVaultClient(vault);
      let seeded = 0;
      let skipped = 0;
      const errors = [];

      for (const source of sourceEntries) {
        // Privacy scan
        const scan = scanEntry({
          title: source.title,
          body: source.body,
          meta: source.meta,
        });
        if (!scan.clean) {
          skipped++;
          continue;
        }

        try {
          await insertEntry(vaultDb, ai, {
            kind: source.kind,
            title: source.title,
            body: source.body,
            meta: source.meta ? JSON.parse(source.meta) : null,
            tags: source.tags ? JSON.parse(source.tags) : null,
            source: `seeded:${source.id}`,
            identity_key: source.identity_key,
            expires_at: source.expires_at,
            userId: user.id,
            teamId: null,
          });
          seeded++;
        } catch (err) {
          errors.push({ id: source.id, error: err.message });
        }
      }

      return c.json({
        seeded,
        skipped,
        errors: errors.length ? errors : undefined,
        total_matched: sourceEntries.length,
      }, 201);
    } catch (err) {
      console.error(`[public-vault-api] Seed error: ${err.message}`);
      return c.json({ error: "Failed to seed vault", code: "SEED_FAILED" }, 500);
    }
  });

  return api;
}
