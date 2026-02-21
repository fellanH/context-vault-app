# Context Vault App — CLAUDE.md

## Stack

React 19, React Router 7, React Query, Tailwind CSS 4, shadcn/ui, Vite 6.
Deployed to Vercel via CLI. No CI/CD — deploys are always manual from local.

## Dev

```bash
npm install
npm run dev       # Vite dev server on :5173, proxies /api → localhost:3000
npm run build     # production build → dist/
```

## Deploy

```bash
vercel            # preview deploy (staging — always do this first)
vercel --prod     # promote to production (app.context-vault.com)
```

Vercel project: `context-vault-app` | Org: `klarhimmel`
Project ID: `prj_BadSVacqViIZ2xt29rO8vfU8nQvc`
GitHub push = version control only, never triggers a deploy.
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

Fix on `main` → `npm run build` → `git push` → `vercel --prod` (skip preview).
Only use preview first if the fix touches auth, data, or payments.

## Features

Open a GitHub Issue with a clear "done when..." before writing code.
Small features (< ~1 day): work on `main`. Larger: short-lived branch, merge with `--no-ff`.
Always deploy preview → human verify → then `vercel --prod`.

## Testing

- **Automated (Vitest):** pure functions, formatters, type transforms, API mappers.
- **Automated (Playwright):** only for paths that break silently — auth, onboarding, payments.
- **Human visual check:** all UI changes and new features, verified on preview deploy before prod.
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
