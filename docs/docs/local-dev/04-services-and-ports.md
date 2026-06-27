---
sidebar_position: 4
title: Services & Ports
---

# Services & Ports

> **Local development only.** The defaults below come from the repo-root `.env.local.example` file and can be overridden in a local `.env.local`.

---

## Port Map

| Service                | Port              | Binding                          | Notes                                                        |
| ---------------------- | ----------------- | -------------------------------- | ------------------------------------------------------------ |
| Web App (Vite)         | `3000` by default | `localhost:WEB_PORT`             | Product app in normal runs                                   |
| Setup App (Vite)       | `3000` by default | `localhost:WEB_PORT`             | Dedicated setup UI during `--setup` runs                     |
| Docs Site (Docusaurus) | `3004` by default | `localhost:DOCS_PORT`            | Host process started by `start-local.sh`; not part of Docker |
| API Server             | `3001`            | `localhost:3001`                 | Express, started via `npm start`                             |
| Setup Installer        | `3003` by default | `localhost:SETUP_INSTALLER_PORT` | Local-only file writer, started by `start-local.sh`          |
| Orchestrator           | `3002`            | `localhost:3002`                 | Docker container, port-mapped `3002:8080`                    |
| PostgreSQL             | `5432` by default | `localhost:POSTGRES_PORT`        | Docker container started by `start-local.sh`                 |
| Pub/Sub Emulator       | `8085` by default | `localhost:PUBSUB_EMULATOR_PORT` | Docker container started by `start-local.sh`                 |

---

## Web App — Port 3000 by Default

**Location:** `apps/frontend`
**Start command:** `cd apps/frontend && npm run dev`
**Technology:** React 19 + Vite 6 + TailwindCSS 4 + TypeScript

The product app proxies two path prefixes so the browser never hits CORS issues:

| Proxy path   | Forwarded to            |
| ------------ | ----------------------- |
| `/api/*`     | `http://127.0.0.1:3001` |
| `/outputs/*` | `http://127.0.0.1:3001` |

This proxy is configured in `apps/frontend/vite.config.ts` and targets the URL in `VITE_API_URL`.

---

## Setup App — Port 3000 by Default (setup runs only)

**Location:** `apps/setup`
**Start command:** `cd apps/frontend && npm exec vite -- --config ../setup/vite.config.ts`
**Technology:** React 19 + Vite 6 + TailwindCSS 4 + TypeScript

The setup app exists only while the repo-root startup flow is running in setup mode. It serves the PostgreSQL, Prisma, and local-auth setup wizard and proxies `/setup-api/*` to the local-only installer on port `3003` by default.

`./start-local.sh` starts this app automatically when local setup has not been completed yet, and `./start-local.sh --setup` can still force it explicitly. No product routes are available during setup.

---

## Docs Site — Port 3004 by Default

**Location:** `docs`
**Start command:** `cd docs && npm run start -- --port 3004`
**Technology:** Docusaurus 3 + React 19 + TypeScript

`./start-local.sh` and `./start-local.sh --setup` also start the Docusaurus site on the host so the product header's `Docs` link can stay local during development. The default local landing URL is `http://127.0.0.1:3004/playrunner/`.

This service is not part of Docker.

---

## API Server — Port 3001

**Location:** `apps/api`  
**Start command:** `cd apps/api && npm start` (runs `tsx src/index.ts`)  
**Technology:** Express 5 + TypeScript + PostgreSQL-backed execution event stream

### What the API does

- Serves the REST API for the Web App (`/api/*` routes)
- Serves Playwright test outputs as static files (`/outputs/*`)
- Manages the lifecycle of the Orchestrator Docker container
- Persists workflow events to PostgreSQL and streams them to the editor via execution-scoped SSE

### Routes

