/**
 * schemas.js — Zod schemas with OpenAPI metadata for vault REST API.
 *
 * Used by @hono/zod-openapi for both runtime validation and spec generation.
 * Single source of truth — no drift between validation and documentation.
 */

import { z } from "@hono/zod-openapi";

// ─── Shared Components ──────────────────────────────────────────────────────

export const EntrySchema = z
  .object({
    id: z.string().openapi({ example: "01JKLMNPQR5678ABCDEF" }),
    kind: z.string().openapi({ example: "insight" }),
    category: z
      .enum(["knowledge", "entity", "event"])
      .openapi({ example: "knowledge" }),
    title: z
      .string()
      .nullable()
      .openapi({ example: "Hybrid search outperforms FTS alone" }),
    body: z
      .string()
      .nullable()
      .openapi({ example: "When combining FTS5 with vector similarity..." }),
    tags: z.array(z.string()).openapi({ example: ["search", "architecture"] }),
    meta: z.record(z.string(), z.any()).openapi({ example: {} }),
    source: z.string().nullable().openapi({ example: "claude-code" }),
    identity_key: z.string().nullable().openapi({ example: null }),
    expires_at: z.string().nullable().openapi({ example: null }),
    created_at: z.string().openapi({ example: "2026-02-15T10:30:00Z" }),
  })
  .openapi("Entry");

export const SearchResultSchema = EntrySchema.extend({
  score: z.number().openapi({ example: 0.847 }),
}).openapi("SearchResult");

export const ErrorSchema = z
  .object({
    error: z.string().openapi({ example: "Entry not found" }),
    code: z.string().openapi({ example: "NOT_FOUND" }),
  })
  .openapi("Error");

// ─── Request Schemas ────────────────────────────────────────────────────────

export const CreateEntrySchema = z
  .object({
    kind: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(64)
      .openapi({
        description:
          "Entry kind — determines category and folder. Use lowercase alphanumeric with hyphens.",
        example: "insight",
      }),
    body: z.string().max(102400).openapi({
      description: "Main content of the entry (max 100KB).",
      example:
        "Hybrid search combining FTS5 with vector similarity consistently outperforms either alone.",
    }),
    title: z.string().max(500).optional().openapi({
      description: "Optional title for the entry.",
      example: "Hybrid search outperforms FTS alone",
    }),
    tags: z
      .array(z.string().max(100))
      .max(20)
      .optional()
      .openapi({
        description: "Tags for categorization and filtering (max 20).",
        example: ["search", "architecture"],
      }),
    meta: z
      .record(z.string(), z.any())
      .optional()
      .openapi({
        description: "Additional structured metadata (JSON object, max 10KB).",
        example: { confidence: "high" },
      }),
    source: z.string().max(200).optional().openapi({
      description: "Where this knowledge came from.",
      example: "claude-code",
    }),
    identity_key: z.string().max(200).optional().openapi({
      description:
        "Required for entity kinds (contact, project, tool). Unique identifier for upsert.",
      example: "context-vault",
    }),
    expires_at: z.string().optional().openapi({
      description:
        "ISO date for TTL expiry. Entry is excluded from search after this date.",
      example: "2026-12-31T23:59:59Z",
    }),
  })
  .openapi("CreateEntry");

export const UpdateEntrySchema = z
  .object({
    title: z
      .string()
      .max(500)
      .optional()
      .openapi({ description: "New title (omit to keep existing)." }),
    body: z
      .string()
      .max(102400)
      .optional()
      .openapi({ description: "New body content (omit to keep existing)." }),
    tags: z
      .array(z.string().max(100))
      .max(20)
      .optional()
      .openapi({ description: "New tags array (replaces existing)." }),
    meta: z
      .record(z.string(), z.any())
      .optional()
      .openapi({ description: "Metadata to shallow-merge with existing." }),
    source: z
      .string()
      .max(200)
      .optional()
      .openapi({ description: "New source attribution." }),
    expires_at: z
      .string()
      .optional()
      .openapi({ description: "New expiry date (ISO format)." }),
  })
  .openapi("UpdateEntry");

export const SearchQuerySchema = z
  .object({
    query: z.string().min(1).openapi({
      description:
        "Natural language search query. Searched via hybrid FTS5 + vector similarity.",
      example: "how does caching work",
    }),
    kind: z
      .string()
      .optional()
      .openapi({ description: "Filter results to a specific kind." }),
    category: z
      .enum(["knowledge", "entity", "event"])
      .optional()
      .openapi({ description: "Filter results to a category." }),
    since: z.string().optional().openapi({
      description: "ISO date — only return entries created after this.",
    }),
    until: z.string().optional().openapi({
      description: "ISO date — only return entries created before this.",
    }),
    limit: z.number().int().min(1).max(100).optional().openapi({
      description: "Max results (default 20, max 100).",
      example: 20,
    }),
    offset: z.number().int().min(0).optional().openapi({
      description: "Skip first N results for pagination.",
      example: 0,
    }),
  })
  .openapi("SearchQuery");

// ─── Response Schemas ───────────────────────────────────────────────────────

export const EntryListSchema = z
  .object({
    entries: z.array(EntrySchema),
    total: z.number().openapi({ example: 42 }),
    limit: z.number().openapi({ example: 20 }),
    offset: z.number().openapi({ example: 0 }),
  })
  .openapi("EntryList");

