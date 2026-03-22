# Context Vault App -- CLAUDE.md

## Repo structure

This is **not a monorepo/workspace**. Two independent packages share one git repo:

| Directory                         | Role              | Deployed to         |
| --------------------------------- | ----------------- | ------------------- |
| `src/` + root `package.json`      | React frontend    | Cloudflare Pages    |
| `server/` + `server/package.json` | Hono HTTP backend | Cloudflare Workers  |

`npm install` at the root installs only frontend deps. Backend deps live in `server/node_modules` (`cd server && npm install`). The two packages have separate `node_modules`, separate build pipelines, and separate deploy targets. Pages never touches `server/`; the Workers build never touches `src/`. This is intentional.

The frontend points at `https://api.context-vault.com` (set via `VITE_API_URL` or hardcoded default). Auth uses better-auth with email/password + GitHub social login. Teams use better-auth's organization plugin. API keys use better-auth's apiKey plugin.

## Stack

React 19, React Router 7, React Query, Tailwind CSS 4, shadcn/ui, Vite 6.
Deployed to Cloudflare Pages. Git integration auto-deploys on push.

## Dev

```bash
npm install
npm run dev       # Vite dev server on :5173, proxies /api -> api.context-vault.com
npm run build     # production build -> dist/
```

## Branches

| Branch | Purpose                           | Deploys to                                |
| ------ | --------------------------------- | ----------------------------------------- |
| `dev`  | All development work happens here | Preview (`context-vault-app.pages.dev`)    |
| `main` | Production-ready code only        | Production (`app.context-vault.com`)       |

**Normal flow:**

```
work on dev -> git push origin dev -> verify on context-vault-app.pages.dev
  -> merge dev into main -> auto-deploys to production
```

Merging `dev` into `main` IS the production deploy.

## Deploy

### Shipping to production

```bash
git checkout main
git merge dev --no-ff
git push origin main     # triggers Cloudflare Pages auto-deploy to production
git checkout dev
```

### Cloudflare Pages project

Project: `context-vault-app`
Production branch: `main` -> `app.context-vault.com`
Preview branch: `dev` -> `context-vault-app.pages.dev`
Build command: `npm run build`
Build output: `dist`
Env vars: set in Cloudflare dashboard (Pages > Settings > Environment Variables).

### Manual deploy (when needed)

```bash
npm run deploy    # builds + deploys to Pages production
```

## Commit prefixes

| Prefix      | When                                  |
| ----------- | ------------------------------------- |
| `feat:`     | New user-facing functionality         |
| `fix:`      | Non-urgent bug fix                    |
| `hf:`       | Hotfix, prod is broken, skip preview  |
| `chore:`    | Tooling, deps, config                 |
| `refactor:` | No behavior change                    |

## Hotfixes

Fix directly on `main` -> `git push origin main` -> auto-deploys to production.
Only skip `dev` verification if the site is completely down and every second counts.
After the hotfix, merge `main` back into `dev` to keep branches in sync:

```bash
git checkout dev && git merge main && git push origin dev
```

## Features

Open a GitHub Issue with a clear "done when..." before writing code.
All work on `dev`. Short-lived feature branches off `dev` only for risky/experimental work, merge with `--no-ff`.
Push early and often to `dev` -> preview auto-updates -> verify -> merge to `main` when ready.

## Testing

- **Automated (Vitest):** pure functions, formatters, type transforms, API mappers.
- **Automated (Playwright):** only for paths that break silently, auth, onboarding, payments.
- **Human visual check:** all UI changes and new features, verified on preview before prod.
  - Check: browser console errors, light + dark mode, ~1280px and ~768px widths.
- Rule: don't automate what a 60-second manual check covers adequately.

## Planning

- **0-2 weeks:** concrete GitHub Issues with acceptance criteria
- **2-6 weeks:** rough backlog, not yet refined
- **6+ weeks:** themes only, never detailed tasks
- No sprints, ship when ready. Weekly issue triage (Mondays). Monthly review.

## Feedback

All feedback -> GitHub Issue immediately. Labels: `feedback`, `bug`, `feature`, `ux`, `infra`.
GitHub Issues is the only backlog. No Notion, no Slack threads.
Weekly triage: close anything with no clear value or not aligned with current themes.

## Server (Cloudflare Workers)

The hosted backend lives in `server/`. It's a Hono HTTP server deployed to Cloudflare Workers.
Uses Turso (libSQL) for the database, better-auth for authentication, and R2 for file storage.

```bash
# Dev
cd server && npx wrangler dev

# Deploy
cd server && npx wrangler deploy
```

`wrangler.toml` is at the repo root (for the Worker). Workers env vars (secrets): TURSO_URL, TURSO_AUTH_TOKEN, BETTER_AUTH_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, CORS_ORIGIN, AUTH_REQUIRED.

## Staying lean

- Max 2-3 active workstreams at any time. Everything else is `parked`.
- If a feature grows beyond its acceptance criteria mid-build: ship the minimal version, open a new issue for the rest.
- Dead code gets deleted, not commented out.
- Monthly: close issues older than 3 months with no activity.
