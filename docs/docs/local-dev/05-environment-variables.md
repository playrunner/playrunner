---
sidebar_position: 5
title: Environment Variables
---

# Environment Variables

> **Local development only.** Each service reads its configuration from environment variables. Defaults are designed to work out-of-the-box for local dev.

---

## API Server — `apps/api/.env`

Copy from `apps/api/.env.example`.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the Express API server listens on |
| `PUBSUB_TOPIC` | `orchestrator-logs` | Pub/Sub topic name for log messages |
| `PUBSUB_SUBSCRIPTION` | `orchestrator-logs-sub` | Pub/Sub subscription the API listens to |
| `PUBSUB_EMULATOR_HOST` | `localhost:8085` | Points the Pub/Sub SDK to the local emulator instead of real GCP |
| `PUBSUB_PROJECT_ID` | `local-dev` | GCP project ID used by Pub/Sub (emulator accepts any string) |
| `GCP_PROJECT` | `local-dev` | Alias for `PUBSUB_PROJECT_ID`, also passed to spawned containers |
| `ORCHESTRATOR_PORT` | `3002` | Host port the Orchestrator Docker container is mapped to |
| `ORCHESTRATOR_URL` | `http://localhost:3002` | Full URL used by the API to communicate with the Orchestrator |
| `ORCHESTRATOR_IMAGE` | `playrunner-orchestrator` | Docker image name for the Orchestrator (built by `start-local.sh`) |
| `PUBSUB_EMULATOR_HOST_DOCKER` | `host.docker.internal:8085` | Pub/Sub emulator address **as seen from inside Docker containers** |
| `EDITOR_API_URL_DOCKER` | `http://host.docker.internal:3001` | API server URL **as seen from inside Docker containers** (passed to the Orchestrator container so it can heartbeat back) |
| `GCS_BUCKET_PREFIX` | _(required for GCP)_ | Prefix used when creating per-workflow GCS output buckets |
| `GCS_PROJECT_ID` | _(required for GCP)_ | GCP project used by GCS clients when a selected project is not passed |
| `GCP_CLOUD_RUN_LOCATION` | _(required for GCP)_ | Cloud Run region for the GCP orchestrator service |
| `GCP_ORCHESTRATOR_SERVICE_NAME` | _(required for GCP)_ | Cloud Run service name for the remote orchestrator |
| `GCP_ORCHESTRATOR_IMAGE_URI_TEMPLATE` | _(required for GCP)_ | Orchestrator container image URI template; supports `{projectId}` |

> **Why two Pub/Sub host variables?**  
> `PUBSUB_EMULATOR_HOST` is for the API process running on the host (`localhost:8085`).  
> `PUBSUB_EMULATOR_HOST_DOCKER` is forwarded as an environment variable into Docker containers (`host.docker.internal:8085`), because inside a container `localhost` refers to the container itself, not your Mac.

---

## Web App — `apps/web/.env`

Copy from `apps/web/.env.example`.

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://127.0.0.1:3001` | Target for the Vite dev-server proxy (`/api/*` and `/outputs/*`) |
| `VITE_SETUP_INSTALLER_URL` | `http://127.0.0.1:3003` | Target for the Vite dev-server proxy (`/setup-api/*`) |
| `GEMINI_API_KEY` | _(empty)_ | API key for Gemini AI features; injected at runtime in production |
| `APP_URL` | _(empty)_ | Self-referential URL; not needed for local dev |

Only `VITE_API_URL` is functionally relevant in local development.

---

## Orchestrator — `apps/runners/orchestrator/.env`

This file is **not used** when the Orchestrator runs as a Docker container (all variables are injected via `docker run -e` flags by the API). It is provided as a reference for running the Orchestrator directly on the host during debugging.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | Port the Orchestrator Express server listens on |
| `EDITOR_API_URL` | `http://localhost:3001` | API server URL for heartbeat pings |
| `PUBSUB_TOPIC` | `orchestrator-logs` | Pub/Sub topic to publish logs to |
| `PUBSUB_EMULATOR_HOST` | `localhost:8085` | Pub/Sub emulator address |
| `PUBSUB_PROJECT_ID` | `local-dev` | GCP project ID |
| `GCP_PROJECT` | `local-dev` | Alias for `PUBSUB_PROJECT_ID` |
| `PLAYWRIGHT_IMAGE_BASE` | `playrunner-playwright-runner` | Base Docker image prefix for Playwright runner containers; the orchestrator appends `-typescript` or `-python` |
| `PUBSUB_EMULATOR_HOST_DOCKER` | `host.docker.internal:8085` | Pub/Sub emulator address passed into spawned Playwright containers |
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
| `PUBSUB_EMULATOR_HOST` | Pub/Sub emulator address (`host.docker.internal:8085`) |
| `PUBSUB_PROJECT_ID` | GCP project ID (`local-dev`) |
| `GCP_PROJECT` | GCP project ID (`local-dev`) |
| Any user-defined env vars | Injected from the Environment node's configured variables |

---

## How Variables Flow Through the Stack

```
.env (API)
  └─ PUBSUB_EMULATOR_HOST           → API Pub/Sub SDK
  └─ PUBSUB_EMULATOR_HOST_DOCKER    → passed to Orchestrator container (-e)
  └─ EDITOR_API_URL_DOCKER          → passed to Orchestrator container (-e)

Orchestrator container (env from API's docker run)
  └─ PUBSUB_EMULATOR_HOST_DOCKER    → passed to Playwright container (-e PUBSUB_EMULATOR_HOST)
  └─ PUBSUB_PROJECT_ID              → passed to Playwright container (-e)
  └─ GCP_PROJECT                    → passed to Playwright container (-e)
  └─ PAYLOAD (full config)          → passed to Playwright container (-e)
```
