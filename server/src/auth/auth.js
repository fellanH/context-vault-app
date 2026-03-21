/**
 * auth.js — better-auth instance for the hosted server.
 *
 * Configures email/password + GitHub social login.
 * Uses better-sqlite3 for a dedicated auth database.
 * Mounted on Hono at /api/auth/*.
 */

import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Create and initialize the better-auth instance.
 * Runs schema migrations on first call (creates tables if needed).
 *
 * @param {string} dataDir - Data directory (from resolved config)
 * @returns {Promise<ReturnType<typeof betterAuth>>}
 */
export async function createAuth(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const authDbPath = join(dataDir, "auth.db");

  const db = new Database(authDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const baseURL =
    process.env.BETTER_AUTH_URL ||
    process.env.API_URL ||
    "http://localhost:3000";

  const auth = betterAuth({
    database: db,
    baseURL,
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET,

    emailAndPassword: {
      enabled: true,
    },

    socialProviders: {
      ...(process.env.GITHUB_CLIENT_ID && {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
        },
      }),
    },

    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },

    user: {
      additionalFields: {
        tier: {
          type: "string",
          defaultValue: "free",
          required: false,
        },
        stripeCustomerId: {
          type: "string",
          required: false,
        },
      },
    },

    advanced: {
      // Use defaults for ID generation
    },
  });

  // Run schema migrations (creates tables on first run, adds columns on upgrade)
  const { getMigrations } = await import("better-auth/db/migration");
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(
    auth.options,
  );
  if (toBeCreated.length > 0 || toBeAdded.length > 0) {
    console.log(
      `[auth] Running migrations: ${toBeCreated.length} tables to create, ${toBeAdded.length} columns to add`,
    );
    await runMigrations();
    console.log("[auth] Migrations complete");
  }

  console.log(`[auth] better-auth initialized (db: ${authDbPath})`);

  return auth;
}
