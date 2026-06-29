---
sidebar_position: 5
title: Environment Variables
---

# Environment Variables

> **Local development only.** Each service reads its configuration from environment variables. Defaults are designed to work out-of-the-box for local dev.

---

## Local Startup — `.env.local`

Copy from `.env.local.example`.

| Variable                    | Default                             | Description                                                                                     |
| --------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `WEB_PORT`                  | `3000`                              | Port used by both the setup app and the normal web app                                          |
| `DOCS_PORT`                 | `3004`                              | Port used by the local Docusaurus docs site started by `./start-local.sh`                       |
| `SETUP_INSTALLER_PORT`      | `3003`                              | Port used by the local setup installer service                                                  |
| `POSTGRES_PORT`             | `5432`                              | Host port mapped to the Docker-backed Postgres container                                        |
| `POSTGRES_HOST`             | `127.0.0.1`                         | Hostname used when deriving the default local Prisma connection                                 |
| `POSTGRES_DB`               | `playrunner`                        | Database name for the standard local Postgres container                                         |
| `POSTGRES_USER`             | `postgres`                          | Username for the standard local Postgres container                                              |
| `POSTGRES_PASSWORD`         | `postgres`                          | Password for the standard local Postgres container                                              |
| `PUBSUB_EMULATOR_PORT`      | `8085`                              | Host port mapped to the Docker-backed Pub/Sub emulator                                          |
| `PUBSUB_EMULATOR_HOST`      | `127.0.0.1:8085`                    | Host-facing Pub/Sub emulator endpoint used by the API                                           |
| `LOCAL_PUBSUB_PROJECT_ID`   | `playrunner-local`                  | Project ID used for local Pub/Sub emulator topics and subscriptions                             |
| `DATABASE_URL`              | _(optional)_                        | Explicit Prisma datasource URL override for both setup defaults and the normal API startup path |
| `VITE_DEFAULT_DATABASE_URL` | _(optional)_                        | Override only the database URL prefilled in the setup form                                      |
| `VITE_DOCS_URL`             | Derived from `DOCS_PORT` by default | Optional full override for the header `Docs` link during repo-root local startup                |

`./start-local.sh` loads this file first, uses it to start Docker-backed services, and passes the derived defaults into the setup app. If a legacy repo-root `.env` still exists and `.env.local` does not, the script renames it to `.env.local` automatically.

---

## API Server — `apps/api/.env`

Created from `apps/api/.env.example` during setup when needed, then updated by the setup installer. During normal local startup, `./start-local.sh` also keeps `DATABASE_URL` aligned with the repo-root `.env.local` when you are still using the standard Docker-backed Postgres settings.

The GCP variables in this file are only needed when this API instance should
trigger GCP-backed workflow executions. Standard local Docker workflows can
leave them unset.

| Variable                           | Default                                        | Description                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                             | `3001`                                         | Port the Express API server listens on                                                                                                                                                                                                                                          |
| `DATABASE_URL`                     | Derived from repo-root `.env.local` by default | Prisma datasource used for app data and workflow execution events. In the standard local flow this resolves to `postgresql://postgres:postgres@127.0.0.1:<POSTGRES_PORT>/playrunner?schema=public` unless you explicitly override `DATABASE_URL` in the repo-root `.env.local`. |
| `GCP_PROJECT`                      | `local-dev`                                    | GCP project ID used for Cloud Storage / Cloud Run integrations                                                                                                                                                                                                                  |
| `ORCHESTRATOR_PORT`                | `3002`                                         | Host port the Orchestrator Docker container is mapped to                                                                                                                                                                                                                        |
| `ORCHESTRATOR_URL`                 | `http://localhost:3002`                        | Full URL used by the API to communicate with the Orchestrator                                                                                                                                                                                                                   |
| `LOCAL_ORCHESTRATOR_IMAGE`         | `playrunner-orchestrator`                      | Docker image name for the local Orchestrator container built by `start-local.sh`. Remote GCP runs use the image URI template saved in the GCP integration settings instead.                                                                                                     |
| `EDITOR_API_URL_DOCKER`            | `http://host.docker.internal:3001`             | API server URL **as seen from inside Docker containers**; local Playwright runners still use it to upload compressed output archives                                                                                                                                            |
| `PUBSUB_EMULATOR_HOST`             | Inherited from repo-root `.env.local`          | Host-facing Pub/Sub emulator endpoint used by the API for local workflow event ingest                                                                                                                                                                                           |
| `PUBSUB_EMULATOR_HOST_DOCKER`      | `host.docker.internal:<PUBSUB_EMULATOR_PORT>`  | Container-facing Pub/Sub emulator endpoint injected into local Orchestrator and Playwright runner containers                                                                                                                                                                    |
| `LOCAL_PUBSUB_PROJECT_ID`          | `playrunner-local`                             | Project ID used by the API when creating local emulator topics and subscriptions                                                                                                                                                                                                |
| `GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC` | `playrunner-workflow-events`                   | Pub/Sub topic name used for workflow execution events. Local runs create/use this topic in the emulator; GCP runs use the managed GCP topic created by Terraform.                                                                                                               |
| `GCS_BUCKET_PREFIX`                | _(required for GCP)_                           | Required only for GCP-backed workflow execution. Prefix used when the API creates per-workflow GCS output buckets before triggering Cloud Run.                                                                                                                                  |
| `GCS_PROJECT_ID`                   | _(optional fallback for GCP)_                  | Optional fallback project for GCS clients when a selected project is not supplied by the GCP workflow request.                                                                                                                                                                  |

Remote GCP runner settings such as Cloud Run region, Orchestrator service name,
Orchestrator min/max instances, CPU idle policy, and image URI templates are
stored in the GCP integration credential row, not in `apps/api/.env`.

