# Context Vault App — Product Requirements

## Problem

Users need a visual interface to browse, search, and manage their vault entries. The MCP CLI is powerful but not suitable for browsing or bulk editing. Users also need a hosted backend for cloud sync, team vaults, and billing.

## Target Users

1. Context Vault users who want to browse and edit entries visually
2. Teams who need shared vault access
3. Users who want cloud sync for cross-device access

## Functional Requirements

### Frontend (app.context-vault.com)
- Dashboard with entry list, search, and filtering
- Inline editing of vault entries
- Usage analytics and alerts
- API key management with scopes
- Changelog page
- Dark and light mode
- Responsive layout (1280px and 768px breakpoints)

### Backend (api.context-vault.com)
- REST API for vault CRUD operations
- Authentication (sessions, API keys)
- Stripe billing integration (free tier + Pro)
- Team vault namespaces with shared access
- Resend email integration

### Authentication
- Session-based auth for web app
- API key auth for programmatic access
- Scoped API keys (read, write, admin)

### Billing
- Free tier with usage limits
- Pro plan via Stripe
- Usage alerts when approaching limits

## Data Model

Server uses `@context-vault/core` for the vault engine. Additional models:

### User
- `id`, `email`, `name`
- `plan`: free | pro
- `api_keys`: scoped API key records
- `created_at`

### Team
- `id`, `name`, `owner_id`
- `members`: user references with roles
- `vault_namespace`: isolated vault scope

## User Flows

### Sign Up and Connect
1. User visits app.context-vault.com and registers
2. Creates API key with desired scopes
3. Configures local vault to sync with hosted backend
4. Entries sync bidirectionally

### Browse and Edit
1. User opens dashboard
2. Searches or filters entries by kind, tags, date
3. Clicks an entry to view details
4. Edits inline, saves

### Team Vault
1. User creates a team and invites members
2. Team members share a vault namespace
3. Entries saved to the team vault are visible to all members

## Success Criteria

- Dashboard loads in <2 seconds
- Search results match MCP server quality (same core engine)
- Stripe checkout completes without errors
- Frontend works on Chrome, Firefox, Safari (latest versions)
- Preview deploys on every push to dev branch

## Scope Boundaries

### Out of Scope
- Mobile app
- Real-time collaboration (entries are not documents)
- Self-hosted server option
- SSO / enterprise auth