| Method | Path                                  | Description                                                                           |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST` | `/api/runners/start`                  | Spawns the Orchestrator Docker container                                              |
| `POST` | `/api/workflows/start`                | Forwards a workflow execution request to the Orchestrator                             |
| `POST` | `/api/workflows/stop-node`            | Sends a stop signal for a running node to the Orchestrator                            |
| `GET`  | `/api/executions/:executionId/stream` | Authenticated SSE endpoint for a single workflow execution                            |
| `GET`  | `/api/presence/stream`                | Lightweight SSE endpoint that marks an editor tab as connected for heartbeat checks   |
| `POST` | `/api/outputs/:testId/:nodeId`        | Receives compressed test output archives from the Playwright runner and extracts them |
| `GET`  | `/api/heartbeat`                      | Returns `200 OK` if at least one SSE client (Editor tab) is connected                 |
| `POST` | `/api/github/token`                   | CORS-bypass proxy: exchanges a GitHub OAuth code for an access token                  |
| `POST` | `/api/github/refresh`                 | CORS-bypass proxy: refreshes an expiring GitHub OAuth access token                    |
| `GET`  | `/outputs/*`                          | Static file server for extracted Playwright reports and media                         |

---

## Setup Installer — Port 3003 by Default

**Location:** `setup/installer`  
**Start command:** `node setup/installer/index.mjs`  
**Technology:** Node.js HTTP server using built-in modules only

### What the setup installer does

- Accepts setup-only requests from the setup wizard
- Verifies the setup token injected by `./start-local.sh` whenever startup enters setup mode
- Uses the repo-root `.env.local` values to determine the default local Postgres connection shown in setup
- Creates `apps/api/.env` from `apps/api/.env.example` when needed
- Upserts PostgreSQL connection strings plus local username/password auth settings
- Writes the Prisma schema and Prisma client helper into `apps/api`
- Treats a repo-root `.env.local` plus a populated `apps/api/.env` as the signal that setup has already been completed

This service is intentionally separate from the main API so it is never part of the normal app deployment path.

---

## Orchestrator — Port 3002

**Location:** `apps/runners/orchestrator`  
**Technology:** Express 5 + TypeScript + Docker CLI (inside the container)  
**Image name:** `playrunner-orchestrator`  
**Startup:** Spawned by the API via `docker run` when the Editor mounts

The Orchestrator runs inside Docker and is given access to the host's Docker socket (`/var/run/docker.sock`) so it can itself spawn Playwright runner containers:

```bash
docker run --rm \
  -p 3002:8080 \
  -e PORT=8080 \
  -e GCP_PROJECT=local-dev \
  -e EDITOR_API_URL=http://host.docker.internal:3001 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  playrunner-orchestrator
```

### Orchestrator Endpoints

| Method | Path       | Description                                                     |
| ------ | ---------- | --------------------------------------------------------------- |
| `POST` | `/execute` | Accepts a workflow (nodes + connections + settings) and runs it |
| `POST` | `/stop`    | Kills the Docker container for a specific `nodeId`              |
| `GET`  | `/health`  | Health check — returns `200 OK` when the container is up        |

### Orchestrator Lifecycle

The Orchestrator is a standby runner. Once started, it stays up until the container or process is stopped explicitly. It no longer exits just because the editor heartbeat is unavailable.

---

## Event Transport

Local Docker and GCP workflow events both use messaging transport. Local Docker runs publish to the Pub/Sub emulator, while GCP runs publish to GCP Pub/Sub.

For each execution, the API creates an execution-scoped pull subscription, persists each Pub/Sub message to PostgreSQL, acknowledges the message only after the DB write succeeds, and then serves the same SSE stream to the editor.

---

## Playwright Runner — Ephemeral

**Location:** `apps/runners/playwright`  
**Technology:** TypeScript + Python + Playwright  
**Image names:** `playrunner-playwright-runner-typescript:latest`, `playrunner-playwright-runner-python:latest`, plus every versioned tag defined in `config/playwright-runner-versions.json` for both runtimes  
**Startup:** Spawned by the Orchestrator per-node, runs to completion, then is removed

The runner receives its entire configuration through the `PAYLOAD` environment variable (JSON-encoded). It:

1. Clones the target GitHub repository (if configured)
2. Uses the runtime selected on the Playwright node (`TypeScript` or `Python`)
3. Runs `playwright test` (TypeScript) or `pytest` (Python)
4. Tarballs `playwright-report/` and `test-results/` and uploads them to the configured output destination
5. Publishes step-by-step logs, node states, and output events through Pub/Sub

The image version used is controlled by the `playwrightVersion` field on each Playwright node's config in the editor. The available values come from `config/playwright-runner-versions.json`.
