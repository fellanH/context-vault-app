/**
 * team-vault-api.js -- Team-scoped vault REST API routes.
 *
 * Endpoints:
 *   GET    /api/team/:teamId/entries       List team vault entries
 *   GET    /api/team/:teamId/entries/:id   Get single team entry
 *   POST   /api/team/:teamId/entries       Create entry in team vault
 *   POST   /api/team/:teamId/search        Search team vault (FTS)
 *   GET    /api/team/:teamId/status        Team vault stats
 *   POST   /api/vault/publish              Publish a personal entry to a team vault
 *
 * All team routes verify the authenticated user is a member of the team
 * via better-auth's organization plugin before proceeding.
 *
 * MVP approach: shared database with team_id column on vault entries.
 * Per architecture-v2.md, the target is per-tenant Turso databases, but
 * for MVP a team_id column is simpler and sufficient. Migration path:
 * move team entries to dedicated DBs later without API changes.
 */

import { Hono } from "hono";
import { queryAll, queryOne } from "../storage/turso.js";
import { validateEntryInput } from "../validation/entry-validation.js";
import { hasScope } from "../auth/scopes.js";
import {
  normalizeKind,
  categoryFor,
  formatEntry,
  insertEntry,
} from "./vault-api.js";

// ── Team membership check ────────────────────────────────────────────────────

/**
 * Verify the authenticated user is a member of the given organization.
 * Queries the better-auth `member` table directly (same Turso DB).
 *
 * @param {object} db - Turso client
 * @param {string} userId - Authenticated user's ID
 * @param {string} teamId - Organization ID to check
 * @returns {Promise<{isMember: boolean, role: string|null}>}
 */
async function checkTeamMembership(db, userId, teamId) {
  try {
    const row = await queryOne(
      db,
      `SELECT role FROM member WHERE "userId" = ? AND "organizationId" = ?`,
      [userId, teamId],
    );
    if (row) {
      return { isMember: true, role: row.role };
    }
    return { isMember: false, role: null };
  } catch {
    return { isMember: false, role: null };
  }
}

/**
 * Middleware: require auth + team membership. Sets c.teamMembership on success.
 */
async function requireTeamMember(c, next) {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);

  const teamId = c.req.param("teamId");
  if (!teamId) return c.json({ error: "teamId is required", code: "INVALID_INPUT" }, 400);

  const { db } = c.get("ctx");
  const membership = await checkTeamMembership(db, user.id, teamId);
  if (!membership.isMember) {
    return c.json(
      { error: "Not a member of this team", code: "FORBIDDEN" },
      403,
    );
  }

  c.set("teamMembership", membership);
  await next();
}

// ── FTS search scoped to team ────────────────────────────────────────────────

