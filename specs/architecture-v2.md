# Context Vault App — Architecture v2

Phase 1 decisions for the hosted product. This document supplements `architecture.md` (which remains the source of truth for the existing stack and deploy setup).

---

## Decision 1: Auth Provider

### Recommendation: better-auth

**Not Clerk. Not Supabase Auth.**

better-auth is an MIT-licensed TypeScript auth library that runs in-process on the Hono backend. All user data lives in our own database.

### Why better-auth over Clerk

| Concern | Clerk | better-auth |
|---------|-------|-------------|
| Org/team primitives | Built-in, prebuilt UI | Built-in via Organization plugin, bring your own UI |
| API key management | Public beta (Dec 2025), M2M tokens now charged per-use | Mature plugin, free |
| SSO (SAML/OIDC) | $75/connection on Pro plan | Free, in-process |
| Hono integration | Third-party middleware | First-class, documented |
| Lock-in | High: user data in Clerk cloud, proprietary JWT claims | None: MIT, data in our DB |
| Cost at 500 users + 2 SSO | ~$75/mo | $0 |
| Cost at 5K users + 5 SSO | ~$675/mo | $0 |

Clerk's prebuilt `<OrganizationProfile />` and `<OrganizationSwitcher />` components save UI work, but we already have shadcn/ui and will build custom team management screens anyway. The M2M token pricing change (March 2026, 30 days notice) is exactly the kind of surprise we avoid by owning the auth stack.

### Why better-auth over Supabase Auth

Supabase Auth has zero team/org primitives. Building team management, invites, roles, and member access on top of raw Supabase Auth is a 1-2 week detour. Their SSO requires the $599/mo Team plan. Since our backend is Hono on Fly.io (not a Supabase project), we lose the main value-add (Row Level Security) anyway.

### What better-auth gives us

- Email + social login (Google, GitHub) out of the box
- Organization plugin: create teams, invite by email, roles (owner/admin/member), custom roles, configurable member limits
- API keys plugin: named keys with expiration, scoping, rate limiting, middleware verification
- SSO plugin: SAML 2.0 + OIDC at zero cost
- Session management with JWT or cookie-based auth
- All data in our own database (same Turso instance as the app, or a dedicated auth DB)
- First-class Hono integration: mount at `/api/auth/*`, session middleware, done

### Setup estimate

1-2 days to wire up: auth routes on Hono, social providers, organization plugin, API keys plugin, basic auth UI with shadcn components.

### Auth data model

```
users
  id, email, name, image, created_at

sessions
  id, user_id, token, expires_at

accounts  (social providers)
  id, user_id, provider, provider_account_id

organizations
  id, name, slug, created_at

members
  id, user_id, organization_id, role (owner|admin|member)

invitations
  id, organization_id, email, role, status, invited_by

api_keys
  id, user_id, name, key_hash, scopes, expires_at, last_used_at
```

---

## Decision 2: R2 Bucket Strategy

### Recommendation: Three buckets, path-isolated within each

```
cv-private     /users/{userId}/entries/{entryId}.md
cv-teams       /teams/{teamId}/entries/{entryId}.md
cv-public      /entries/{entryId}.md
```

### Why three buckets (not one, not per-user)

| Option | Verdict | Reason |
|--------|---------|--------|
| One bucket per user/team | Rejected | Provisioning overhead on signup, thousands of buckets to manage, no practical security benefit (R2 lacks per-prefix token restriction anyway) |
| Single shared bucket | Rejected | Private and public data in the same bucket is a weak trust story for a product selling data ownership. One misconfigured `listObjects` exposes everything. |
| **Three buckets** | **Chosen** | Maps directly to three-tier model. Each bucket gets its own Cloudflare Access policy. `cv-public` can be CDN-cached or given a public URL independently. No per-user provisioning. |

### Access control

R2 does not support per-prefix API token restrictions. All access control is enforced at the application layer (the Hono API). Clients never get direct R2 access. Presigned URLs can be scoped to a specific prefix if we later add direct upload for large files.

### Cost

Vault entries are small (a few KB each). A power user with 1,000 entries = ~2-5 MB. At 10K users: ~30 GB total across all three buckets.

