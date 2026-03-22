export type Category = "knowledge" | "entity" | "event";
export type KnowledgeKind = "insight" | "decision" | "pattern" | "reference";
export type EntityKind = "project" | "contact" | "tool";
export type EventKind = "session" | "log";

export type BillingTier = "free" | "pro" | "team";

// ─── Frontend types (used by components) ─────────────────────────────────────

export type EntryVisibility = "private" | "team" | "public";

export interface Entry {
  id: string;
  category: Category;
  kind: KnowledgeKind | EntityKind | EventKind;
  title: string;
  body: string;
  tags: string[];
  source?: string;
  created: Date;
  updated: Date;
  metadata?: Record<string, unknown>;
  // Recall tracking (optional; API may not yet return these fields)
  recallCount?: number;
  recallSessions?: number;
  lastRecalledAt?: Date;
  // Visibility / team sharing
  teamId?: string;
  teamName?: string;
  visibility: EntryVisibility;
}

export interface SearchResult extends Entry {
  score: number;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  tier: BillingTier;
  createdAt: Date;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
}

export interface UsageResponse {
  entries: { used: number; limit: number };
  storage: { usedMb: number; limitMb: number };
  requestsToday: { used: number; limit: number };
  requestsThisWeek: { used: number };
  apiKeys: { active: number; limit: number };
}

export interface OnboardingStep {
  id: string;
  label: string;
  completed: boolean;
  description?: string;
  action?: string;
  actionLabel?: string;
}

// ─── API response types (match backend shapes exactly) ───────────────────────

export interface ApiEntry {
  id: string;
  kind: string;
  category: string;
  title: string | null;
  body: string | null;
  tags: string[];
  meta: Record<string, unknown>;
  source: string | null;
  identity_key: string | null;
  expires_at: string | null;
  created_at: string;
  // Recall tracking (optional; API may not yet return these fields)
  recall_count?: number;
  recall_sessions?: number;
  last_recalled_at?: string | null;
  // Visibility / team sharing
  team_id?: string | null;
  team_name?: string | null;
  is_public?: boolean;
}

export interface ApiSearchResult extends ApiEntry {
  score: number;
}

export interface ApiKeyListItem {
  id: string;
  key_prefix: string;
  name: string;
  scopes: string;
  created_at: string;
  last_used?: string | null;
  expires_at?: string | null;
}

export interface ApiVaultStatusResponse {
  entries: {
    total: number;
    by_kind: Record<string, number>;
    by_category: Record<string, number>;
  };
  files: {
    total: number;
    directories: number;
  };
  database: {
    size: string;
    size_bytes: number;
    stale_paths: number;
    expired: number;
  };
  embeddings: Record<string, unknown>;
  embed_model_available: boolean;
  health: "ok" | "degraded";
  errors: string[];
}

export interface ApiUsageResponse {
  tier: BillingTier;
  limits: {
    maxEntries: number | "unlimited";
    requestsPerDay: number | "unlimited";
    storageMb: number;
    exportEnabled: boolean;
  };
  usage: {
    requestsToday: number;
    requestsThisWeek: number;
    entriesUsed: number;
    storageMb: number;
  };
}

// ─── Team types (now served by better-auth organization plugin) ──────────────
// Team/org types are defined in hooks.ts alongside the hooks that use them.

export interface ApiRegisterResponse {
  userId: string;
  email: string;
  tier: BillingTier;
  apiKey: {
    id: string;
    key: string;
    prefix: string;
    message: string;
  };
  encryptionSecret?: string | null;
}

export interface ApiUserResponse {
  userId: string;
  email: string;
  name: string | null;
  tier: BillingTier;
  createdAt: string;
}

// ─── Transformers ────────────────────────────────────────────────────────────

export function transformEntry(raw: ApiEntry): Entry {
  const visibility: EntryVisibility = raw.is_public
    ? "public"
    : raw.team_id
      ? "team"
      : "private";

  return {
    id: raw.id,
    category: raw.category as Category,
    kind: raw.kind as Entry["kind"],
    title: raw.title || "",
    body: raw.body || "",
    tags: raw.tags || [],
    source: raw.source || undefined,
    created: new Date(raw.created_at),
    updated: new Date(raw.created_at), // backend doesn't track updated separately
    metadata:
      raw.meta && Object.keys(raw.meta).length > 0 ? raw.meta : undefined,
    recallCount: raw.recall_count ?? undefined,
    recallSessions: raw.recall_sessions ?? undefined,
    lastRecalledAt: raw.last_recalled_at
      ? new Date(raw.last_recalled_at)
      : undefined,
    teamId: raw.team_id || undefined,
    teamName: raw.team_name || undefined,
    visibility,
  };
}

export function transformSearchResult(raw: ApiSearchResult): SearchResult {
  return {
    ...transformEntry(raw),
    score: raw.score,
  };
}

// API keys are now fetched via better-auth's apiKey plugin in hooks.ts

export function transformUsage(
  raw: ApiUsageResponse,
  apiKeyCount: number,
): UsageResponse {
  const numOrMax = (v: number | "unlimited") =>
    v === "unlimited" ? Infinity : v;

  return {
    entries: {
      used: raw.usage.entriesUsed,
      limit: numOrMax(raw.limits.maxEntries),
    },
    storage: {
      usedMb: raw.usage.storageMb,
      limitMb: raw.limits.storageMb,
    },
    requestsToday: {
      used: raw.usage.requestsToday,
      limit: numOrMax(raw.limits.requestsPerDay),
    },
    requestsThisWeek: {
      used: raw.usage.requestsThisWeek ?? 0,
    },
    apiKeys: {
      active: apiKeyCount,
      limit: Infinity, // not tracked in usage response
    },
  };
}

// ─── API Key Activity ─────────────────────────────────────────────────────────

export interface ApiKeyActivityItem {
  operation: string;
  timestamp: string;
  status: string;
}

export interface ApiKeyActivityResponse {
  logs: ApiKeyActivityItem[];
  total: number;
  limit: number;
  offset: number;
}

export function transformUser(raw: ApiUserResponse): User {
  return {
    id: raw.userId,
    email: raw.email,
    name: raw.name || undefined,
    tier: raw.tier,
    createdAt: new Date(raw.createdAt),
  };
}
