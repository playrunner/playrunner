---
sidebar_position: 5
title: Environment Variables
---

# Environment Variables

> **Local development only.** Each service reads its configuration from environment variables. Defaults are designed to work out-of-the-box for local dev.

---

## Local Startup — `.env.local`

Copy from `.env.local.example`.

| Variable | Default | Description |
|---|---|---|
| `WEB_PORT` | `3000` | Port used by both the setup app and the normal web app |
| `DOCS_PORT` | `3004` | Port used by the local Docusaurus docs site started by `./start-local.sh` |
| `SETUP_INSTALLER_PORT` | `3003` | Port used by the local setup installer service |
| `POSTGRES_PORT` | `5432` | Host port mapped to the Docker-backed Postgres container |
| `POSTGRES_HOST` | `127.0.0.1` | Hostname used when deriving the default local Prisma connection |
| `POSTGRES_DB` | `playrunner` | Database name for the standard local Postgres container |
| `POSTGRES_USER` | `postgres` | Username for the standard local Postgres container |
| `POSTGRES_PASSWORD` | `postgres` | Password for the standard local Postgres container |
| `DATABASE_URL` | _(optional)_ | Explicit Prisma datasource URL override for both setup defaults and the normal API startup path |
| `VITE_DEFAULT_DATABASE_URL` | _(optional)_ | Override only the database URL prefilled in the setup form |
| `VITE_DOCS_URL` | Derived from `DOCS_PORT` by default | Optional full override for the header `Docs` link during repo-root local startup |

`./start-local.sh` loads this file first, uses it to start Docker-backed services, and passes the derived defaults into the setup app. If a legacy repo-root `.env` still exists and `.env.local` does not, the script renames it to `.env.local` automatically.

---

## API Server — `apps/api/.env`

Created from `apps/api/.env.example` during setup when needed, then updated by the setup installer. During normal local startup, `./start-local.sh` also keeps `DATABASE_URL` aligned with the repo-root `.env.local` when you are still using the standard Docker-backed Postgres settings.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the Express API server listens on |
| `DATABASE_URL` | Derived from repo-root `.env.local` by default | Prisma datasource used for app data and workflow execution events. In the standard local flow this resolves to `postgresql://postgres:postgres@127.0.0.1:<POSTGRES_PORT>/playrunner?schema=public` unless you explicitly override `DATABASE_URL` in the repo-root `.env.local`. |
| `GCP_PROJECT` | `local-dev` | GCP project ID used for Cloud Storage / Cloud Run integrations |
| `ORCHESTRATOR_PORT` | `3002` | Host port the Orchestrator Docker container is mapped to |
| `ORCHESTRATOR_URL` | `http://localhost:3002` | Full URL used by the API to communicate with the Orchestrator |
| `ORCHESTRATOR_IMAGE` | `playrunner-orchestrator` | Docker image name for the Orchestrator (built by `start-local.sh`) |
| `EDITOR_API_URL_DOCKER` | `http://host.docker.internal:3001` | API server URL **as seen from inside Docker containers** (passed to the Orchestrator container so it can heartbeat back) |
| `EDITOR_API_PUBLIC_URL` | _(optional)_ | Public API base URL for GCP Cloud Run callbacks when the local request host is not reachable from GCP |
| `GCS_BUCKET_PREFIX` | _(required for GCP)_ | Prefix used when creating per-workflow GCS output buckets |
| `GCS_PROJECT_ID` | _(required for GCP)_ | GCP project used by GCS clients when a selected project is not passed |
| `GCP_CLOUD_RUN_LOCATION` | _(required for GCP)_ | Cloud Run region for the GCP orchestrator service |
| `GCP_ORCHESTRATOR_SERVICE_NAME` | _(required for GCP)_ | Cloud Run service name for the remote orchestrator |
| `GCP_ORCHESTRATOR_IMAGE_URI_TEMPLATE` | _(required for GCP)_ | Orchestrator container image URI template; supports `{projectId}` |

