---
sidebar_position: 6
title: Docker Images
---

# Docker Images

> **Local development only.** Both the Orchestrator and Playwright runner run as Docker images that must be built on your local machine before use.

---

## Why Docker?

The Orchestrator and Playwright runner are isolated in Docker for two reasons:

1. **Isolation** — test runs cannot affect the host system or each other.
2. **Version control** — multiple Playwright versions can coexist as tagged images.

The images are built locally (not pulled from a registry) so changes to the runner code are reflected immediately after a rebuild.

---

## Building the Images

`start-local.sh` builds all images automatically. You can also build them manually:

### Orchestrator

```bash
docker build -t playrunner-orchestrator ./apps/runners/orchestrator
```

**Base image:** `node:24-alpine`  
**Extra packages installed:** `docker-cli` (so the container can run `docker` commands against the host socket)  
**Entry point:** `node dist/index.js`

### Playwright Runner

The Playwright runner supports multiple Playwright versions via a shared config file and Docker build argument:

```bash
# Inspect configured versions
node infra/scripts/playwright-runner-config.mjs json

# Build one configured version explicitly
docker build \
  --platform linux/amd64 \
  -f ./apps/runners/playwright/Dockerfile.typescript \
  --build-arg PLAYWRIGHT_VERSION=v1.59.0-jammy \
  -t playrunner-playwright-runner-typescript:latest \
  -t playrunner-playwright-runner-typescript:v1.59.0-jammy \
  ./apps/runners/playwright

docker build \
  --platform linux/amd64 \
  -f ./apps/runners/playwright/Dockerfile.python \
  --build-arg PLAYWRIGHT_VERSION=v1.59.0-jammy \
  -t playrunner-playwright-runner-python:latest \
  -t playrunner-playwright-runner-python:v1.59.0-jammy \
  ./apps/runners/playwright
```

`start-local.sh`, `infra/gcp/scripts/push-runners.sh`, and the Playwright settings modal all read from `config/playwright-runner-versions.json`.

**Base image:** `mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}`  
**Entry point:** `node dist/index.js`

---

## Image Tags

| Tag                                                        | Playwright Version               | Notes                                                                      |
| ---------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `playrunner-playwright-runner-typescript:latest`           | Tag with `publishAsLatest: true` | Alias for the current latest configured TypeScript runner                  |
| `playrunner-playwright-runner-typescript:<configured-tag>` | Matching configured tag          | One TypeScript image per entry in `config/playwright-runner-versions.json` |
| `playrunner-playwright-runner-python:latest`               | Tag with `publishAsLatest: true` | Alias for the current latest configured Python runner                      |
| `playrunner-playwright-runner-python:<configured-tag>`     | Matching configured tag          | One Python image per entry in `config/playwright-runner-versions.json`     |
| `playrunner-orchestrator`                                  | —                                | The orchestrator image (no version tagging)                                |

The Playwright node in the editor exposes a `playwrightVersion` config field and a runtime selector. The Orchestrator uses both values to choose the Docker image tag (for example `playrunner-playwright-runner-python:v1.59.0-jammy`).

---

## How the Orchestrator Prepares Playwright Containers

When the Orchestrator receives a workflow, it scans the whole graph for
Playwright nodes and starts their containers in preparation mode before the DAG
reaches those nodes. Locally, each prepared runner starts with the equivalent of:

```bash
docker run --rm \
  -e GCP_PROJECT=local-dev \
  -e PUBSUB_EMULATOR_HOST=host.docker.internal:8085 \
  -e MY_ENV_VAR=value \           # user-defined env vars from the Environment node
  -e PAYLOAD='{"data":{...},...}' \  # full JSON config
  playrunner-playwright-runner-typescript:<configured-tag>
```

The `--rm` flag ensures the container is deleted after it exits. No Docker volumes are mounted for the Playwright runner — local output archives are uploaded to the API via HTTP before the container exits, while logs, states, `runner_control`, `runner_status`, and output events go through Pub/Sub.

---

## Docker Socket Access

The Orchestrator container receives the host Docker socket mounted as a volume:

```
-v /var/run/docker.sock:/var/run/docker.sock
```

This is what allows the Orchestrator (running inside Docker) to spawn Playwright containers on the host's Docker daemon. The containers it spawns appear as siblings, not children, in `docker ps`.

---

## Rebuilding After Code Changes

If you modify any source code under `apps/runners/orchestrator/` or `apps/runners/playwright/`, you must rebuild the affected image(s) before the changes take effect:

