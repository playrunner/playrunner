---
sidebar_position: 4
title: Services & Ports
---

# Services & Ports

> **Local development only.** The standard local-flow ports below come from the repo-root `.env.local.example` file and package `.env.example` files. Override them in `.env.local` or the relevant service `.env`.

---

## Port Map

| Service                | Port   | Binding                          | Notes                                                        |
| ---------------------- | ------ | -------------------------------- | ------------------------------------------------------------ |
| Web App (Vite)         | `3100` | `localhost:WEB_PORT`             | Product app in normal runs                                   |
| Setup App (Vite)       | `3100` | `localhost:WEB_PORT`             | Dedicated setup UI during `--setup` runs                     |
| Docs Site (Docusaurus) | `3104` | `localhost:DOCS_PORT`            | Host process started by `start-local.sh`; not part of Docker |
| API Server             | `3011` | `localhost:3011`                 | Express, started via `npm start`                             |
| Setup Installer        | `3103` | `localhost:SETUP_INSTALLER_PORT` | Local-only file writer, started by `start-local.sh`          |
| Orchestrator           | `3012` | `localhost:3012`                 | Docker container, port-mapped `3012:8080`                    |
| PostgreSQL             | `5432` | `localhost:POSTGRES_PORT`        | Docker container started by `start-local.sh`                 |
| Pub/Sub Emulator       | `8084` | `localhost:PUBSUB_EMULATOR_PORT` | Host port (default `8084`) mapped to container port `8085`   |

---

## Web App — Port 3100

**Location:** `apps/frontend`
**Start command:** `./start-local.sh` or `cd apps/frontend && npm run dev -- --port 3100`
**Technology:** React 19 + Vite 6 + TailwindCSS 4 + TypeScript

The product app proxies two path prefixes so the browser never hits CORS issues:

| Proxy path   | Forwarded to            |
| ------------ | ----------------------- |
| `/api/*`     | `http://127.0.0.1:3011` |
| `/outputs/*` | `http://127.0.0.1:3011` |

This proxy is configured in `apps/frontend/vite.config.ts` and targets the URL in `VITE_API_URL`.

---

## Setup App — Port 3100 (setup runs only)

**Location:** `apps/setup`
**Start command:** `./start-local.sh --setup` or `cd apps/frontend && npm exec vite -- --config ../setup/vite.config.ts --port 3100`
**Technology:** React 19 + Vite 6 + TailwindCSS 4 + TypeScript

The setup app exists only while the repo-root startup flow is running in setup mode. It serves the PostgreSQL, Prisma, and local-auth setup wizard and proxies `/setup-api/*` to the local-only installer on port `3103`.

`./start-local.sh` starts this app automatically when local setup has not been completed yet, and `./start-local.sh --setup` can still force it explicitly. No product routes are available during setup.

---

## Docs Site — Port 3104

**Location:** `docs`
**Start command:** `cd docs && npm run start -- --port 3104`
**Technology:** Docusaurus 3 + React 19 + TypeScript

`./start-local.sh` and `./start-local.sh --setup` also start the Docusaurus site on the host so the product header's `Docs` link can stay local during development. The standard local landing URL is `http://127.0.0.1:3104/playrunner/`.

This service is not part of Docker.

---

## API Server — Port 3011

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
| `POST` | `/api/workflows/stop-node`            | Sends `executionId` + `nodeId` to stop the matching running node                      |
| `GET`  | `/api/executions/:executionId/stream` | Authenticated SSE endpoint for a single workflow execution                            |
| `GET`  | `/api/presence/stream`                | Lightweight SSE endpoint that marks an editor tab as connected for heartbeat checks   |
| `POST` | `/api/outputs/:testId/:nodeId`        | Receives compressed test output archives from the Playwright runner and extracts them |
| `GET`  | `/api/heartbeat`                      | Returns `200 OK` if at least one SSE client (Editor tab) is connected                 |
| `POST` | `/api/github/token`                   | CORS-bypass proxy: exchanges a GitHub OAuth code for an access token                  |
| `POST` | `/api/github/refresh`                 | CORS-bypass proxy: refreshes an expiring GitHub OAuth access token                    |
| `GET`  | `/outputs/*`                          | Static file server for extracted Playwright reports and media                         |

---

