# Context Vault App — CLAUDE.md

## Stack

React 19, React Router 7, React Query, Tailwind CSS 4, shadcn/ui, Vite 6.
Deployed to Vercel via Git integration + CLI promotion.

## Dev

```bash
npm install
npm run dev       # Vite dev server on :5173, proxies /api → localhost:3000
npm run build     # production build → dist/
```

## Deploy

### Normal flow

```
git push origin main   →  auto-deploys to preview (Vercel Git integration)
                           human verifies preview
vercel --prod          →  promote to production
```

- **Preview (stable):** `https://context-vault-app-git-main-klarhimmel.vercel.app` — always reflects latest `main`
- **Production:** `https://app.context-vault.com`
- `vercel --prod` is the only gate to production — run it only after human sign-off on preview

### Ad-hoc local preview

```bash
vercel   # deploy from local without committing — useful for quick experiments
```

### Vercel project

Project: `context-vault-app` | Org: `klarhimmel`
Project ID: `prj_BadSVacqViIZ2xt29rO8vfU8nQvc`
Production Branch in Vercel settings: `release` (never pushed to — prevents any auto-prod deploy)
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

Fix on `main` → `git push` → verify on preview URL → `vercel --prod`.
The preview auto-deploys on push so you can verify immediately without a manual `vercel` step.
Only skip preview verification if the site is completely down and every second counts.

## Features

Open a GitHub Issue with a clear "done when..." before writing code.
All work on `main` — no long-lived branches. Short-lived branches only for risky/experimental work, merge with `--no-ff`.
Push early and often to `main` → preview auto-updates → verify → `vercel --prod` when ready.

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

## Staying lean

- Max 2–3 active workstreams at any time. Everything else is `parked`.
- If a feature grows beyond its acceptance criteria mid-build: ship the minimal version, open a new issue for the rest.
- Dead code gets deleted, not commented out.
- Monthly: close issues older than 3 months with no activity.
