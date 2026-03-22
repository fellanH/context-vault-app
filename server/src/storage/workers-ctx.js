/**
 * workers-ctx.js -- Per-request context factory for Cloudflare Workers.
 *
 * Creates the context object that routes and middleware use to access
 * Turso (database), R2 (file storage), Workers AI (embeddings), and config.
 *
 * The Turso client is created once per request from env bindings.
 * Schema initialization is lazy (first request triggers it).
 */

import { createTursoClient, initSchemas } from "./turso.js";

let schemasInitialized = false;

/**
 * Create the per-request context from Workers env bindings.
 *
 * @param {object} env - Cloudflare Workers env bindings
 * @returns {Promise<object>} Context with db, r2, ai, config
 */
export async function createWorkerCtx(env) {
  const db = createTursoClient(env.TURSO_URL, env.TURSO_AUTH_TOKEN);

  // Lazy schema init (runs once per Worker instance lifecycle)
  if (!schemasInitialized) {
    await initSchemas(db);
    schemasInitialized = true;
  }

  return {
    db,
    r2: {
      private: env.R2_PRIVATE,
      teams: env.R2_TEAMS,
      public: env.R2_PUBLIC,
    },
    ai: env.AI,
    config: {
      authRequired: env.AUTH_REQUIRED === "true",
      appUrl: env.APP_URL || "https://app.context-vault.com",
      apiUrl: env.API_URL || "https://api.context-vault.com",
      corsOrigin: env.CORS_ORIGIN || "",
      vaultMasterSecret: env.VAULT_MASTER_SECRET || null,
    },
    env,
  };
}

/**
 * Generate an embedding vector using Cloudflare Workers AI.
 *
 * @param {object} ai - Workers AI binding
 * @param {string} text - Text to embed
 * @returns {Promise<Float32Array|null>} 384-dim embedding or null if AI unavailable
 */
export async function embed(ai, text) {
  if (!ai) return null;
  try {
    const result = await ai.run("@cf/baai/bge-small-en-v1.5", {
      text: [text],
    });
    if (result?.data?.[0]) {
      return new Float32Array(result.data[0]);
    }
    return null;
  } catch (e) {
    console.error("[embed] Workers AI error:", e.message);
    return null;
  }
}

/**
 * Generate a ULID-like ID.
 * Uses crypto.getRandomValues for randomness.
 *
 * @returns {string} 26-char ULID
 */
export function ulid() {
  const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const now = Date.now();
  let id = "";

  // Timestamp (10 chars, 48 bits)
  let ts = now;
  for (let i = 9; i >= 0; i--) {
    id = ENCODING[ts % 32] + id;
    ts = Math.floor(ts / 32);
  }

  // Randomness (16 chars, 80 bits)
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 10; i++) {
    id += ENCODING[bytes[i] % 32];
  }

  return id;
}
