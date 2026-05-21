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
1. **Upload Payload to GCS:** Since Cloud Run Jobs cannot receive HTTP POST bodies natively, save the `req.body` (the workflow JSON) to the GCS bucket created for the workflow (e.g., `gs://bucket-name/testId-workflow.json`).
2. **Instantiate Run Client:** Initialize the `@google-cloud/run` client using the user's OAuth `accessToken` (from `state.gcpCredentials[testId]`).
3. **Execute Job:** 
   - Check if an Orchestrator Cloud Run Job exists in the selected GCP project. If not, create it dynamically.
   - Trigger an execution of the Orchestrator Job.
   - Use `env` overrides during the execution trigger to pass variables like `WORKFLOW_PAYLOAD_URI=gs://bucket-name/testId-workflow.json`, `TEST_ID`, and `GCP_PROJECT`.

## 3. Orchestrator Updates (`apps/runners/orchestrator`)
The Orchestrator needs to adapt from being a long-running HTTP server to a run-to-completion batch job when deployed on Cloud Run.

### A. Job Execution Mode (`index.ts`)
1. **Detect Mode:** On startup, check for `process.env.JOB_MODE`. 
2. **Fetch Payload:** If in job mode, the Orchestrator should download the workflow JSON from GCS using the provided `WORKFLOW_PAYLOAD_URI`.
3. **Run DAG:** Execute the workflow immediately instead of starting an Express server.
4. **Exit:** Once the workflow is complete, exit the process (`process.exit(0)`) so the Cloud Run Job execution finishes successfully.

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
2. **API:** Uploads workflow JSON to GCS -> Triggers `playrunner-orchestrator` Cloud Run Job.
3. **Orchestrator Job:** Starts -> Pulls JSON from GCS -> Evaluates DAG.
4. **Orchestrator Job:** For each Playwright node -> Triggers `playrunner-playwright` Cloud Run Job execution -> Polls until complete.
5. **Orchestrator Job:** Finishes workflow -> Exits -> Execution marked Successful.