---

## Web App — `apps/frontend/.env`

Optional. The standard local flow does not require this file.

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://127.0.0.1:3001` | Target for the Vite dev-server proxy (`/api/*` and `/outputs/*`) when you run the frontend outside `./start-local.sh` |
| `VITE_SETUP_INSTALLER_URL` | `http://127.0.0.1:3003` | Target for the Vite dev-server proxy (`/setup-api/*`) when you run the setup app outside `./start-local.sh` |
| `VITE_DOCS_URL` | `https://docs.playrunner.dev` | Target for the header `Docs` link when you run the frontend outside `./start-local.sh` |
| `GEMINI_API_KEY` | _(empty)_ | API key for Gemini AI features; injected at runtime in production |
| `APP_URL` | _(empty)_ | Self-referential URL; not needed for local dev |

When you use `./start-local.sh`, it exports the correct local proxy targets automatically, so this file is only needed for standalone frontend debugging.

---

## Orchestrator — `apps/runners/orchestrator/.env`

This file is **not used** when the Orchestrator runs as a Docker container (all variables are injected via `docker run -e` flags by the API). It is provided as a reference for running the Orchestrator directly on the host during debugging.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | Port the Orchestrator Express server listens on |
| `EDITOR_API_URL` | `http://localhost:3001` | API server URL for heartbeat pings |
| `GCP_PROJECT` | `local-dev` | GCP project ID used for Cloud Storage / Cloud Run integrations |
| `PLAYWRIGHT_IMAGE_BASE` | `playrunner-playwright-runner` | Base Docker image prefix for Playwright runner containers; the orchestrator appends `-typescript` or `-python` |
| `GCP_CLOUD_RUN_API_BASE_URL` | _(required for GCP)_ | Cloud Run API base URL used to create/run Playwright jobs |
| `GCP_CLOUD_RUN_LOCATION` | _(required for GCP)_ | Cloud Run region for GCP Playwright jobs |
| `GCP_PLAYWRIGHT_IMAGE_URI_TEMPLATE` | _(required for GCP)_ | Playwright runner image URI template; supports `{projectId}`, `{runtime}`, and `{version}` |
| `GCP_PLAYWRIGHT_JOB_NAME_TEMPLATE` | _(required for GCP)_ | Cloud Run job name template; supports `{runtime}`, `{version}`, `{cpu}`, and `{memory}` |

---

## Playwright Runner

The Playwright runner does **not** use a `.env` file. Its entire configuration is passed as a single JSON-encoded string in the `PAYLOAD` environment variable, injected by the Orchestrator when it runs `docker run`.

### `PAYLOAD` Structure

```json
{
  "data": {
    "repository": "org/repo-name",
    "branch": "main",
    "folder": "e2e/",
    "action": "clone",
    "executionAuthToken": "signed-per-execution-secret",
    "testScript": null,
    "nodeId": "node-abc123",
    "testId": "550e8400-e29b-41d4-a716-446655440000",
    "editorApiUrl": "http://host.docker.internal:3001"
  },
  "github": {
    "accessToken": "gha_...",
    "refreshToken": "ghr_...",
    "clientId": "...",
    "clientSecret": "..."
  }
}
```

The runner also receives these additional environment variables:

| Variable | Description |
|---|---|
| `GCP_PROJECT` | GCP project ID (`local-dev`) |
| Any user-defined env vars | Injected from the Environment node's configured variables |

---

## How Variables Flow Through the Stack

```
.env (API)
  └─ DATABASE_URL                   → Prisma + workflow event storage
  └─ EDITOR_API_URL_DOCKER          → passed to Orchestrator container (-e)

Orchestrator container (env from API's docker run)
  └─ GCP_PROJECT                    → passed to Playwright container (-e)
  └─ PAYLOAD (full config)          → passed to Playwright container (-e)
```