```bash
# Rebuild orchestrator only
docker build -t playrunner-orchestrator ./apps/runners/orchestrator

# Rebuild playwright runners from shared config
./start-local.sh
```

Then restart the Orchestrator container: close and reopen the Editor tab, which triggers `POST /api/runners/start` and spawns a fresh container.

---

## Publishing to GCP

For the end-to-end infrastructure and GCP integration runbook, see
[GCP Setup](../cloud-architecture/gcp/setup). This section documents the image
publishing helper itself.

Running workflows against the GCP execution path requires the Orchestrator and Playwright images to be available in a registry that Cloud Run can pull from. The repo ships a helper that builds and pushes them to Google Artifact Registry, redeploys the Orchestrator Cloud Run service, and clears stale Playwright Cloud Run Jobs so they pick up the new image:

```bash
./infra/gcp/scripts/push-runners.sh
```

### Prerequisites

1. **Connect GCP in the Integrations modal.** The script reads the GCP project, region, Cloud Run service name, and image URI templates straight from the `CloudCredential` row that the modal writes to Postgres. Nothing else stores these values.
2. **Apply the Terraform under `infra/gcp`** at least once so the required GCP APIs are enabled and the `orchestrator` and `playwright-runner` Artifact Registry repositories and shared workflow-events Pub/Sub topic exist in your project. Apply it again before publishing if the saved project, region, repository path, or workflow-events topic changed.
3. **Local tooling on `PATH`:** `docker`, `gcloud`, and `node`. `apps/api/.env` must contain a working `DATABASE_URL` (the script reuses Prisma from `apps/api/node_modules` to read the credential).
4. **GCloud authentication:** run `gcloud auth login` before publishing. The push script configures Docker's Artifact Registry credential helper for the target registry host automatically.

### Reading the stored settings

If you want to confirm what the script will use before running it:

```bash
node infra/gcp/scripts/gcp-settings.mjs json
```

This only emits the non-secret fields (`selectedProject`, `cloudRunLocation`, `orchestratorServiceName`, `orchestratorImageUriTemplate`, `playwrightImageUriTemplate`). Each value is also available as its own subcommand: `project-id`, `region`, `orchestrator-service-name`, `orchestrator-image-uri-template`, `playwright-image-uri-template`. Run `./infra/gcp/scripts/push-runners.sh --help` for the wrapper script's options.

If these saved values changed, rerun the push script after saving:

```bash
./infra/gcp/scripts/push-runners.sh --target both --yes
```

Run Terraform first when the changed values point at a project, region, Artifact
Registry repository, or Pub/Sub topic that does not already exist.

### Usage

Interactive (confirmation prompt, then menu for orchestrator / playwright / both):

```bash
./infra/gcp/scripts/push-runners.sh
```

Non-interactive, e.g. for CI:

```bash
./infra/gcp/scripts/push-runners.sh --target both --yes
```

One-off override (push to a project other than the one saved in the modal):

```bash
./infra/gcp/scripts/push-runners.sh --project-id my-other-project --target orchestrator --yes
```

All flags:

| Flag                                      | Effect                                                              |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `--project-id <id>`                       | Override the stored GCP project ID                                  |
| `--region <region>`                       | Override the stored Cloud Run region                                |
| `--orchestrator-service-name <n>`         | Override the stored Cloud Run service name                          |
| `--user-id <id>`                          | Filter the Postgres lookup when multiple users have GCP credentials |
| `--target orchestrator\|playwright\|both` | Skip the interactive menu                                           |
| `--base-path <path>`                      | `BASE_PATH` build arg for the Orchestrator image (default `.`)      |
| `--yes`, `-y`                             | Skip the confirmation prompt                                        |

### What it does

- **Docker auth:** configures Docker for the target Artifact Registry host with `gcloud auth configure-docker`.
- **Orchestrator:** builds `apps/runners/orchestrator` as `linux/amd64`, tags it using `orchestratorImageUriTemplate` (with `{projectId}` substituted), pushes it, and runs `gcloud run deploy <orchestratorServiceName> --image ... --cpu-boost` to roll out the new image.
- **Playwright:** for both `typescript` and `python`, builds every tag in `config/playwright-runner-versions.json`. The tag flagged `publishAsLatest: true` is additionally pushed as `:latest`. Tags use `playwrightImageUriTemplate` with `{projectId}`, `{runtime}`, and `{version}` substituted.
- **Job cleanup:** deletes any existing Cloud Run Jobs named `playrunner-*` in the configured region so the next workflow execution recreates them with the new image.