async function ftsSearchTeam(db, teamId, query, opts = {}) {
  const {
    kindFilter = null,
    categoryFilter = null,
    since = null,
    until = null,
    limit = 20,
    offset = 0,
  } = opts;

  const safeQuery = query.replace(/['"*()]/g, " ").trim();
  if (!safeQuery) return [];

  const clauses = [
    "v.team_id = ?",
    "(v.expires_at IS NULL OR v.expires_at > datetime('now'))",
    "fts.vault_fts MATCH ?",
  ];
  const args = [teamId, `"${safeQuery}" OR ${safeQuery}*`];

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

// ── Route factory ────────────────────────────────────────────────────────────

export function createTeamVaultApiRoutes() {
  const api = new Hono();

  // Apply team membership middleware to all /api/team/:teamId/* routes
  api.use("/api/team/:teamId/*", requireTeamMember);

  // ── GET /api/team/:teamId/entries -- List team vault entries ───────────────

  api.get("/api/team/:teamId/entries", async (c) => {
    const user = c.get("authUser");
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");
    const teamId = c.req.param("teamId");

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
      "team_id = ?",
      "(expires_at IS NULL OR expires_at > datetime('now'))",
    ];
    const args = [teamId];

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

  // ── GET /api/team/:teamId/entries/:id -- Get single team entry ────────────

  api.get("/api/team/:teamId/entries/:id", async (c) => {
    const user = c.get("authUser");
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");
    const teamId = c.req.param("teamId");
    const id = c.req.param("id");

    const entry = await queryOne(
      db,
      "SELECT * FROM vault WHERE id = ? AND team_id = ?",
      [id, teamId],
    );
    if (!entry)
      return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);

    return c.json(formatEntry(entry));
  });

  // ── POST /api/team/:teamId/entries -- Create entry in team vault ──────────

  api.post("/api/team/:teamId/entries", async (c) => {
    const user = c.get("authUser");
    if (!hasScope(user.scopes ?? ["*"], "vault:write")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:write", code: "FORBIDDEN" },
        403,
      );
    }

    const { db, ai } = c.get("ctx");
    const teamId = c.req.param("teamId");

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

    if (categoryFor(data.kind) === "entity" && !data.identity_key) {
      return c.json(
        {
          error: `Entity kind "${data.kind}" requires identity_key`,
          code: "MISSING_IDENTITY_KEY",
        },
        400,
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
        teamId,
      });

      const entry = await queryOne(db, "SELECT * FROM vault WHERE id = ?", [id]);
      return c.json(formatEntry(entry), 201);
    } catch (err) {
      console.error(`[team-vault-api] Create entry error: ${err.message}`);
      return c.json(
        { error: "Failed to create entry", code: "CREATE_FAILED" },
        500,
      );
    }
  });

  // ── POST /api/team/:teamId/search -- Search team vault ────────────────────

  api.post("/api/team/:teamId/search", async (c) => {
    const user = c.get("authUser");
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");
    const teamId = c.req.param("teamId");

    const data = await c.req.json().catch(() => null);
    if (!data)
      return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);
    if (!data.query?.trim())
      return c.json({ error: "query is required", code: "INVALID_INPUT" }, 400);

    const limit = Math.min(parseInt(data.limit || 20, 10) || 20, 100);
    const offset = parseInt(data.offset || 0, 10) || 0;

    try {
      const rows = await ftsSearchTeam(db, teamId, data.query, {
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
      console.error(`[team-vault-api] Search error: ${err.message}`);
      return c.json({ error: "Search failed", code: "SEARCH_FAILED" }, 500);
    }
  });

  // ── GET /api/team/:teamId/status -- Team vault stats ──────────────────────

  api.get("/api/team/:teamId/status", async (c) => {
    const user = c.get("authUser");
    if (!hasScope(user.scopes ?? ["*"], "vault:read")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:read", code: "FORBIDDEN" },
        403,
      );
    }

    const { db } = c.get("ctx");
    const teamId = c.req.param("teamId");
    const errors = [];

    try {
      const kindRows = await queryAll(
        db,
        "SELECT kind, COUNT(*) as c FROM vault WHERE team_id = ? GROUP BY kind ORDER BY c DESC",
        [teamId],
      );
      const categoryRows = await queryAll(
        db,
        "SELECT category, COUNT(*) as c FROM vault WHERE team_id = ? GROUP BY category",
        [teamId],
      );

      const total = kindRows.reduce((sum, k) => sum + Number(k.c), 0);
      const by_kind = Object.fromEntries(
        kindRows.map((k) => [k.kind, Number(k.c)]),
      );
      const by_category = Object.fromEntries(
        categoryRows.map((k) => [k.category, Number(k.c)]),
      );

      return c.json({
        team_id: teamId,
        entries: { total, by_kind, by_category },
        health: errors.length === 0 ? "ok" : "degraded",
        errors,
      });
    } catch (err) {
      console.error(`[team-vault-api] Status error: ${err.message}`);
      errors.push(err.message);
      return c.json(
        {
          team_id: teamId,
          entries: { total: 0, by_kind: {}, by_category: {} },
          health: "degraded",
          errors,
        },
        500,
      );
    }
  });

  // ── POST /api/vault/publish -- Publish personal entry to team vault ───────

  api.post("/api/vault/publish", async (c) => {
    const user = c.get("authUser");
    if (!user) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    if (!hasScope(user.scopes ?? ["*"], "vault:write")) {
      return c.json(
        { error: "Insufficient scope. Required: vault:write", code: "FORBIDDEN" },
        403,
      );
    }

    const data = await c.req.json().catch(() => null);
    if (!data)
      return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    const { entryId, visibility, teamId } = data;

    if (!entryId) {
      return c.json(
        { error: "entryId is required", code: "INVALID_INPUT" },
        400,
      );
    }
    if (!visibility || !["team", "public"].includes(visibility)) {
      return c.json(
        { error: 'visibility must be "team" or "public"', code: "INVALID_INPUT" },
        400,
      );
    }
    if (visibility === "team" && !teamId) {
      return c.json(
        { error: "teamId is required for team visibility", code: "INVALID_INPUT" },
        400,
      );
    }

    // Verify team membership if publishing to a team
    if (visibility === "team") {
      const { db: checkDb } = c.get("ctx");
      const membership = await checkTeamMembership(checkDb, user.id, teamId);
      if (!membership.isMember) {
        return c.json(
          { error: "Not a member of this team", code: "FORBIDDEN" },
          403,
        );
      }
    }

    const { db, ai } = c.get("ctx");

    // Fetch the source entry (must belong to the user)
    const source = await queryOne(
      db,
      "SELECT * FROM vault WHERE id = ? AND user_id = ?",
      [entryId, user.id],
    );
    if (!source) {
      return c.json(
        { error: "Source entry not found", code: "NOT_FOUND" },
        404,
      );
    }

    try {
      // Copy the entry to the team vault with a new ID
      const id = await insertEntry(db, ai, {
        kind: source.kind,
        title: source.title,
        body: source.body,
        meta: source.meta ? JSON.parse(source.meta) : null,
        tags: source.tags ? JSON.parse(source.tags) : null,
        source: `published:${source.id}`,
        identity_key: source.identity_key,
        expires_at: source.expires_at,
        userId: user.id,
        teamId: visibility === "team" ? teamId : null,
      });

      const entry = await queryOne(db, "SELECT * FROM vault WHERE id = ?", [id]);
      return c.json(
        {
          published: true,
          sourceId: entryId,
          entry: formatEntry(entry),
        },
        201,
      );
    } catch (err) {
      console.error(`[team-vault-api] Publish error: ${err.message}`);
      return c.json(
        { error: "Failed to publish entry", code: "PUBLISH_FAILED" },
        500,
      );
    }
  });

  return api;
}
