/**
 * @context-vault/hosted -- Cloudflare Workers entry point.
 *
 * Hono HTTP server with:
 *   - better-auth at /api/auth/* (email/password + GitHub + Google + orgs + API keys)
 *   - Vault REST API at /api/vault/* (CRUD + search via Turso)
 *   - Management API at /api/* (billing, teams, account)
 *   - Workers AI for embeddings
 *   - R2 for file storage
 *   - Turso (libSQL) for all database access
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { createAuth } from "./auth/auth.js";
import { vaultAuth } from "./middleware/auth.js";
import { vaultDbRouting } from "./middleware/vault-db.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { requestLogger } from "./middleware/logger.js";
import { createWorkerCtx } from "./storage/workers-ctx.js";
import { createManagementRoutes } from "./server/management.js";
import { createVaultApiRoutes } from "./routes/vault-api.js";
import { createTeamVaultApiRoutes } from "./routes/team-vault-api.js";
import { createPublicVaultApiRoutes } from "./routes/public-vault-api.js";

const VERSION = "0.2.0";

const app = new Hono();

// ─── Global error handler ────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error(
    JSON.stringify({
      level: "error",
      requestId: c.get("requestId") || null,
      method: c.req.method,
      path: c.req.path,
      error: err.message,
      ts: new Date().toISOString(),
    }),
  );
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

// ─── Global middleware ───────────────────────────────────────────────────────

app.use("*", secureHeaders());
app.use("*", bodyLimit({ maxSize: 512 * 1024 }));
app.use("*", requestLogger());

// CORS -- configured per-request from env bindings
app.use("*", async (c, next) => {
  const env = c.env;
  const authRequired = env.AUTH_REQUIRED === "true";
  const corsOrigin = authRequired
    ? env.CORS_ORIGIN
      ? env.CORS_ORIGIN.split(",").map((s) => s.trim())
      : []
    : (origin) => origin || null;

  return cors({
    origin: corsOrigin,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Vault-Secret"],
    exposeHeaders: [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
  })(c, next);
});

// ─── Per-request context injection ───────────────────────────────────────────

app.use("*", async (c, next) => {
  const ctx = await createWorkerCtx(c.env);
  c.set("ctx", ctx);
  await next();
});

// ─── better-auth routes ──────────────────────────────────────────────────────

app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  const auth = await createAuth(c.env);
  return auth.handler(c.req.raw);
});

// Session middleware -- injects authUser/authSession for downstream routes
app.use("*", async (c, next) => {
  try {
    const auth = await createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("authUser", session?.user || null);
    c.set("authSession", session?.session || null);
  } catch {
    c.set("authUser", null);
    c.set("authSession", null);
  }
  await next();
});

// ─── Health check ────────────────────────────────────────────────────────────

app.get("/health", async (c) => {
  const ctx = c.get("ctx");
  const checks = {
    status: "ok",
    version: VERSION,
    auth: ctx.config.authRequired,
    runtime: "cloudflare-workers",
    colo: c.req.raw.cf?.colo || "unknown",
  };

  // Test Turso connectivity
  try {
    await ctx.db.execute("SELECT 1");
    checks.turso = "ok";
  } catch {
    checks.turso = "error";
    checks.status = "degraded";
  }

  const statusCode = checks.status === "ok" ? 200 : 503;
  return c.json(checks, statusCode);
});

// ─── Management REST API ─────────────────────────────────────────────────────

app.route("/", createManagementRoutes());

// ─── Vault REST API ──────────────────────────────────────────────────────────

app.use("/api/vault/*", vaultAuth());
app.use("/api/vault/*", rateLimit());
app.use("/api/vault/*", vaultDbRouting());
app.route("/", createVaultApiRoutes());

// ─── Team Vault REST API ────────────────────────────────────────────────────

app.use("/api/team/*", vaultAuth());
// Team vaults use the shared DB (team_id isolation), not per-user DBs
app.route("/", createTeamVaultApiRoutes());

// ─── Public Vault REST API ───────────────────────────────────────────────────

// Public read endpoints need no auth; curator endpoints use vaultAuth internally
app.route("/", createPublicVaultApiRoutes());

// ─── Root redirect ───────────────────────────────────────────────────────────

app.get("/", (c) => {
  const appURL = c.env.APP_URL || "https://app.context-vault.com";
  return c.redirect(appURL, 302);
});

// ─── Workers export ──────────────────────────────────────────────────────────

export default {
  fetch: app.fetch,
};
