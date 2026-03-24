# Context Vault App — Architecture

## Stack

| Component | Technology |
|-----------|------------|
| Frontend framework | React 19, React Router 7 |
| State management | React Query |
| Styling | Tailwind CSS 4, shadcn/ui |
| Build | Vite 6 |
| Backend framework | Hono |
| Payments | Stripe |
| Email | Resend |
| Frontend deploy | Vercel (klarhimmel/context-vault-app) |
| Backend deploy | Fly.io (context-vault-api) |

## Structure

This is NOT a monorepo. Two independent packages share one git repo:

```
app/
├── src/                    ← React frontend
│   ├── app/
│   │   ├── components/     ← shared UI components
│   │   ├── pages/          ← route-level page components
│   │   └── lib/            ← utilities
│   ├── data/               ← data layer
│   ├── styles/             ← global CSS
│   └── main.tsx            ← entry point
├── public/                 ← static assets
├── package.json            ← frontend deps only
├── vite.config.ts
├── vercel.json
│
├── server/                 ← Hono backend (separate package)
│   ├── src/
│   │   └── index.js        ← server entry point
│   ├── test/
│   ├── Dockerfile
│   ├── package.json        ← backend deps (separate node_modules)
│   └── vitest.config.js
│
├── fly.toml                ← Fly.io config (at repo root, builds from server/)
├── index.html
└── specs/
```

**Key constraint:** `npm install` at root installs only frontend deps. Backend deps require `cd server && npm install`. The two have separate node_modules, build pipelines, and deploy targets.

## Deploy

### Frontend
- Cloudflare Pages project: `context-vault-app`
- Production domain: app.context-vault.com
- Deploy: `npm run build && npx wrangler pages deploy dist --project-name context-vault-app --branch main`

### Backend
- Cloudflare Workers: `context-vault-api`
- Production domain: api.context-vault.com
- Deploy: `cd server && npx wrangler deploy`
- Secrets managed via `npx wrangler secret put`

### Branch Flow
```
work on main -> git push -> manual deploy via wrangler
```

## Dependencies

- Server imports `@context-vault/core` from npm (currently on v2.8.x, needs v3 migration)
- Extension calls the same API endpoints

## Constraints

- Server must complete v3 core migration before new MCP features are usable server-side
- Frontend and backend have completely separate dependency trees
- Vercel scope must be `klarhimmel` (not personal scope)
- Fly secrets: AUTH_REQUIRED, VAULT_MASTER_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO

## Planned: Agent Rules Dashboard View

A future dashboard page where users can view, edit, and manage their agent rules from the web app.

### Purpose

Users who prefer a GUI over CLI should be able to inspect and customize their agent rules without touching the terminal. The app becomes the management plane for rules that are installed locally via the CLI.

### Page: `/dashboard/rules`

| Section | Description |
|---------|-------------|
| Rules preview | Read-only rendered view of the current agent rules content (the same content shown on the docs site). Syntax-highlighted markdown. |
| Per-client install status | Shows which clients (Claude Code, Cursor, Windsurf) have rules installed, with version and path. Requires the local MCP server to report installed rules state via a `get_rules_status` tool or API call. |
| Edit mode | Toggle to edit the rules content inline. Saves to the local rules file via an MCP tool call (e.g., `update_rules`). Changes are written to disk on the user's machine, not stored server-side. |
| Version indicator | Shows installed version vs latest available version. "Update available" badge if the installed version is older than the bundled version. One-click upgrade button. |
| Customization hints | Contextual suggestions based on the user's vault usage patterns (e.g., "You save a lot of insights about React hooks. Consider adding a project-specific save trigger for your frontend work."). |

### Data flow

```
App dashboard  --MCP tool call-->  Local MCP server  --file I/O-->  ~/.claude/rules/context-vault.md
```

The app never stores rules content on the server. Rules are always local files managed through the MCP server. The dashboard is a remote control, not a database.

### Dependencies

- Local MCP server needs new tools: `get_rules_status` (returns installed paths, versions, content) and `update_rules` (writes updated content to the correct client path)
- App needs MCP client integration to call local tools from the dashboard (currently the app talks to the hosted API, not local MCP)
- This creates a new connection path: app frontend -> local MCP server (likely via localhost WebSocket or HTTP bridge)

### Scope boundaries

- No server-side rules storage. Rules live on the user's machine only.
- No team rules management (future: teams could share base rules via the hosted tier).
- No auto-sync between devices. Each machine manages its own rules independently.
- No rules marketplace or community sharing (future consideration).

### Open questions

- How does the app frontend connect to the local MCP server? Options: (a) localhost HTTP endpoint on the MCP server, (b) browser extension as bridge, (c) Tauri/Electron wrapper. Decision deferred to implementation.
- Should rules editing be real-time (WebSocket) or request-response (HTTP)? Likely HTTP is sufficient since edits are infrequent.

## Key Decisions

- Separate frontend/backend in one repo (not a monorepo with shared deps): keeps deploy pipelines independent [2026-01]
- dev/main branch flow: work on dev, merge to main to ship. Merging IS the deploy. [2026-01]
- Hono over Express for backend: lighter, better TypeScript support [2026-01]
- Fly.io for backend hosting: persistent volumes for SQLite, global edge network [2026-01]
- Vercel for frontend: zero-config React deploy with preview URLs [2026-01]