- Storage: $0.015/GB/month = ~$0.45/month
- Operations: $4.50/million writes, $0.36/million reads
- Egress: $0 (R2 has zero egress fees)

R2 cost is negligible at any foreseeable scale.

---

## Decision 3: Database Architecture

### Recommendation: Turso (libSQL, per-tenant databases)

One Turso database per user, per team, and one for the public index.

### Why Turso

The core product uses SQLite FTS5 + `sqlite-vec` for hybrid search (semantic embeddings + full-text). The hosted database must support both. Here is how the options compare:

| Option | FTS5 | Vector search | Migration effort | Cost (10K users) | Verdict |
|--------|------|---------------|-----------------|-------------------|---------|
| Cloudflare D1 | Yes, but export bug (#9519) breaks backup | No native support, requires Vectorize sidecar | Medium | ~$30/mo + Vectorize | Rejected: FTS5 backup bug is a production blocker |
| Fly.io Postgres | Own FTS (tsvector), not SQLite FTS5 | pgvector works | High: full query layer rewrite | ~$38/mo base + scale | Rejected: migration cost too high |
| SQLite on Fly volumes | Full support | Full support (sqlite-vec) | Zero | ~$800/mo (compute + volumes) | Viable but operationally expensive |
| **Turso (libSQL)** | Full FTS5 support | Native `F32_BLOB` + `vector_distance_cos` | Low: driver swap + vector query syntax | ~$150/mo (Scaler) | **Chosen** |

### Turso specifics

- **Pricing**: Developer plan $4.99/mo covers 500 active databases. Scaler at $24.92/mo covers 2,500 active DBs with $0.05 per additional active DB. At 10K users with 5K monthly active: ~$150/mo.
- **Per-tenant isolation**: each user gets their own database. No row-level security needed. Creating a DB is one API call.
- **Point-in-time restore**: built-in (1 day on Developer, up to 90 days on Pro). We do not own the backup story.
- **Edge replication**: databases can be replicated near the user for low-latency reads.
- **libSQL compatibility**: the `@libsql/client` package is the drop-in for the hosted tier. The core engine abstracts DB access through `context.ts`; swapping the driver is an adapter layer, not a rewrite.

### Vector search adaptation

The one required change: replace `sqlite-vec` extension calls with Turso's native vector syntax.

```sql
-- Local (sqlite-vec)
SELECT * FROM vec_entries WHERE embedding MATCH ?
ORDER BY distance LIMIT 10;

-- Hosted (Turso native)
SELECT *, vector_distance_cos(embedding, ?) AS distance
FROM entries
ORDER BY distance LIMIT 10;
```

This is a contained change in the DB initialization and vector search path. FTS5 and scalar queries are unchanged.

### Database topology

```
Turso cluster
├── user-{userId}          (one per registered user, personal hosted vault)
├── team-{teamId}          (one per team, shared vault)
└── public-index           (single global database, public entries)
```

### Vendor risk mitigation

Turso is a startup. libSQL is open-source and self-hostable. If Turso shuts down:
1. Export all databases (libSQL CLI)
2. Host on Fly volumes (Option C fallback) or self-host libSQL server
3. No query-layer changes needed (libSQL wire protocol is stable)

This is an acceptable risk given the operational cost savings and migration simplicity.

---

## Decision 4: Sync Model

### Recommendation: Separate worlds, optional R2 sync

**Local is local. Hosted is hosted.** They are not mirrors of each other.

```
Local mode:     Agent → MCP server (stdio) → local vault.db + ~/vault/
Hosted mode:    Agent → MCP server → hosted API → Turso DB + R2 files
Multi-device:   Local vault → R2 background upload → pull on other devices
```

### Why separate, not synced

- Local mode must work 100% offline with zero network dependency
- Hosted mode serves team/public tiers that have no local equivalent
- Bidirectional sync between SQLite and Turso is a complexity bomb (schema drift, conflict resolution, merge semantics)
- The `context-vault setup` flow already distinguishes local vs hosted mode

### Multi-device sync (Pro feature)

For users who want their personal vault on multiple machines:
1. Local MCP server writes to local vault.db + markdown as usual
2. Background process uploads changed files to `cv-private/users/{userId}/` on R2
3. On startup, pull new/changed entries from R2 and reindex local vault.db
4. Conflict resolution: ULID ordering (newer ULID wins)

This is R2-as-transport, not Turso-as-sync. The local vault.db remains the local source of truth. R2 is the sync channel for markdown files only.

---

## Decision 5: Pricing Tiers

### Recommendation

| Tier | Price | What you get |
|------|-------|-------------|
| **Free** | $0 forever | Local vault (unlimited entries, unlimited search). No hosted features. |
| **Pro** | $9/mo | Hosted personal vault, multi-device sync via R2, recall tracking dashboard, vault-brain hosted view, API key management. 10K entries hosted. |
| **Team** | $29/mo base + $9/mo per seat | Shared team vault, member management, team-level agent rules, admin controls, SSO (included). 50K entries per team. |

### Rationale

- **Free must stay generous.** The local vault is the adoption engine. Limiting it kills growth. "Free forever, runs on your machine" is the trust signal that makes developers try it.
- **Pro at $9/mo** is impulse-buy pricing for individual developers. The value: your vault works across machines, you get recall insights, and vault-brain shows your knowledge graph in the browser.
- **Team at $29 + $9/seat** targets small engineering teams (5-20 people). The per-seat model scales linearly and is standard for dev tools. SSO included (not gated behind enterprise) because better-auth makes it free to offer.
- **Entry limits are soft.** Hitting the limit shows a dashboard nudge, not a hard block. Overage is billed at $0.001/entry/month (effectively invisible unless massively over limit).
- **No enterprise tier at launch.** If large orgs come knocking, custom pricing via sales. Do not pre-build an enterprise tier nobody has asked for.

### Stripe integration

The existing Stripe setup continues. Update `STRIPE_PRICE_PRO` to the new $9/mo price. Add `STRIPE_PRICE_TEAM_BASE` ($29/mo) and `STRIPE_PRICE_TEAM_SEAT` ($9/mo/seat) as metered add-on.

---

## Updated Stack (v2)

| Component | Technology | Change from v1 |
|-----------|------------|----------------|
| Auth | better-auth (in-process) | New: replaces no-auth |
| Hosted DB | Turso (libSQL) | New: per-tenant databases |
| File storage | Cloudflare R2 (3 buckets) | New: vault file hosting + sync |
| Frontend | React 19, React Router 7, Tailwind 4, shadcn/ui, Vite | No change |
| Backend | Hono on Fly.io | No change |
| Payments | Stripe | Updated pricing |
| Email | Resend | No change |
| Frontend deploy | Vercel | No change |
| Backend deploy | Fly.io | No change |

---

## Implementation Sequence (Phase 3 preview)

Once these decisions are locked:

1. **better-auth integration** (1-2 days): mount auth routes, social providers, session middleware, basic login/signup UI
2. **Organization plugin** (1 day): team creation, invites, roles, team switcher UI
3. **API keys plugin** (0.5 day): key generation, scoping, verification middleware
4. **Turso integration** (2-3 days): driver adapter for hosted mode, vector query adaptation, per-tenant DB provisioning
5. **R2 integration** (1-2 days): file upload/download for hosted vaults, three-bucket setup
6. **Core v3 migration** (2-3 days): update `@context-vault/core` dependency, adapt server routes
7. **Pricing/billing update** (1 day): new Stripe prices, metered team seats
8. **Team vault backend** (2-3 days): team-scoped search, publish flow, member access checks
9. **Public index** (1-2 days): quality gate, publish API, global search
10. **Recall tracking UI** (1-2 days): dashboard showing counts, trends, tier promotion suggestions

Estimated total: 2-3 weeks of focused agent work.

---

## Key Decisions Log

- Auth: better-auth over Clerk/Supabase. Zero platform cost, full org/SSO/API-key support, no lock-in. [2026-03-21]
- Storage: three R2 buckets (cv-private, cv-teams, cv-public) with path-based isolation within each. [2026-03-21]
- Database: Turso per-tenant databases. Full FTS5 + native vector search, lowest migration cost from sqlite-vec stack. [2026-03-21]
- Sync: separate worlds (local vs hosted), optional R2-based multi-device sync for Pro users. [2026-03-21]
- Pricing: Free ($0, local) / Pro ($9/mo, hosted personal) / Team ($29 + $9/seat, shared vault + SSO). [2026-03-21]
