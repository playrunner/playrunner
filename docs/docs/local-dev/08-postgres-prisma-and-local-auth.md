---
sidebar_position: 8
title: PostgreSQL, Prisma & Local Auth
---

# PostgreSQL, Prisma & Local Auth

> **Local development only.** The default local stack now runs a Docker-backed PostgreSQL database and a setup-seeded username/password login.

---

## Services Used

| Service | Purpose |
|---|---|
| **PostgreSQL** | Stores workflows, projects, integrations, environments, and secrets |
| **Prisma** | Provides the API schema, client, and local database bootstrap |
| **Local auth** | Issues JWT bearer tokens for the setup-configured username/password |

---

## Local Defaults

`./start-local.sh` now starts the local Postgres container automatically from `docker-compose.yml`:

```text
postgresql://postgres:postgres@127.0.0.1:5432/playrunner?schema=public
```

On the normal startup path it also runs:

```bash
cd apps/api
npm run prisma:generate
npx prisma db push --skip-generate
```

---

## Setup-Written Auth Config

The setup wizard writes these values into `apps/api/.env`:

```bash
LOCAL_AUTH_USERNAME=...
LOCAL_AUTH_PASSWORD_HASH=...
AUTH_JWT_SECRET=...
```

The web login page calls `POST /api/auth/login`, the API verifies the configured credentials, and successful logins receive a local JWT.

---

## Prisma Models

The local schema currently includes:

- `Project`
- `Workflow`
- `Integration`
- `CloudCredential`
- `Environment`
- `Secret`

The schema lives in `apps/api/prisma/schema.prisma`, and the shared Prisma client is exported from `apps/api/src/lib/prisma.ts`.

---

## Web Data Access

All app-side persistence still flows through `apps/web/src/lib/db.ts`, but that module now talks to Prisma-backed API routes under `/api/store/*`.

Key routes include:

```text
GET/POST/PUT/DELETE /api/store/projects
GET/POST/PUT/DELETE /api/store/workflows
GET/PUT/DELETE      /api/store/integrations/:provider
GET/PUT/DELETE      /api/store/cloud-credentials/:provider
GET/PUT/DELETE      /api/store/environments/:id
PUT                 /api/store/secrets/:secretKey
```

GitHub, Jira, and GCP token refresh still happen in the web `DbAPI` layer, but refreshed tokens are now persisted back through those Prisma-backed routes.
