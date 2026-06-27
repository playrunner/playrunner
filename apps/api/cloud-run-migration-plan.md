# GCP Runner Architecture Notes

This note records the current GCP runner architecture. The Orchestrator runs as
a Cloud Run Service. Individual Playwright nodes run as Cloud Run Jobs in the
user's authenticated Google Cloud project.

## 1. Preparation: Container Images in Artifact Registry

Cloud Run requires container images to be hosted in a Google Cloud Artifact Registry (or Container Registry) accessible by the target project.

- **Action:** Update your deployment scripts or CI/CD to push the `playrunner-orchestrator` image to the `orchestrator` Artifact Registry repo and the runtime-specific `playrunner-playwright-runner-*` images to the `playwright-runner` repo.
- **Alternative:** Host public images in a central registry if users don't need to build them custom, so their GCP project can pull them directly.

## 2. API Backend Updates (`apps/api`)

The backend orchestrates creation and invocation of the Orchestrator Cloud Run
Service instead of starting the local Docker Orchestrator.

### A. Keep Local Docker Provisioning Out of GCP Runs

`apps/api/src/runtime/runner-provisioning.ts` only starts the local Docker
Orchestrator for `LOCAL_RUNNER`. GCP workflow execution goes through
`apps/api/src/runtime/gcp-workflow-execution.ts` instead.

### B. Trigger the Orchestrator Service in `workflows.ts`

When `POST /api/workflows/start` is called and `cloudProvider === 'GCP'`:

1. **Load Workflow from the API/Database:** The workflow is stored in Postgres and can be retrieved through `/api/store/workflows/:id`. Do not write workflow payloads to GCS.
2. **Configure Pub/Sub Event Ingest:** Create the execution-scoped filtered subscription that the API uses to persist workflow events to PostgreSQL.
3. **Instantiate Run Client:** Initialize the `@google-cloud/run` client using the user's OAuth `accessToken`.
4. **Execute Service:**
   - Check if the Orchestrator Cloud Run Service exists in the selected GCP project. If not, create it dynamically.
   - Invoke the Orchestrator Service over HTTP with the workflow execution payload.

## 3. Orchestrator Updates (`apps/runners/orchestrator`)

The Orchestrator remains a long-running HTTP service in both local Docker and
GCP. The GCP service accepts `/execute` requests and dispatches workflow work in
the background.

### A. Service Execution Mode (`index.ts`)

1. **Service Mode:** Run the Orchestrator as a Cloud Run Service with an `/execute` endpoint.
2. **Prepare Playwright Runners:** Scan the full workflow for Playwright nodes and start their Cloud Run Jobs in preparation mode before the DAG reaches them.
3. **Run DAG:** Execute the workflow payload received from the API.
4. **Respond Immediately:** Return once execution is accepted; stream progress through the workflow messaging transport.

### B. Spawn Playwright Cloud Run Jobs

Currently, the orchestrator spawns Playwright runners using `spawn('docker', ['run', ...])`. When running in GCP:

1. **Initialize Run Client:** Use the `@google-cloud/run` client within the Orchestrator.
2. **Prepare Playwright Job:** Instead of spawning local Docker, use the GCP API to trigger an execution of the Playwright Cloud Run Job.
3. **Environment Overrides:** Pass all necessary variables, including `PAYLOAD`, Pub/Sub event transport, and runner control metadata, via environment variable overrides for that specific execution.
4. **Control/Status Messaging:** Use Pub/Sub `runner_control` messages to start or cancel a prepared runner and `runner_status` messages to observe `ready`, `started`, `failed`, or cancelled states.
5. **Polling:** Since Cloud Run Jobs are asynchronous, the Orchestrator must poll the Execution status (`jobsClient.getExecution`) to wait for success, failure, or timeout before proceeding to downstream nodes in the workflow.

## 4. Playwright Node Updates (`apps/runners/playwright`)

The Playwright runner prepares dependencies first, publishes `runner_status=ready`,
waits for a Pub/Sub start signal containing its `nodeId` and `testId`, runs to
completion, publishes execution events through Pub/Sub, uploads outputs to GCS,
and shuts down cleanly with an appropriate exit code (`0` for success, non-zero
for failure).

## Summary of Execution Flow (GCP Mode)

1. **Frontend:** Clicks Play -> Calls `/api/workflows/start`.
2. **API:** Loads/receives the workflow payload -> invokes the `playrunner-orchestrator` Cloud Run Service.
3. **Orchestrator Service:** Scans the whole workflow and starts Playwright Cloud Run Jobs in preparation mode.
4. **Playwright Jobs:** Clone/install/prepare, publish `runner_status=ready`, and wait for a Pub/Sub start signal.
5. **Orchestrator Service:** Evaluates the DAG from the API payload.
6. **Orchestrator Service:** When a Playwright node is reached, publishes `runner_control=start`, then polls the corresponding Cloud Run Job execution until complete.
7. **Orchestrator Service:** Publishes a terminal workflow event when execution completes.
