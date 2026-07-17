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
4. Each Playwright node gets a runner prepared in the background, then receives a start signal only when the DAG reaches that node

Before traversal starts, every persisted node is preflighted against either a
host-managed type or the package executors statically composed into the
Orchestrator image. A missing `nodeType`, unsupported action, or unavailable
executor fails the workflow explicitly; unknown nodes no longer log and succeed
silently.

## Build-Time and Runtime Responsibilities

Executable marketplace integrations are selected and installed at image build
time, never during workflow execution. Each selected package declares its own
Orchestrator surface and default export. The build scans installed direct
production dependencies and generates deterministic static imports; no package
author edits a shared provider registry. The running Orchestrator can only
execute the package contributions already bundled into its artifact. Adding or
upgrading an executor requires rebuilding and replacing the Orchestrator image.

At runtime, users can connect provider credentials, add a bundled node to the
workflow, connect it to other nodes, choose a supported action, and configure
its fields. The host resolves the persisted `nodeType` and optional
`config.action`, then gives the selected executor only its provider-scoped
settings plus controlled capabilities such as templating, logging, environment
values, timeout, and cancellation.

---

## Step-by-Step

### 1. User clicks "Run" in the Editor

The Editor sends `POST /api/workflows/start` with:

- `nodes` — array of all nodes (id, nodeType, label, config, parentId)
- `connections` — array of edges (sourceId, targetId, type)
- `settings` — all connected integration credentials (GitHub, Slack, Jira, etc.)

The API immediately generates a UUID `testId`, appends it to the body, and forwards the request to `POST {ORCHESTRATOR_URL}/execute`.

### 2. Orchestrator receives `/execute`

The Orchestrator responds `200 { status: 'started' }` immediately (async execution begins in the background) and:

1. **Preflights every node** using its persisted `nodeType` and optional
   `config.action`. Host-managed nodes are accepted directly; all other nodes
   must resolve through the provider-agnostic resolver to an executor in the
   generated build composition.
2. **Extracts global environment variables** from all `Environment` nodes in the graph
3. **Resolves implicit connections**: if a node has a `parentId` and no explicit connection exists to it from that parent, a sequential connection is added automatically
4. **Schedules Playwright runner preparation**: scans the full workflow for Playwright nodes and starts each runner in preparation mode in the background so dependency installation can overlap with earlier nodes
5. **Identifies start nodes**: any node with no incoming connections
6. **Walks the graph** in DAG order, calling `processNode()` for each

Because `/execute` accepts the request asynchronously, a preflight failure is
published as a `workflow_failed` event rather than changing the initial HTTP
`200` response.

Runner preparation status events are best-effort and do not block DAG startup. For example, an `Environment` node with no incoming connections should start as soon as the Orchestrator begins graph traversal, even if Playwright Cloud Run Jobs are still preparing.

### 3. DAG Traversal & Connection Types

The Orchestrator supports four connection types between nodes:

| Type          | Behaviour                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `sequential`  | Runs after the source node completes. If any `success`/`failure` connections also exist on the source, this type only runs on success. |
| `concurrent`  | Starts immediately when the source node starts (fire-and-forget, not awaited)                                                          |
| `success`     | Runs only if the source node completed with `success` or `warning` state                                                               |
| `failure`     | Runs only if the source node completed with `error` state                                                                              |
| `independent` | Always runs after source, regardless of outcome                                                                                        |

When a source node has multiple outgoing connections that become eligible at
the same trigger moment, the targets start together as sibling branches. For
example, two `sequential` edges from A to B and C both wait for A to complete,
then B and C run in parallel. They do not wait for each other unless there is a
separate connection between B and C.