---

## Web App — `apps/frontend/.env`

Optional. The standard local flow does not require this file.

| Variable                   | Default                       | Description                                                                                                           |
| -------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`             | `http://127.0.0.1:3001`       | Target for the Vite dev-server proxy (`/api/*` and `/outputs/*`) when you run the frontend outside `./start-local.sh` |
| `VITE_SETUP_INSTALLER_URL` | `http://127.0.0.1:3003`       | Target for the Vite dev-server proxy (`/setup-api/*`) when you run the setup app outside `./start-local.sh`           |
| `VITE_DOCS_URL`            | `https://docs.playrunner.dev` | Target for the header `Docs` link when you run the frontend outside `./start-local.sh`                                |
| `GEMINI_API_KEY`           | _(empty)_                     | API key for Gemini AI features; injected at runtime in production                                                     |
| `APP_URL`                  | _(empty)_                     | Self-referential URL; not needed for local dev                                                                        |

When you use `./start-local.sh`, it exports the correct local proxy targets automatically, so this file is only needed for standalone frontend debugging.

---

## Orchestrator — `apps/runners/orchestrator/.env`

This file is **not used** when the Orchestrator runs as a Docker container (all variables are injected via `docker run -e` flags by the API). It is provided as a reference for running the Orchestrator directly on the host during debugging.

| Variable                            | Default                        | Description                                                                                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                              | `3002`                         | Port the Orchestrator Express server listens on                                                                                                                                                                                                                       |
| `EDITOR_API_URL`                    | `http://localhost:3001`        | API server URL used by local runners for output archive uploads                                                                                                                                                                                                       |
| `PUBSUB_EMULATOR_HOST`              | _(optional)_                   | Container-facing Pub/Sub emulator endpoint when running the Orchestrator locally against the local event bus                                                                                                                                                          |
| `GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC`  | `playrunner-workflow-events`   | Pub/Sub topic name used for workflow execution events                                                                                                                                                                                                                 |
| `GCP_PROJECT`                       | `local-dev`                    | GCP project ID used for Cloud Storage / Cloud Run integrations                                                                                                                                                                                                        |
| `PLAYWRIGHT_IMAGE_BASE`             | `playrunner-playwright-runner` | Base Docker image prefix for Playwright runner containers; the orchestrator appends `-typescript` or `-python`                                                                                                                                                        |
| `GCP_CLOUD_RUN_API_BASE_URL`        | _(required for GCP)_           | Cloud Run API base URL used to create/run Playwright jobs                                                                                                                                                                                                             |
| `GCP_CLOUD_RUN_LOCATION`            | _(required for GCP)_           | Cloud Run region for GCP Playwright jobs                                                                                                                                                                                                                              |
| `GCP_PLAYWRIGHT_IMAGE_URI_TEMPLATE` | _(required for GCP)_           | URI template for already-pushed Playwright runner images that Cloud Run Jobs can pull. Supports `{projectId}`, `{runtime}`, and `{version}`.                                                                                                                          |
| `GCP_PLAYWRIGHT_JOB_NAME_TEMPLATE`  | `playrunner-{runtime}`         | Optional Cloud Run job name template; supports `{runtime}`, `{version}`, `{cpu}`, `{memory}`, and `{nodeId}`. If `{nodeId}` is omitted, Playrunner appends a stable node suffix so sibling Playwright nodes can run in parallel instead of sharing one Cloud Run Job. |

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
    "editorApiUrl": "http://host.docker.internal:3001",
    "eventTransport": {
      "type": "gcp_pubsub",
      "projectId": "playrunner-local",
      "topicName": "playrunner-workflow-events"
    },
    "runnerControl": {
      "controlSubscriptionName": "projects/playrunner-local/subscriptions/playrunner-runner-control-...",
      "statusSubscriptionName": "projects/playrunner-local/subscriptions/playrunner-runner-status-...",
      "topicName": "playrunner-workflow-events",
      "type": "gcp_pubsub"
    }
  },
  "github": {
    "accessToken": "gha_...",
    "refreshToken": "ghr_...",
    "clientId": "...",
    "clientSecret": "..."
  }
}
```

`eventTransport` and `runnerControl` use the same payload shape for local Docker
and GCP. Local Docker varies only by environment: `PUBSUB_EMULATOR_HOST` points
the Pub/Sub client at the emulator. GCP omits that emulator variable and uses the
managed Pub/Sub API. The control/status subscriptions are polled with
non-blocking Pub/Sub pulls; the polling interval is owned by Playrunner rather
than by Pub/Sub long-poll timing.

The runner also receives these additional environment variables:

| Variable                  | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `GCP_PROJECT`             | GCP project ID (`local-dev`)                              |
| `PUBSUB_EMULATOR_HOST`    | Pub/Sub emulator endpoint for local Docker workflow runs  |
| Any user-defined env vars | Injected from the Environment node's configured variables |

---

## How Variables Flow Through the Stack

```
.env.local
  └─ PUBSUB_EMULATOR_HOST           → API local Pub/Sub ingest endpoint
  └─ LOCAL_PUBSUB_PROJECT_ID        → local emulator project ID

.env (API)
  └─ DATABASE_URL                   → Prisma + workflow event storage
  └─ EDITOR_API_URL_DOCKER          → passed to local runners for output uploads
  └─ PUBSUB_EMULATOR_HOST_DOCKER    → passed to local runner containers (-e)

Orchestrator container (env from API's docker run)
  └─ GCP_PROJECT                    → passed to Playwright container (-e)
  └─ PUBSUB_EMULATOR_HOST           → passed to local Playwright container (-e)
  └─ PAYLOAD (full config)          → passed to Playwright container (-e)
```
