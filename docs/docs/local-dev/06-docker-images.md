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

`start-local.sh`, `infra/scripts/push-runners.sh`, and the Playwright settings modal all read from `config/playwright-runner-versions.json`.

**Base image:** `mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}`  
**Entry point:** `node dist/index.js`

---

## Image Tags

| Tag | Playwright Version | Notes |
|---|---|---|
| `playrunner-playwright-runner-typescript:latest` | Tag with `publishAsLatest: true` | Alias for the current latest configured TypeScript runner |
| `playrunner-playwright-runner-typescript:<configured-tag>` | Matching configured tag | One TypeScript image per entry in `config/playwright-runner-versions.json` |
| `playrunner-playwright-runner-python:latest` | Tag with `publishAsLatest: true` | Alias for the current latest configured Python runner |
| `playrunner-playwright-runner-python:<configured-tag>` | Matching configured tag | One Python image per entry in `config/playwright-runner-versions.json` |
| `playrunner-orchestrator` | — | The orchestrator image (no version tagging) |

The Playwright node in the editor exposes a `playwrightVersion` config field and a runtime selector. The Orchestrator uses both values to choose the Docker image tag (for example `playrunner-playwright-runner-python:v1.59.0-jammy`).

---

## How the Orchestrator Spawns Playwright Containers

When the Orchestrator processes a Playwright node, it runs the equivalent of:

```bash
docker run --rm \
  -e PUBSUB_EMULATOR_HOST=host.docker.internal:8085 \
  -e PUBSUB_PROJECT_ID=local-dev \
  -e GCP_PROJECT=local-dev \
  -e MY_ENV_VAR=value \           # user-defined env vars from the Environment node
  -e PAYLOAD='{"data":{...},...}' \  # full JSON config
  playrunner-playwright-runner-typescript:<configured-tag>
```

The `--rm` flag ensures the container is deleted after it exits. No Docker volumes are mounted for the Playwright runner — outputs are uploaded to the API via HTTP before the container exits.

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
