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

## Key Decisions

- Separate frontend/backend in one repo (not a monorepo with shared deps): keeps deploy pipelines independent [2026-01]
- dev/main branch flow: work on dev, merge to main to ship. Merging IS the deploy. [2026-01]
- Hono over Express for backend: lighter, better TypeScript support [2026-01]
- Fly.io for backend hosting: persistent volumes for SQLite, global edge network [2026-01]
- Vercel for frontend: zero-config React deploy with preview URLs [2026-01]
