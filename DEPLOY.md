# Deployment SOP — context-vault-app

## Stack

- **Host**: Vercel (project: `context-vault-app`, org: `felix-hellstroms-projects`)
- **Repo**: GitHub (`fellanH/context-vault-app`) — version control only, no CI/CD
- **Deploy method**: Vercel CLI directly from local machine

---

## Prerequisites

- Vercel CLI installed and authenticated (`vercel whoami`)
- Project linked: `.vercel/project.json` exists (run `vercel link` once if missing)

---

## Workflow

### 1. Develop

```bash
npm run dev
```

### 2. Verify build locally

```bash
npm run build
```

Fix any build or lint errors before deploying.

### 3. Commit & push to GitHub (version control)

```bash
git add <files>
git commit -m "feat: describe the change"
git push
```

GitHub stores history only — no automatic deploys trigger.

### 4. Deploy to Vercel production

```bash
npm run deploy
# or directly:
vercel --prod
```

Vercel CLI builds and deploys from local source. Confirm the deployment URL in the output.

---

## Preview deploys (optional)

```bash
vercel
```

Deploys a preview URL without affecting production.

---

## Environment variables

Managed in the Vercel dashboard under **Project Settings → Environment Variables**.
Never commit `.env.local` — it is gitignored.

---

## Vercel project info

| Key          | Value                              |
| ------------ | ---------------------------------- |
| Project ID   | `prj_BadSVacqViIZ2xt29rO8vfU8nQvc` |
| Org ID       | `team_BRQzGB8DcQCXokBzCKJsAcxR`    |
| Output dir   | `dist`                             |
| SPA rewrites | `/* → /index.html`                 |