## Setup Installer — Port 3103

**Location:** `setup/installer`  
**Start command:** `SETUP_INSTALLER_PORT=3103 node setup/installer/index.mjs`
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

## Orchestrator — Port 3012

**Location:** `apps/runners/orchestrator`  
**Technology:** Express 5 + TypeScript + Docker CLI (inside the container)  
**Image name:** `playrunner-orchestrator`  
**Startup:** Spawned by the API via `docker run` when the Editor mounts

The Orchestrator runs inside Docker and is given access to the host's Docker socket (`/var/run/docker.sock`) so it can itself spawn Playwright runner containers:

```bash
docker run --rm \
  --name playrunner-orchestrator-local \
  -p 3012:8080 \
  -e PORT=8080 \
  -e EDITOR_API_URL=http://host.docker.internal:3011 \
  -e PUBSUB_EMULATOR_HOST=host.docker.internal:8084 \
  -e GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC=playrunner-workflow-events \
  -v /var/run/docker.sock:/var/run/docker.sock \
  playrunner-orchestrator
```

### Orchestrator Endpoints

| Method | Path       | Description                                                                                                                                            |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST` | `/execute` | Accepts a workflow (nodes + connections + settings) and runs it                                                                                        |
| `POST` | `/stop`    | Cancels a package executor or stops a Playwright process matching `executionId` + `nodeId`                                                             |
| `GET`  | `/health`  | Health check — returns `200 OK` when the container is up                                                                                               |
| `GET`  | `/runtime` | Reports Pub/Sub metadata, bundled orchestrator contributions, executor timeout, and currently active package executors; also used for readiness checks |

### Orchestrator Lifecycle

The Orchestrator is a standby runner. Once started, it stays up until the container or process is stopped explicitly. It no longer exits just because the editor heartbeat is unavailable.

When the editor mounts, `/api/runners/start` checks both `/health` and
`/runtime`. If a stale container is still bound to port `3012` but does not
report the expected local Pub/Sub metadata, the API stops that container and
starts a fresh `playrunner-orchestrator-local` container from the current image.

Jira, Slack, and future package-owned node executors are installed, registered,
and bundled into this image at build time. Workflow execution never downloads or
installs marketplace package code. At runtime, users can connect credentials,
add an already-bundled node to a workflow, and configure its fields and action.
Changing the available executor set requires rebuilding the image and replacing
the running container.

---

## Event Transport

Local Docker and GCP workflow events both use messaging transport. Local Docker runs publish to the Pub/Sub emulator, while GCP runs publish to GCP Pub/Sub.

The local emulator listens on port `8085` inside its Compose container. Docker
Compose maps `PUBSUB_EMULATOR_PORT` on the host (default `8084`) to that fixed
container port. Host processes therefore use `127.0.0.1:8084`, while the
Orchestrator and Playwright containers use `host.docker.internal:8084`.

For each execution, the API creates an execution-scoped pull subscription, persists each accepted execution event to PostgreSQL, acknowledges the message only after the DB write succeeds, and then serves the same SSE stream to the editor. Runner control/status messages use the same Pub/Sub topic and filtered subscriptions consumed by the Orchestrator and runner.

---

## Playwright Runner — Ephemeral

**Location:** `apps/runners/playwright`  
**Technology:** TypeScript + Python + Playwright  
**Image names:** `playrunner-playwright-runner-typescript:latest`, `playrunner-playwright-runner-python:latest`, plus every versioned tag defined in `config/playwright-runner-versions.json` for both runtimes  
**Startup:** Spawned by the Orchestrator per-node, runs to completion, then is removed

The runner receives its entire configuration through the `PAYLOAD` environment variable (JSON-encoded). It:

1. Clones the target GitHub repository (if configured)
2. Uses the runtime selected on the Playwright node (`TypeScript` or `Python`)
3. Installs/prepares dependencies, then waits for a Pub/Sub start signal
4. Runs `playwright test` (TypeScript) or `pytest` (Python)
5. Tarballs `playwright-report/` and `test-results/` and uploads them to the configured output destination
6. Publishes step-by-step logs, node states, runner status, and output events through Pub/Sub

The image version used is controlled by the `playwrightVersion` field on each Playwright node's config in the editor. The available values come from `config/playwright-runner-versions.json`.
