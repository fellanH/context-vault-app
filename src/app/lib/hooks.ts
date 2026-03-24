import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { authClient } from "./auth-client";
import {
  transformEntry,
  transformSearchResult,
  transformUsage,
} from "./types";
import type {
  Entry,
  SearchResult,
  ApiKey,
  UsageResponse,
  ApiEntry,
  ApiSearchResult,
  ApiUsageResponse,
  ApiVaultStatusResponse,
  Category,
} from "./types";

// ─── Entries ─────────────────────────────────────────────────────────────────

interface UseEntriesOpts {
  category?: Category;
  kind?: string;
  offset?: number;
  limit?: number;
}

export function useEntries({
  category,
  kind,
  offset = 0,
  limit = 20,
}: UseEntriesOpts = {}) {
  return useQuery({
    queryKey: ["entries", { category, kind, offset, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (kind && kind !== "all") params.set("kind", kind);
      params.set("offset", String(offset));
      params.set("limit", String(limit));

      const raw = await api.get<{ entries: ApiEntry[]; total: number }>(
        `/vault/entries?${params}`,
      );
      return {
        entries: raw.entries.map(transformEntry),
        total: raw.total,
      };
    },
  });
}

export function useEntry(id: string | null) {
  return useQuery({
    queryKey: ["entry", id],
    queryFn: async () => {
      const raw = await api.get<ApiEntry>(`/vault/entries/${id}`);
      return transformEntry(raw);
    },
    enabled: !!id,
  });
}

export function useCreateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      kind: string;
      title: string;
      body: string;
      tags?: string[];
    }) => api.post<ApiEntry>("/vault/entries", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

export function useUpdateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      title?: string;
      body?: string;
      tags?: string[];
      source?: string;
    }) => api.put<ApiEntry>(`/vault/entries/${id}`, data),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["entry", id] });
    },
  });
}

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<{ deleted: boolean }>(`/vault/entries/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

// ─── Search ──────────────────────────────────────────────────────────────────

interface SearchOpts {
  query: string;
  category?: string;
  limit?: number;
}

export function useSearch() {
  return useMutation({
    mutationFn: async (opts: SearchOpts) => {
      const body: Record<string, unknown> = {
        query: opts.query,
        limit: opts.limit || 20,
      };
      if (opts.category && opts.category !== "all")
        body.category = opts.category;

      const raw = await api.post<{
        results: ApiSearchResult[];
        count: number;
        query: string;
      }>("/vault/search", body);
      return {
        results: raw.results.map(transformSearchResult),
        count: raw.count,
        query: raw.query,
      };
    },
  });
}

// ─── API Keys (better-auth apiKey plugin) ───────────────────────────────────

export function useApiKeys() {
  return useQuery({
    queryKey: ["apiKeys"],
    queryFn: async (): Promise<ApiKey[]> => {
      const { data, error } = await authClient.apiKey.list();
      if (error) throw new Error(error.message || "Failed to list API keys");
      const keys = data?.apiKeys ?? [];
      return keys.map((k: Record<string, unknown>) => ({
        id: k.id as string,
        name: (k.name as string) || "Unnamed",
        prefix: (k.prefix as string) || (k.id as string).slice(0, 8),
        scopes: Array.isArray((k.metadata as Record<string, unknown>)?.scopes)
          ? (k.metadata as Record<string, string[]>).scopes
          : ["*"],
        createdAt: new Date(k.createdAt as string),
        lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt as string) : undefined,
        expiresAt: k.expiresAt ? new Date(k.expiresAt as string) : undefined,
        requestCount: (k.requestCount as number) ?? 0,
        enabled: (k.enabled as boolean) ?? true,
      }));
    },
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      expires_at,
      scopes,
    }: {
      name: string;
      expires_at?: string;
      scopes?: string[];
    }) => {
      const opts: Record<string, unknown> = {
        name,
        metadata: { scopes: scopes || ["*"] },
      };
      if (expires_at) {
        const expiresMs = new Date(expires_at).getTime() - Date.now();
        if (expiresMs > 0) {
          opts.expiresIn = Math.floor(expiresMs / 1000);
        }
      }
      const { data, error } = await authClient.apiKey.create(
        opts as Parameters<typeof authClient.apiKey.create>[0],
      );
      if (error) throw new Error(error.message || "Failed to create API key");
      return {
        id: (data as Record<string, unknown>).id as string,
        key: (data as Record<string, unknown>).key as string,
        name: (data as Record<string, unknown>).name as string,
        prefix:
          ((data as Record<string, unknown>).prefix as string) ||
          ((data as Record<string, unknown>).key as string)?.slice(0, 12),
        scopes: scopes || ["*"],
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await authClient.apiKey.delete({ keyId: id });
      if (error) throw new Error(error.message || "Failed to delete API key");
      return { deleted: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });
}

// ─── Usage / Billing ─────────────────────────────────────────────────────────

export function useUsage() {
  const apiKeys = useApiKeys();

  return useQuery({
    queryKey: ["usage"],
    queryFn: async () => {
      const raw = await api.get<ApiUsageResponse>("/billing/usage");
      const keyCount = apiKeys.data?.length ?? 0;
      return transformUsage(raw, keyCount);
    },
  });
}

export function useRawUsage() {
  return useQuery({
    queryKey: ["rawUsage"],
    queryFn: () => api.get<ApiUsageResponse>("/billing/usage"),
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (opts?: {
      successUrl?: string;
      cancelUrl?: string;
      plan?: "pro_monthly" | "pro_annual" | "team";
    }) => api.post<{ url: string; sessionId: string }>("/billing/checkout", opts),
  });
}

export function usePortal() {
  return useMutation({
    mutationFn: (opts?: { returnUrl?: string }) =>
      api.post<{ url: string }>("/billing/portal", opts),
  });
}

// ─── Account ─────────────────────────────────────────────────────────────────

export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => api.del<{ deleted: boolean }>("/account"),
  });
}

// ─── Import / Export ─────────────────────────────────────────────────────────

export function useImportEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post<{ id: string }>("/vault/import", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

export interface ExportFilters {
  category?: string;
  kind?: string;
  since?: string;
  until?: string;
}

export function useExportVault(filters: ExportFilters = {}) {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.since) params.set("since", filters.since);
  if (filters.until) params.set("until", filters.until);
  const qs = params.toString();
  return useQuery({
    queryKey: ["export", filters],
    queryFn: () =>
      api.get<{ entries: ApiEntry[] }>(`/vault/export${qs ? `?${qs}` : ""}`),
    enabled: false, // manual trigger only
  });
}

// ─── Vault Status ────────────────────────────────────────────────────────────

interface VaultStatusOpts {
  enabled?: boolean;
  refetchInterval?:
    | number
    | false
    | ((query: { state: { status: string } }) => number | false);
}

export function useVaultStatus(opts: VaultStatusOpts = {}) {
  return useQuery({
    queryKey: ["vaultStatus"],
    queryFn: () => api.get<ApiVaultStatusResponse>("/vault/status"),
    ...opts,
  });
}

// ─── Teams / Organizations (better-auth organization plugin) ────────────────

interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  createdAt: string | Date;
  logo?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface OrgMember {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  createdAt: string | Date;
  user?: {
    id: string;
    email: string;
    name: string | null;
    image?: string | null;
  };
}

interface OrgInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | Date;
  inviterId?: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
  createdAt: Date;
}

export interface TeamMember {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  joinedAt: Date;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
}

export interface TeamDetail {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
  createdAt: Date;
  members: TeamMember[];
  invites: TeamInvite[];
}

export function useTeams() {
  return useQuery({
    queryKey: ["teams"],
    queryFn: async (): Promise<Team[]> => {
      const { data, error } = await authClient.organization.list();
      if (error) throw new Error(error.message || "Failed to list organizations");
      if (!data) return [];
      return (data as OrgListItem[]).map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: "member" as const, // list doesn't include role; will be refined in detail view
        createdAt: new Date(org.createdAt),
      }));
    },
  });
}

export function useTeam(id: string | null) {
  return useQuery({
    queryKey: ["team", id],
    queryFn: async (): Promise<TeamDetail> => {
      const { data, error } = await authClient.organization.getFullOrganization({
        query: { organizationId: id! },
      });
      if (error) throw new Error(error.message || "Failed to get organization");
      if (!data) throw new Error("Organization not found");

      const org = data as {
        id: string;
        name: string;
        slug: string;
        createdAt: string | Date;
        members: OrgMember[];
        invitations: OrgInvitation[];
      };

      // Find current user's role from members
      let myRole: "owner" | "admin" | "member" = "member";
      const session = await authClient.getSession();
      const myUserId = session.data?.user?.id;
      if (myUserId) {
        const me = org.members.find((m) => m.userId === myUserId);
        if (me) myRole = me.role as "owner" | "admin" | "member";
      }

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: myRole,
        createdAt: new Date(org.createdAt),
        members: org.members.map((m) => ({
          id: m.id,
          userId: m.userId,
          email: m.user?.email || "",
          name: m.user?.name || null,
          role: m.role as "owner" | "admin" | "member",
          joinedAt: new Date(m.createdAt),
        })),
        invites: (org.invitations || []).map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          status: inv.status,
          expiresAt: new Date(inv.expiresAt),
        })),
      };
    },
    enabled: !!id,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const { data, error } = await authClient.organization.create({
        name,
        slug,
      });
      if (error) throw new Error(error.message || "Failed to create organization");
      return {
        id: (data as OrgListItem).id,
        name: (data as OrgListItem).name,
        role: "owner",
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamId,
      email,
    }: {
      teamId: string;
      email: string;
    }) => {
      const { data, error } = await authClient.organization.inviteMember({
        email,
        role: "member",
        organizationId: teamId,
      });
      if (error) throw new Error(error.message || "Failed to invite member");
      const inv = data as OrgInvitation;
      return {
        id: inv.id,
        email: inv.email,
        expiresAt: String(inv.expiresAt),
      };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["team", vars.teamId] });
    },
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await authClient.organization.acceptInvitation({
        invitationId,
      });
      if (error) throw new Error(error.message || "Failed to accept invitation");
      return { joined: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamId,
      memberId,
    }: {
      teamId: string;
      memberId: string;
    }) => {
      const { error } = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: teamId,
      });
      if (error) throw new Error(error.message || "Failed to remove member");
      return { removed: true };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["team", vars.teamId] });
    },
  });
}

// ─── Team Vault ─────────────────────────────────────────────────────────────

interface UseTeamEntriesOpts {
  teamId: string | null;
  category?: Category;
  kind?: string;
  offset?: number;
  limit?: number;
}

export function useTeamEntries({
  teamId,
  category,
  kind,
  offset = 0,
  limit = 20,
}: UseTeamEntriesOpts) {
  return useQuery({
    queryKey: ["teamEntries", teamId, { category, kind, offset, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (kind && kind !== "all") params.set("kind", kind);
      params.set("offset", String(offset));
      params.set("limit", String(limit));

      const raw = await api.get<{ entries: ApiEntry[]; total: number }>(
        `/team/${teamId}/entries?${params}`,
      );
      return {
        entries: raw.entries.map(transformEntry),
        total: raw.total,
      };
    },
    enabled: !!teamId,
  });
}

interface TeamSearchOpts {
  teamId: string;
  query: string;
  category?: string;
  kind?: string;
  limit?: number;
}

export function useTeamSearch() {
  return useMutation({
    mutationFn: async ({ teamId, query, category, kind, limit }: TeamSearchOpts) => {
      const body: Record<string, unknown> = {
        query,
        limit: limit || 20,
      };
      if (category && category !== "all") body.category = category;
      if (kind && kind !== "all") body.kind = kind;

      const raw = await api.post<{
        results: ApiSearchResult[];
        count: number;
        query: string;
      }>(`/team/${teamId}/search`, body);
      return {
        results: raw.results.map(transformSearchResult),
        count: raw.count,
        query: raw.query,
      };
    },
  });
}

interface TeamVaultStatus {
  team_id: string;
  entries: {
    total: number;
    by_kind: Record<string, number>;
    by_category: Record<string, number>;
  };
  health: "ok" | "degraded";
  errors: string[];
}

export function useTeamVaultStatus(teamId: string | null) {
  return useQuery({
    queryKey: ["teamVaultStatus", teamId],
    queryFn: () => api.get<TeamVaultStatus>(`/team/${teamId}/status`),
    enabled: !!teamId,
  });
}

export function usePublishEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entryId,
      teamId,
      force,
    }: {
      entryId: string;
      teamId: string;
      force?: boolean;
    }) => {
      return api.post<{ published: boolean; sourceId: string; entry: ApiEntry }>(
        "/vault/publish",
        { entryId, visibility: "team", teamId, ...(force ? { force: true } : {}) },
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["teamEntries", vars.teamId] });
      qc.invalidateQueries({ queryKey: ["teamVaultStatus", vars.teamId] });
    },
  });
}

export function useUnpublishEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamId,
      entryId,
    }: {
      teamId: string;
      entryId: string;
    }) => {
      return api.del<{ deleted: boolean }>(`/team/${teamId}/entries/${entryId}`);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["teamEntries", vars.teamId] });
      qc.invalidateQueries({ queryKey: ["teamVaultStatus", vars.teamId] });
    },
  });
}
