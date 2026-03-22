/**
 * auth.js -- better-auth instance for Cloudflare Workers.
 *
 * Uses Kysely with @libsql/kysely-libsql dialect to connect to Turso.
 * Configures email/password + GitHub social login.
 * Organization and API key plugins enabled.
 *
 * The auth instance is created per-request since Workers are stateless.
 * Schema migrations run lazily on first request.
 */

import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { LibsqlDialect } from "@libsql/kysely-libsql";

let migrationDone = false;

/**
 * Create the better-auth instance for a Workers request.
 *
 * @param {object} env - Workers env bindings
 * @returns {Promise<ReturnType<typeof betterAuth>>}
 */
export async function createAuth(env) {
  const dialect = new LibsqlDialect({
    url: env.TURSO_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });

  const baseURL = env.API_URL || env.BETTER_AUTH_URL || "http://localhost:8787";

  const auth = betterAuth({
    database: { dialect, type: "sqlite" },
    baseURL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,

    emailAndPassword: {
      enabled: true,
    },

    socialProviders: {
      ...(env.GITHUB_CLIENT_ID && {
        github: {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
        },
      }),
    },

    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
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

    plugins: [
      organization({
        membershipLimit: 50,
        invitationExpiresIn: 7 * 24 * 60 * 60,
        allowUserToCreateOrganization: true,
      }),
      apiKey(),
    ],
  });

  // Run schema migrations lazily (once per Worker instance)
  if (!migrationDone) {
    try {
      const { getMigrations } = await import("better-auth/db/migration");
      const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(
        auth.options,
      );
      if (toBeCreated.length > 0 || toBeAdded.length > 0) {
        console.log(
          `[auth] Migrating: ${toBeCreated.length} tables, ${toBeAdded.length} columns`,
        );
        await runMigrations();
      }
      migrationDone = true;
    } catch (e) {
      console.error("[auth] Migration error:", e.message);
      migrationDone = true;
    }
  }

  return auth;
}
