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

`./start-local.sh` now starts the local Postgres container automatically from `docker-compose.yml`. By default it uses:

```text
postgresql://postgres:postgres@127.0.0.1:5432/playrunner?schema=public
```

These values come from the repo-root `.env.local` file, which is created from `.env.local.example` on first run if it does not already exist.

If you change `POSTGRES_PORT` in the repo-root `.env.local`, both the Docker bind and the setup form's default `DATABASE_URL` move with it automatically.

On the normal startup path it also runs:

```bash
cd apps/api
npm run prisma:generate
npx prisma db push --skip-generate
```

### How the local database config flows

1. The repo-root `.env.local` defines the local web port, setup installer port, and Docker-backed Postgres connection defaults.
2. `./start-local.sh --setup` starts Postgres with those values and passes the derived `DATABASE_URL` into the setup app.
3. The setup installer writes the chosen `DATABASE_URL` plus local auth settings into `apps/api/.env`.
4. `./start-local.sh` later reuses that config, and if you are still using the standard Docker-backed Postgres settings it keeps `apps/api/.env` aligned with the repo-root `.env.local` before running Prisma bootstrap.

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

All app-side persistence still flows through `apps/frontend/src/lib/db.ts`, but that module now talks to Prisma-backed API routes under `/api/store/*`.

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
