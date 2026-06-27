# Migration Plan: Local Docker Runners to GCP Cloud Run Jobs

This plan outlines the architecture and implementation steps required to transition the workflow runners (both the orchestrator and the individual task runners like Playwright) from running in local Docker containers to running dynamically as Cloud Run Jobs in the user's authenticated Google Cloud Project.

## 1. Preparation: Container Images in Artifact Registry

Cloud Run requires container images to be hosted in a Google Cloud Artifact Registry (or Container Registry) accessible by the target project.

- **Action:** Update your deployment scripts or CI/CD to push the `playrunner-orchestrator` image to the `orchestrator` Artifact Registry repo and the runtime-specific `playrunner-playwright-runner-*` images to the `playwright-runner` repo.
- **Alternative:** Host public images in a central registry if users don't need to build them custom, so their GCP project can pull them directly.

## 2. API Backend Updates (`apps/api`)

The backend must orchestrate the creation and triggering of the Cloud Run Job instead of sending an HTTP request to a local Docker container.

### A. Disable Local Docker for GCP

In `apps/api/src/routes/runners.ts`, short-circuit the local Docker spawn if the active connection is GCP.

### B. Trigger Cloud Run Jobs in `workflows.ts`

When `POST /api/workflows/start` is called and `cloudProvider === 'GCP'`:

1. **Load Workflow from the API/Database:** The workflow is stored in Postgres and can be retrieved through `/api/store/workflows/:id`. Do not write workflow payloads to GCS.
2. **Instantiate Run Client:** Initialize the `@google-cloud/run` client using the user's OAuth `accessToken` (from `state.gcpCredentials[testId]`).
3. **Execute Service:**
   - Check if the Orchestrator Cloud Run Service exists in the selected GCP project. If not, create it dynamically.
   - Invoke the Orchestrator Service over HTTP with the workflow execution payload.

## 3. Orchestrator Updates (`apps/runners/orchestrator`)

The Orchestrator needs to adapt from being a long-running HTTP server to a run-to-completion batch job when deployed on Cloud Run.

### A. Job Execution Mode (`index.ts`)

1. **Service Mode:** Run the Orchestrator as a Cloud Run Service with an `/execute` endpoint.
2. **Run DAG:** Execute the workflow payload received from the API.
3. **Respond Immediately:** Return once execution is accepted; stream progress through the workflow messaging transport.

### B. Spawn Playwright Cloud Run Jobs

Currently, the orchestrator spawns Playwright runners using `spawn('docker', ['run', ...])`. When running in GCP:

1. **Initialize Run Client:** Use the `@google-cloud/run` client within the Orchestrator.
2. **Trigger Playwright Job:** Instead of spawning local Docker, use the GCP API to trigger an execution of the Playwright Cloud Run Job.
3. **Environment Overrides:** Pass all necessary variables (e.g., `PAYLOAD`) via environment variable overrides for that specific execution.
4. **Polling:** Since Cloud Run Jobs are asynchronous, the Orchestrator must poll the Execution status (`jobsClient.getExecution`) to wait for success, failure, or timeout before proceeding to downstream nodes in the workflow.

## 4. Playwright Node Updates (`apps/runners/playwright`)

Ensure the Playwright runner script expects to run to completion and shuts down cleanly with an appropriate exit code (`0` for success, non-zero for failure). The orchestrator will rely on the Cloud Run Execution state to determine if the Playwright node succeeded.

## Summary of Execution Flow (GCP Mode)

1. **Frontend:** Clicks Play -> Calls `/api/workflows/start`.
2. **API:** Loads/receives the workflow payload -> invokes the `playrunner-orchestrator` Cloud Run Service.
3. **Orchestrator Service:** Evaluates the DAG from the API payload.
4. **Orchestrator Service:** For each Playwright node -> Triggers `playrunner-playwright` Cloud Run Job execution -> Polls until complete.
5. **Orchestrator Service:** Publishes a terminal workflow event when execution completes.
