---
sidebar_position: 4
title: Services & Ports
---

# Services & Ports

> **Local development only.** Each service runs on a fixed port and communicates over localhost or `host.docker.internal`.

---

## Port Map

| Service | Port | Binding | Notes |
|---|---|---|---|
| Web App (Vite) | `3000` | `localhost:3000` | Product app in normal runs |
| Setup App (Vite) | `3000` | `localhost:3000` | Dedicated setup UI during `--setup` runs |
| API Server | `3001` | `localhost:3001` | Express, started via `npm start` |
| Setup Installer | `3003` | `localhost:3003` | Local-only file writer, started by `start-local.sh` |
| Orchestrator | `3002` | `localhost:3002` | Docker container, port-mapped `3002:8080` |
| Pub/Sub Emulator | `8085` | `localhost:8085` | Docker container via `docker compose` |

---

## Web App — Port 3000

**Location:** `apps/web`  
**Start command:** `cd apps/web && npm run dev`  
**Technology:** React 19 + Vite 6 + TailwindCSS 4 + TypeScript

The product app proxies two path prefixes so the browser never hits CORS issues:

| Proxy path | Forwarded to |
|---|---|
| `/api/*` | `http://127.0.0.1:3001` |
| `/outputs/*` | `http://127.0.0.1:3001` |
This proxy is configured in `apps/web/vite.config.ts` and targets the URL in `VITE_API_URL`.

---

## Setup App — Port 3000 (setup runs only)

**Location:** `apps/setup`  
**Start command:** `cd apps/web && npm exec vite -- --config ../setup/vite.config.ts`  
**Technology:** React 19 + Vite 6 + TailwindCSS 4 + TypeScript

The setup app exists only for explicit install/setup sessions. It serves the Firebase setup wizard and proxies `/setup-api/*` to the local-only installer on port `3003`.

`./start-local.sh --setup` starts this app instead of the main product app, so no product routes are available during setup.

---

## API Server — Port 3001

**Location:** `apps/api`  
**Start command:** `cd apps/api && npm start` (runs `tsx src/index.ts`)  
**Technology:** Express 5 + TypeScript + Google Cloud Pub/Sub SDK

### What the API does

- Serves the REST API for the Web App (`/api/*` routes)
- Serves Playwright test outputs as static files (`/outputs/*`)
- Manages the lifecycle of the Orchestrator Docker container
- Subscribes to the Pub/Sub topic and forwards messages to connected browsers via SSE

### Routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/runners/start` | Spawns the Orchestrator Docker container |
| `POST` | `/api/workflows/start` | Forwards a workflow execution request to the Orchestrator |
| `POST` | `/api/workflows/stop-node` | Sends a stop signal for a running node to the Orchestrator |
| `POST` | `/api/outputs/:testId/:nodeId` | Receives compressed test output archives from the Playwright runner and extracts them |
| `GET`  | `/api/logs/stream` | SSE endpoint — browsers subscribe here to receive real-time log events |
| `GET`  | `/api/heartbeat` | Returns `200 OK` if at least one SSE client (Editor tab) is connected |
| `POST` | `/api/github/token` | CORS-bypass proxy: exchanges a GitHub OAuth code for an access token |
| `POST` | `/api/github/refresh` | CORS-bypass proxy: refreshes an expiring GitHub OAuth access token |
| `GET`  | `/outputs/*` | Static file server for extracted Playwright reports and media |

---

## Setup Installer — Port 3003

**Location:** `setup/installer`  
**Start command:** `node setup/installer/index.mjs`  
**Technology:** Node.js HTTP server using built-in modules only

### What the setup installer does

- Accepts setup-only requests from the setup wizard
- Verifies an explicit one-time setup token injected by `./start-local.sh --setup`
- Copies Firebase template files from `setup/firebase` into `apps/web`
- Generates `apps/web/firebase-config.json` and `apps/web/.firebaserc`
- Records setup completion in a non-public lock file under `setup/installer`

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
  -e PUBSUB_EMULATOR_HOST=host.docker.internal:8085 \
  -e PUBSUB_PROJECT_ID=local-dev \
  -e GCP_PROJECT=local-dev \
  -e EDITOR_API_URL=http://host.docker.internal:3001 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  playrunner-orchestrator
```

### Orchestrator Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/execute` | Accepts a workflow (nodes + connections + settings) and runs it |
| `POST` | `/stop` | Kills the Docker container for a specific `nodeId` |
| `GET`  | `/health` | Health check — returns `200 OK` when the container is up |

### Heartbeat & Graceful Shutdown

The Orchestrator pings `EDITOR_API_URL/api/heartbeat` every 5 seconds. If the heartbeat returns a non-OK response (meaning no Editor tab is open) **and** there are no active workflows running, the Orchestrator process exits with code `0`, which causes the `--rm` Docker container to be removed automatically.

---

## Pub/Sub Emulator — Port 8085

**Technology:** Google Cloud SDK emulator image  
**Start command:** `docker compose up -d pubsub-emulator` (run by `start-local.sh`)

The emulator mimics the real Google Cloud Pub/Sub API. The topic `orchestrator-logs` and subscription `orchestrator-logs-sub` are created automatically on API startup using the SDK's `autoCreate: true` option.

**Network notes:**
- The API and Orchestrator running on the host use `localhost:8085` to reach the emulator.
- Docker containers (Orchestrator, Playwright Runner) use `host.docker.internal:8085` since they can't use `localhost` to mean the host machine.

---

## Playwright Runner — Ephemeral

**Location:** `apps/runners/playwright`  
**Technology:** TypeScript + Python + Playwright  
**Image names:** `playrunner-playwright-runner-typescript:latest`, `playrunner-playwright-runner-python:latest`, plus every versioned tag defined in `config/playwright-runner-versions.json` for both runtimes  
**Startup:** Spawned by the Orchestrator per-node, runs to completion, then is removed

The runner receives its entire configuration through the `PAYLOAD` environment variable (JSON-encoded). It:

1. Clones the target GitHub repository (if configured)
2. Uses the runtime selected on the Playwright node (`TypeScript` or `Python`)
3. Runs `npx playwright test` (TypeScript) or `pytest` (Python)
4. Tarballs `playwright-report/` and `test-results/` and POSTs them to the API
5. Publishes step-by-step logs to the Pub/Sub topic throughout

The image version used is controlled by the `playwrightVersion` field on each Playwright node's config in the editor. The available values come from `config/playwright-runner-versions.json`.
