---
sidebar_position: 7
title: Workflow Execution Flow
---

# Workflow Execution Flow

> **Local development only.** This describes the full journey of a workflow run from the moment you click "Run" in the editor.

---

## Overview

A workflow is a directed acyclic graph (DAG) of nodes. When triggered, the system:

1. Generates a unique `testId` (UUID) for the run
2. Sends the entire graph to the Orchestrator
3. The Orchestrator walks the graph, processing each node according to its type and the connection types between nodes
4. Each Playwright node prepares a runner container early, then signals it to run when the DAG reaches that node

---

## Step-by-Step

### 1. User clicks "Run" in the Editor

The Editor sends `POST /api/workflows/start` with:

- `nodes` — array of all nodes (id, nodeType, label, config, parentId)
- `connections` — array of edges (sourceId, targetId, type)
- `settings` — all integration credentials (GitHub, Slack, etc.)

The API immediately generates a UUID `testId`, appends it to the body, and forwards the request to `POST {ORCHESTRATOR_URL}/execute`.

### 2. Orchestrator receives `/execute`

The Orchestrator responds `200 { status: 'started' }` immediately (async execution begins in the background) and:

1. **Extracts global environment variables** from all `Environment` nodes in the graph
2. **Resolves implicit connections**: if a node has a `parentId` and no explicit connection exists to it from that parent, a sequential connection is added automatically
3. **Identifies start nodes**: any node with no incoming connections
4. **Walks the graph** in DAG order, calling `processNode()` for each

### 3. DAG Traversal & Connection Types

The Orchestrator supports four connection types between nodes:

| Type          | Behaviour                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `sequential`  | Runs after the source node completes. If any `success`/`failure` connections also exist on the source, this type only runs on success. |
| `concurrent`  | Starts immediately when the source node starts (fire-and-forget, not awaited)                                                          |
| `success`     | Runs only if the source node completed with `success` or `warning` state                                                               |
| `failure`     | Runs only if the source node completed with `error` state                                                                              |
| `independent` | Always runs after source, regardless of outcome                                                                                        |

### 4. Node Processing by Type

#### `environment`

Logs the node label. Global variables have already been extracted in step 2.

#### `playwright`

1. Logs resource configuration (CPU, memory, workers)
2. Builds `docker run` arguments:
   - The selected Pub/Sub event transport config (local emulator for Docker runners, GCP Pub/Sub for GCP runners)
   - User-defined environment variables (resolved from the Environment node)
   - The full `PAYLOAD` JSON containing repo config, GitHub tokens, `nodeId`, and `testId`
3. Selects image tag from `config.playwrightVersion` (falls back to `latest`)
4. Starts or reuses the prepared Playwright runner
5. Signals the runner over Pub/Sub when the node is ready to execute
6. Awaits the container to exit — success = `0`, failure = non-zero or `null` (killed)

#### `slack`

Checks if Slack credentials exist in `settings`. Logs a warning if missing, simulates a message send if present.

#### `github`

Checks if GitHub credentials exist in `settings`. Logs and sets node state accordingly.

#### All other types

Logs the node label and completes with `success`.

### 5. Playwright Runner Container

Inside the container (`apps/runners/playwright/src/index.ts`):

1. Parses `PAYLOAD` from the environment
2. If `action === 'clone'` (or a `repository` is set), clones the GitHub repo:
   - Uses `https://x-access-token:{token}@github.com/{repo}.git`
   - Clones to `/app/repo` with `--depth 1` (shallow clone)
   - Sets `workingDir` to `/app/repo/{folder}`
3. **Auto-detects language**: if `requirements.txt` or `pytest.ini` is found → Python, otherwise TypeScript
4. **Preparation**: installs dependencies before execution starts. TypeScript reuses runner-bundled Playwright packages when possible; otherwise it uses `npm ci` when a lockfile exists, falling back to `npm install`. Python installs `requirements.txt` when present.
5. Waits for a Pub/Sub start signal from the Orchestrator
6. Runs `playwright test` (TypeScript) or `pytest` (Python)
7. **Uploads outputs**: local Docker runs tarball `playwright-report/` and `test-results/` and POSTs the archive to `POST {editorApiUrl}/api/outputs/{testId}/{nodeId}`; GCP runs upload artifacts directly to GCS. In both modes, the resulting `node_output` event is published through Pub/Sub.
8. Exits with `0` (success) or `1` (test failure)

### 6. Output Processing (API)

When the API receives `POST /api/outputs/:testId/:nodeId`:

1. Creates the directory `public/outputs/{testId}/{nodeId}/`
2. Extracts the tarball using `tar -xzf -`
3. Scans for:
   - `playwright-report/index.html` → constructs a `reportUrl`
   - `test-results/**/*.webm` and `*.png` → constructs `media` URLs
4. Returns the discovered output metadata to the runner; for local Pub/Sub runs, the runner publishes the `node_output` event

### 7. Real-Time Logs via SSE

Throughout local Docker and GCP workflows, the Playwright runner and Orchestrator publish signed event payloads to Pub/Sub. Local Docker uses the Pub/Sub emulator; GCP uses GCP Pub/Sub. In both cases, the API stores every accepted event in PostgreSQL, and the editor listens on `GET /api/executions/:executionId/stream` for the specific run it started.

---

## Node States

Each node transitions through these states, persisted as `node_state` events:

| State     | Meaning                                                                |
| --------- | ---------------------------------------------------------------------- |
| `idle`    | Not yet started                                                        |
| `pending` | Playwright runner is being provisioned but has not started executing   |
| `running` | Currently executing                                                    |
| `success` | Completed successfully                                                 |
| `warning` | Completed but with missing optional config (e.g. no Slack credentials) |
| `error`   | Failed                                                                 |

---

## Test ID & Output Directory Structure

Every workflow run is assigned a unique UUID `testId`. Outputs are stored and served under:

```
/outputs/{testId}/{nodeId}/playwright-report/index.html
/outputs/{testId}/{nodeId}/test-results/...
```

This means multiple runs for the same node do not overwrite each other's results.
