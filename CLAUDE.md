# Context Vault App — CLAUDE.md

## Repo structure

This is **not a monorepo/workspace**. Two independent packages share one git repo:

| Directory                         | Role              | Deployed to |
| --------------------------------- | ----------------- | ----------- |
| `src/` + root `package.json`      | React frontend    | Vercel      |
| `server/` + `server/package.json` | Hono HTTP backend | Fly.io      |

`npm install` at the root installs only frontend deps. Backend deps live in `server/node_modules` (`cd server && npm install`). The two packages have separate `node_modules`, separate build pipelines, and separate deploy targets. Vercel never touches `server/`; Fly.io Docker never touches `src/`. This is intentional — not a setup error.

## Stack

React 19, React Router 7, React Query, Tailwind CSS 4, shadcn/ui, Vite 6.
Deployed to Vercel via Git integration.

## Dev

```bash
npm install
npm run dev       # Vite dev server on :5173, proxies /api → localhost:3000
npm run build     # production build → dist/
```

## Branches

| Branch | Purpose                           | Deploys to                               |
| ------ | --------------------------------- | ---------------------------------------- |
| `dev`  | All development work happens here | Preview (`context-vault-app.vercel.app`) |
| `main` | Production-ready code only        | Production (`app.context-vault.com`)     |

**Normal flow:**

```
work on dev → git push origin dev → verify on context-vault-app.vercel.app
  → merge dev into main → auto-deploys to production
```

Merging `dev` into `main` IS the production deploy — treat it with the same care as shipping.

## Deploy

### Shipping to production

```bash
git checkout main
git merge dev --no-ff
git push origin main     # triggers Vercel auto-deploy to production
git checkout dev
```

### Vercel project

Project: `context-vault-app` | Org: `klarhimmel`
Project ID: `prj_BadSVacqViIZ2xt29rO8vfU8nQvc`
Production Branch in Vercel settings: `main`
Preview branch: `dev` → aliased to `context-vault-app.vercel.app`
Env vars live in Vercel dashboard. Never commit `.env.local`.

## Commit prefixes

| Prefix      | When                                  |
| ----------- | ------------------------------------- |
| `feat:`     | New user-facing functionality         |
| `fix:`      | Non-urgent bug fix                    |
| `hf:`       | Hotfix — prod is broken, skip preview |
| `chore:`    | Tooling, deps, config                 |
| `refactor:` | No behavior change                    |

## Hotfixes

Fix directly on `main` → `git push origin main` → auto-deploys to production.
Only skip `dev` verification if the site is completely down and every second counts.
After the hotfix, merge `main` back into `dev` to keep branches in sync:

```bash
git checkout dev && git merge main && git push origin dev
```

## Features

Open a GitHub Issue with a clear "done when..." before writing code.
All work on `dev`. Short-lived feature branches off `dev` only for risky/experimental work, merge with `--no-ff`.
Push early and often to `dev` → preview auto-updates → verify → merge to `main` when ready.

## Testing

- **Automated (Vitest):** pure functions, formatters, type transforms, API mappers.
- **Automated (Playwright):** only for paths that break silently — auth, onboarding, payments.
- **Human visual check:** all UI changes and new features, verified on preview before prod.
  - Check: browser console errors, light + dark mode, ~1280px and ~768px widths.
- Rule: don't automate what a 60-second manual check covers adequately.

## Planning

- **0–2 weeks:** concrete GitHub Issues with acceptance criteria
- **2–6 weeks:** rough backlog, not yet refined
- **6+ weeks:** themes only, never detailed tasks
- No sprints — ship when ready. Weekly issue triage (Mondays). Monthly review.

## Feedback

All feedback → GitHub Issue immediately. Labels: `feedback`, `bug`, `feature`, `ux`, `infra`.
GitHub Issues is the only backlog. No Notion, no Slack threads.
Weekly triage: close anything with no clear value or not aligned with current themes.

## Server (Fly.io)

The hosted backend lives in `server/`. It's a Hono HTTP server deployed to Fly.io.
Depends on `@context-vault/core` from npm.

```bash
# Dev (run in addition to npm run dev)
node --watch server/src/index.js

# Test
cd server && npm install && npm test

# Deploy
npm run fly:deploy   # or: fly deploy from repo root
```

`fly.toml` is at the repo root. Docker build context is the repo root; Dockerfile is at `server/Dockerfile`.
Fly secrets: AUTH_REQUIRED, VAULT_MASTER_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO.

## Staying lean

- Max 2–3 active workstreams at any time. Everything else is `parked`.
- If a feature grows beyond its acceptance criteria mid-build: ship the minimal version, open a new issue for the rest.
- Dead code gets deleted, not commented out.
- Monthly: close issues older than 3 months with no activity.