export const SearchResponseSchema = z
  .object({
    results: z.array(SearchResultSchema),
    count: z.number().openapi({ example: 5 }),
    query: z.string().openapi({ example: "how does caching work" }),
  })
  .openapi("SearchResponse");

export const DeleteResponseSchema = z
  .object({
    deleted: z.boolean().openapi({ example: true }),
    id: z.string().openapi({ example: "01JKLMNPQR5678ABCDEF" }),
    kind: z.string().openapi({ example: "insight" }),
    title: z
      .string()
      .nullable()
      .openapi({ example: "Cache invalidation strategy" }),
  })
  .openapi("DeleteResponse");

// ─── Public Vault Schemas ──────────────────────────────────────────────────

export const PublicVaultSchema = z
  .object({
    id: z.string().openapi({ example: "01JKLMNPQR5678ABCDEF" }),
    slug: z.string().openapi({ example: "react-patterns" }),
    name: z.string().openapi({ example: "React Patterns" }),
    description: z
      .string()
      .nullable()
      .openapi({ example: "Battle-tested React patterns from production apps" }),
    curator_id: z.string().openapi({ example: "user_abc123" }),
    visibility: z.enum(["free", "pro"]).openapi({ example: "free" }),
    domain_tags: z
      .array(z.string())
      .openapi({ example: ["react", "frontend"] }),
    consumer_count: z.number().openapi({ example: 42 }),
    total_recalls: z.number().openapi({ example: 1500 }),
    created_at: z.string().openapi({ example: "2026-03-01T10:00:00Z" }),
    updated_at: z.string().nullable().openapi({ example: "2026-03-15T14:30:00Z" }),
  })
  .openapi("PublicVault");

export const CreatePublicVaultSchema = z
  .object({
    name: z.string().min(1).max(200).openapi({
      description: "Display name for the public vault.",
      example: "React Patterns",
    }),
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/)
      .openapi({
        description:
          "URL-friendly identifier (3-64 chars, lowercase alphanumeric + hyphens).",
        example: "react-patterns",
      }),
    description: z.string().max(2000).optional().openapi({
      description: "Short description of the vault's purpose and content.",
      example: "Battle-tested React patterns from production apps",
    }),
    visibility: z.enum(["free", "pro"]).optional().openapi({
      description: 'Access level for consumers. "free" = no auth for reads (default).',
      example: "free",
    }),
    domain_tags: z
      .array(z.string().max(50))
      .max(10)
      .optional()
      .openapi({
        description: "Domain tags for directory browsing and filtering (max 10).",
        example: ["react", "frontend", "typescript"],
      }),
  })
  .openapi("CreatePublicVault");

export const PublicVaultListSchema = z
  .object({
    vaults: z.array(PublicVaultSchema),
    total: z.number().openapi({ example: 15 }),
    limit: z.number().openapi({ example: 20 }),
    offset: z.number().openapi({ example: 0 }),
  })
  .openapi("PublicVaultList");

export const PublicEntrySchema = EntrySchema.extend({
  recall_count: z.number().openapi({ example: 25 }),
  distinct_consumers: z.number().openapi({ example: 8 }),
  status: z.enum(["active", "deprecated", "hidden"]).openapi({ example: "active" }),
  is_evergreen: z.boolean().openapi({ example: false }),
}).openapi("PublicEntry");

export const PublicVaultStatsSchema = z
  .object({
    slug: z.string().openapi({ example: "react-patterns" }),
    entry_count: z.number().openapi({ example: 150 }),
    total_recalls: z.number().openapi({ example: 1500 }),
    consumer_count: z.number().openapi({ example: 42 }),
    by_kind: z.record(z.string(), z.number()).openapi({ example: { insight: 80, pattern: 45 } }),
    top_entries: z.array(
      z.object({
        id: z.string(),
        title: z.string().nullable(),
        kind: z.string(),
        recall_count: z.number(),
        distinct_consumers: z.number(),
      }),
    ),
  })
  .openapi("PublicVaultStats");

export const SeedResponseSchema = z
  .object({
    seeded: z.number().openapi({ example: 25 }),
    skipped: z.number().openapi({ example: 3 }),
    total_matched: z.number().openapi({ example: 28 }),
    errors: z
      .array(z.object({ id: z.string(), error: z.string() }))
      .optional(),
  })
  .openapi("SeedResponse");

export const VaultStatusSchema = z
  .object({
    entries: z.object({
      total: z.number(),
      by_kind: z.record(z.string(), z.number()),
      by_category: z.record(z.string(), z.number()),
    }),
    files: z.object({
      total: z.number(),
      directories: z.array(z.object({ name: z.string(), count: z.number() })),
    }),
    database: z.object({
      size: z.string(),
      size_bytes: z.number(),
      stale_paths: z.number(),
      expired: z.number(),
    }),
    embeddings: z
      .object({
        indexed: z.number(),
        total: z.number(),
        missing: z.number(),
      })
      .nullable(),
    embed_model_available: z.boolean().nullable(),
    health: z.enum(["ok", "degraded"]),
    errors: z.array(z.string()),
  })
  .openapi("VaultStatus");