For Playwright sibling branches in GCP, each sibling uses a node-specific Cloud
Run Job name. That keeps sibling branches from being serialized through the same
Cloud Run Job when they share the same runtime, version, CPU, and memory
settings.

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
5. Waits for the prepared runner's `runner_status=ready` message when needed
6. Signals the runner over Pub/Sub with a `runner_control=start` message when the node is ready to execute
7. Awaits the container or Cloud Run Job execution to exit — success = `0`, failure = non-zero or `null` (killed)

The Orchestrator and runner poll Pub/Sub status/control subscriptions with non-blocking pulls and their own short sleep interval. That keeps runner readiness and start acknowledgement tied to the Playrunner polling loop rather than to Pub/Sub long-poll timing.

#### `slack`

Runs the Slack executor bundled from `@playrunner/slack/orchestrator`. It renders
the configured message and username templates, then sends a real request using
the connected incoming webhook or Slack Bot API credentials. Bot API requests
also require a configured channel. Missing credentials, invalid configuration,
provider errors, cancellation, and timeout all produce an `error` node state;
there is no simulated success path.

#### `jira`

Runs the Jira executor bundled from `@playrunner/jira/orchestrator`. With no
explicit action, or with `config.action: "create"`, it creates an issue. The
`update` action updates the configured issue key. Summary, description, and
issue key fields support host templating. Missing credentials, missing project
selection, Jira API failures, cancellation, and timeout produce an `error` node
state. An unsupported action fails workflow preflight before traversal begins.

#### `github`

Checks if GitHub credentials exist in `settings`. Logs and sets node state accordingly.

#### Other package-owned types

The Orchestrator resolves the exact persisted `nodeType` and optional action
from the generated build composition. It does not fall back to the display
label. If no executor was selected and bundled, workflow preflight reports:

```text
Orchestrator executor not installed/registered for node type "<nodeType>" ... Rebuild and redeploy the orchestrator with a package that registers this executor.
```

Registered executors return `success` or `warning`, can publish a node output,
and receive a host-provided execution context with provider-scoped settings.
Thrown errors become an `error` node state and mark the workflow as failed.

### 5. Playwright Runner Container

Inside the container (`apps/runners/playwright/src/index.ts`):

1. Parses `PAYLOAD` from the environment
2. If `action === 'clone'` (or a `repository` is set), clones the GitHub repo:
   - Uses `https://x-access-token:{token}@github.com/{repo}.git`
   - Clones to `/app/repo` with `--depth 1` (shallow clone)
   - Sets `workingDir` to `/app/repo/{folder}`
3. **Auto-detects language**: if `requirements.txt` or `pytest.ini` is found → Python, otherwise TypeScript
4. **Preparation**: installs dependencies before execution starts. TypeScript reuses runner-bundled Playwright packages when possible; otherwise it uses `npm ci` when a lockfile exists, falling back to `npm install`. Python installs `requirements.txt` when present.
5. Publishes `runner_status=ready`, then waits for a Pub/Sub start signal from the Orchestrator
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

The API orders the SSE stream by PostgreSQL event sequence. In the editor log panel, entries are inserted by event timestamp so messages from API setup, the Orchestrator Cloud Run service, and Playwright Cloud Run Jobs display in the order they happened, even when Pub/Sub delivery and API-side events arrive at different moments.

---

## Node States

Each node transitions through these states, persisted as `node_state` events:

| State     | Meaning                                                                     |
| --------- | --------------------------------------------------------------------------- |
| `idle`    | Not yet started                                                             |
| `pending` | Playwright runner is being provisioned but has not started executing        |
| `running` | Currently executing                                                         |
| `success` | Completed successfully                                                      |
| `warning` | Completed with a non-fatal warning explicitly returned by the node executor |
| `error`   | Failed, including missing required credentials or executor configuration    |

---

## Test ID & Output Directory Structure

Every workflow run is assigned a unique UUID `testId`. Outputs are stored and served under:

```
/outputs/{testId}/{nodeId}/playwright-report/index.html
/outputs/{testId}/{nodeId}/test-results/...
```

This means multiple runs for the same node do not overwrite each other's results.
