---
sidebar_position: 2
title: GCP Setup
sidebar_label: Setup
---

# GCP Setup

Use this runbook when you want Playrunner to execute workflows on Google Cloud.
It covers the Terraform under `infra/gcp`, the GCP integration settings saved
by the app, and the `push-runners.sh` image publishing flow.

The order matters: `push-runners.sh` reads the selected project, Cloud Run
region, service name, and image templates from the GCP credential row that the
Connect to GCP dialog saves to Postgres.

## First-Time Setup Order

For a new Google Cloud project, do the setup in this order:

1. Start Playrunner locally and open the **Connect to GCP** dialog from
   **Integrations** or the **GCP Runner** menu in the editor.
2. Authenticate with Google, select the project, set the Cloud Run region, and
   save the runner settings.
3. Create `infra/gcp/terraform.tfvars` with the same project and region:

```hcl
project_id = "my-gcp-project"
region     = "us-central1"
```

4. From the repo root, initialize and apply Terraform:

```bash
terraform -chdir=infra/gcp init
terraform -chdir=infra/gcp plan
terraform -chdir=infra/gcp apply
```

5. Check the Terraform outputs against the values saved in the Connect to GCP
   dialog:

```bash
terraform -chdir=infra/gcp output repository_urls
terraform -chdir=infra/gcp output api_service_uri
terraform -chdir=infra/gcp output scheduler_service_account_email
node infra/gcp/scripts/gcp-settings.mjs json
```

6. After Terraform succeeds, publish the runtime images:

```bash
./infra/gcp/scripts/push-runners.sh --target all --yes
```

7. If Cloud Scheduler will call your local API, create a public HTTPS tunnel
   before saving an enabled schedule:

```bash
cloudflared tunnel --url http://127.0.0.1:3011
```

Use the API port printed by `./start-local.sh` or the `PORT` value in
`apps/api/.env` if your local API is not on `3011`. Put Cloudflare's printed
`https://...trycloudflare.com` URL in `apps/api/.env`:

```dotenv
PLAYRUNNER_PUBLIC_API_URL=https://your-tunnel.trycloudflare.com
```

Restart the local API after changing `apps/api/.env`, then save the workflow
with the schedule enabled.

Terraform creates the GCP infrastructure first: Artifact Registry repositories,
the API Cloud Run service, Pub/Sub, and the scheduler service account. The push
script runs after that so it can build and publish the API, Orchestrator, and
Playwright runner images into infrastructure that already exists.

## How Terraform and Saved Settings Fit Together

There are three setup surfaces, and they deliberately do different jobs:

| Surface              | Source                                                         | What it controls                                                                                                                        |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GCP infrastructure   | `infra/gcp` Terraform                                          | Artifact Registry repositories, the API Cloud Run service, the shared Pub/Sub topic, and the scheduler service account                  |
| API runtime settings | `apps/api/.env` or Terraform `api_environment_variables`       | Local or Cloud Run API database/output settings and the Pub/Sub topic name                                                              |
| Runtime GCP settings | The Connect to GCP dialog, stored in the `CloudCredential` row | Selected project, Cloud Run region, Orchestrator service name, Orchestrator min/max instances, CPU idle policy, and image URI templates |

OAuth does not create infrastructure. After OAuth succeeds, Playrunner can list
projects and save the runtime settings that point to your infrastructure.
Terraform does not write those settings into the database, and the UI does not
apply Terraform.

Keep them aligned with this contract:

| Terraform value                     | Runtime setting                    | Expected match                                                                                                                     |
| ----------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `project_id`                        | `selectedProject`                  | Same GCP project ID                                                                                                                |
| `region`                            | `cloudRunLocation`                 | Same GCP region                                                                                                                    |
| `api_service_uri`                   | Frontend `VITE_API_URL`            | Use this URL when the frontend should talk to the API running in GCP                                                               |
| `api_image_uri`                     | `push-runners.sh --target api`     | The script defaults to this image URI                                                                                              |
| `repository_urls.orchestrator`      | `orchestratorImageUriTemplate`     | After replacing `{projectId}`, it should be `<repository_urls.orchestrator>/playrunner-orchestrator:latest`                        |
| `repository_urls.playwright_runner` | `playwrightImageUriTemplate`       | After replacing `{projectId}`, it should be `<repository_urls.playwright_runner>/playrunner-playwright-runner-{runtime}:{version}` |
| `workflow_events_topic_name`        | `GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC` | Same topic name; both default to `playrunner-workflow-events`                                                                      |
| `scheduler_service_account_email`   | `schedulerServiceAccountEmail`     | Same service account email; the modal defaults this from the selected project                                                      |
| Orchestrator service settings       | Connect to GCP dialog              | Service name, min/max instances, and CPU idle policy used by `push-runners.sh` and the runtime service reconciliation path.        |

Terraform creates the API Cloud Run service with a bootstrap image so the
service URL and IAM policy exist before the real API image is pushed. The
service ignores image drift, so `push-runners.sh --target api` can deploy the
real API image without Terraform reverting it on the next apply.

`orchestratorServiceName` is not a Terraform output. Terraform creates the
container registry repository; Playrunner and `push-runners.sh` create or update
the Orchestrator Cloud Run service using the service settings saved in the GCP
integration modal. The API throws before a GCP run if the saved service name,
min/max instances, or CPU idle policy are missing or invalid.

## What This Sets Up

- Artifact Registry Docker repositories named `api`, `orchestrator`, and
  `playwright-runner`
- A `playrunner-api` Cloud Run service for the Playrunner API. Terraform creates
  it with a bootstrap image; `push-runners.sh` replaces that image with the real
  API container.
- A shared Pub/Sub topic named `playrunner-workflow-events` by default
- A `playrunner-scheduler` service account used by Cloud Scheduler OIDC HTTP
  targets
- The GCP APIs used by setup and runtime:
  `artifactregistry.googleapis.com`, `cloudscheduler.googleapis.com`,
  `cloudresourcemanager.googleapis.com`, `iam.googleapis.com`,
  `pubsub.googleapis.com`, `run.googleapis.com`, and `storage.googleapis.com`
- Published Orchestrator and Playwright runner images in Artifact Registry
- A deployed `playrunner-orchestrator` Cloud Run service
- Cleaned-up cached Playwright Cloud Run Jobs so the next workflow run recreates
  them with the latest image

The GCP runner messaging path is Pub/Sub. Cloud runners publish events to the
shared topic, the API creates an execution-scoped filtered subscription, writes
each accepted execution event to PostgreSQL, acknowledges the Pub/Sub message,
and streams the same execution back to the editor with SSE. Runner control and
runner status messages use the same topic with filtered subscriptions owned by
the Orchestrator/runner path. These pull loops use non-blocking Pub/Sub pulls so
the API, Orchestrator, and runner keep their own short polling cadence for logs,
readiness, and start signals.

## Prerequisites

- A Google Cloud project with billing enabled.
- Local Playrunner setup completed and running with `./start-local.sh`.
- Local CLIs on `PATH`: `docker`, `gcloud`, `terraform`, and `node`.
- API dependencies installed so `apps/api/node_modules/@prisma/client` exists.
  The normal local setup does this; if not, run `npm install` in `apps/api`.
- `apps/api/.env` must contain the working `DATABASE_URL` for your local
  Postgres database. `./start-local.sh` keeps this aligned for the standard
  local setup.
- For a GCP-hosted API, `api_environment_variables` in `infra/gcp` Terraform
  must include a `DATABASE_URL` that is reachable from Cloud Run. Do not use a
  local `127.0.0.1` or Docker-only Postgres URL for the live API. Terraform
  marks this map sensitive, but the values still exist in Terraform state, so
  keep state storage private.
- If Cloud Scheduler needs to call a local API through a tunnel, set
  `PLAYRUNNER_PUBLIC_API_URL` in `apps/api/.env` to the externally reachable API
  base URL before saving an enabled schedule. Without this override, Playrunner
  uses the current request host for scheduler callback URLs.
- A Google OAuth client for the Playrunner app. You create this in the Connect
  GCP step below. With the default local app URL, the redirect URI is:

```text
http://127.0.0.1:3100/oauth/callback/gcp
```

For local evaluation, the simplest IAM path is to use a project owner account.
For tighter IAM, the account applying Terraform needs permission to enable
project services and create Artifact Registry repositories, Pub/Sub topics, and
the scheduler service account. The GCP account connected inside Playrunner needs
permission to manage Cloud Run services/jobs, Storage buckets, Pub/Sub
topics/subscriptions, Cloud Scheduler jobs, publish Pub/Sub messages, pull
images from Artifact Registry, and act as the scheduler service account in the
selected project.

If the connected GCP account is not a project owner, add it to
`scheduler_service_account_users` in `terraform.tfvars` so it can create
scheduler jobs that mint OIDC tokens as `playrunner-scheduler`:

```hcl
scheduler_service_account_users = [
  "user:you@example.com",
]
```

### Local Scheduler Callbacks Through Cloudflare

`PLAYRUNNER_PUBLIC_API_URL` is only needed when a Google Cloud Scheduler job must
call your local Playrunner API. Cloud Scheduler runs in Google Cloud, so it
cannot reach `http://127.0.0.1:3011` on your laptop directly. The variable tells
Playrunner which public HTTPS base URL to put into the scheduler job callback.

For a quick local tunnel, start Cloudflare Tunnel against the local API port:

```bash
cloudflared tunnel --url http://127.0.0.1:3011
```

Use the API port printed by `./start-local.sh` or the `PORT` value in
`apps/api/.env` if your local API is not on `3011`. Cloudflare prints a public
`https://...trycloudflare.com` URL. Put that base URL in `apps/api/.env`:

```dotenv
PLAYRUNNER_PUBLIC_API_URL=https://your-tunnel.trycloudflare.com
```

Use `PLAYRUNNER_PUBLIC_API_URL`; there is no separate generic `PUBLIC_API_URL`
setting for this path. Restart the local API after changing `apps/api/.env`,
then save the workflow with the schedule enabled. If you use a named Cloudflare
Tunnel and DNS hostname instead of a quick tunnel, set
`PLAYRUNNER_PUBLIC_API_URL` to that hostname.

## 1. Choose a Project and Region

Pick the GCP project and Cloud Run region before filling out the modal or
Terraform variables. Use the same values everywhere in this runbook.

Examples:

```text
project_id = "my-gcp-project"
region     = "us-central1"
```

## 2. Connect GCP and Save Runtime Settings

Start the local stack from the repo root:

```bash
./start-local.sh
```

Open the app, go to **Integrations**, and connect **GCP**.

### Create the Google OAuth Client

1. Copy the authorized redirect URI from the Connect to GCP dialog.
2. Go to
   [Google Cloud Console APIs & Services](https://console.cloud.google.com/apis/credentials).
3. Before creating credentials, open **OAuth consent screen** from the left
   menu.
4. Choose the user type, such as **External**, and click **Create**.
5. Under **App information / Branding**, set the app name and provide user
   support emails, then save.
6. In **Test users**, add the Google account that will authenticate with
   Playrunner. Skipping this for a testing app can cause Google to return
   `Access blocked` or `Access denied`.
7. Go back to **Credentials**, click **Create Credentials**, and select
   **OAuth client ID**.
8. Set **Application type** to **Web application**.
9. Add the redirect URI copied from the Connect to GCP dialog as an
   **Authorized redirect URI**.
10. Copy the generated **Client ID** and **Client Secret**.

### Save GCP Settings in Playrunner

1. Enter the OAuth client ID and client secret in Playrunner.
2. Authenticate with Google.
3. Select the Google Cloud project you chose for Terraform.
4. Set the same Cloud Run region you will put in `terraform.tfvars`, for example
   `us-central1`.
5. Keep the default Orchestrator service name unless you need a custom one:
   `playrunner-orchestrator`.
6. Keep the default Cloud Scheduler service account unless Terraform prints a
   custom value.
7. Save the image URI templates.

For a standard Artifact Registry setup in `us-central1`, use:

```text
us-central1-docker.pkg.dev/{projectId}/orchestrator/playrunner-orchestrator:latest
```

```text
us-central1-docker.pkg.dev/{projectId}/playwright-runner/playrunner-playwright-runner-{runtime}:{version}
```

Replace `us-central1` with your Cloud Run region. Keep `{projectId}` in
both templates, and keep `{runtime}` and `{version}` in the Playwright template.

If you change the saved project, region, or image URI templates after runners
have already been published, rerun `push-runners.sh` so Cloud Run can use the
new image locations. If the new values point at a different project, region, or
Artifact Registry repository path, apply the `infra/gcp` Terraform first so the
required APIs, repositories, and Pub/Sub topic exist before publishing.

Confirm what the push script will read:

```bash
node infra/gcp/scripts/gcp-settings.mjs json
```

If this command says no GCP credential exists, complete and save the GCP
integration modal first. If multiple users have GCP credentials in the local DB,
pass `--user-id <id>`.

## 3. Bootstrap GCP Infrastructure

Authenticate local tooling:

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project <project-id>
```

Apply the Terraform under `infra/gcp`:

```bash
cd infra/gcp
terraform init
```

Create an ignored local `terraform.tfvars` file:

```hcl
project_id = "my-gcp-project"
region     = "us-central1"

# Optional; this is the default used by the API.
workflow_events_topic_name = "playrunner-workflow-events"

# Optional for local-only API debugging. Required when the Playrunner API should
# run in GCP. Use a Postgres URL reachable from Cloud Run, not localhost.
api_environment_variables = {
  DATABASE_URL = "postgresql://USER:PASSWORD@HOST:PORT/playrunner?schema=public"
}

# Optional; grant non-owner users permission to create scheduler jobs with the
# scheduler service account.
scheduler_service_account_users = [
  "user:you@example.com",
]
```

Then plan and apply:

```bash
terraform plan
terraform apply
```

This creates the Artifact Registry repositories, the API Cloud Run service, the
shared Pub/Sub topic, and the scheduler service account. It also enables the GCP
APIs used by the setup and runtime paths. The API service starts with a public
bootstrap image until the real Playrunner API image is pushed. The API creates
execution-scoped Pub/Sub subscriptions at workflow runtime.

If Terraform cannot call the Service Usage API in a brand-new project, enable
that bootstrap API once and rerun `terraform apply`:

```bash
gcloud services enable serviceusage.googleapis.com --project <project-id>
```

Return to the repo root before publishing images:

```bash
cd ../..
```

## 4. Check Terraform Against Saved Settings

From the repo root, compare the Terraform outputs with the settings saved by the
GCP modal:

```bash
terraform -chdir=infra/gcp output repository_urls
terraform -chdir=infra/gcp output api_service_uri
terraform -chdir=infra/gcp output api_image_uri
terraform -chdir=infra/gcp output workflow_events_topic_name
terraform -chdir=infra/gcp output scheduler_service_account_email
node infra/gcp/scripts/gcp-settings.mjs json
```

They should describe the same project, region, repositories, Pub/Sub topic, and
scheduler service account.
For example, if Terraform prints:

```text
api = "us-central1-docker.pkg.dev/my-gcp-project/api"
orchestrator = "us-central1-docker.pkg.dev/my-gcp-project/orchestrator"
playwright_runner = "us-central1-docker.pkg.dev/my-gcp-project/playwright-runner"
```

Then the saved templates should be:

```text
us-central1-docker.pkg.dev/{projectId}/orchestrator/playrunner-orchestrator:latest
```

```text
us-central1-docker.pkg.dev/{projectId}/playwright-runner/playrunner-playwright-runner-{runtime}:{version}
```

If they do not line up, reopen the Connect to GCP dialog, update the saved
project, region, or image URI templates, and save again before running
`push-runners.sh`.

If the saved project or region changed, or if the templates now point at
repositories other than the Terraform-created `api`, `orchestrator`, and
`playwright-runner` repositories, run `terraform plan` and `terraform apply`
again before publishing images. Terraform creates the Artifact Registry
repositories, API Cloud Run service, shared Pub/Sub topic, and scheduler service
account; `push-runners.sh` builds and pushes images, redeploys the API and
Orchestrator services, and clears cached Playwright jobs.

## 5. Push the Cloud Runtime Images

From the repo root, publish the API, Orchestrator, and Playwright runner images:

```bash
./infra/gcp/scripts/push-runners.sh --target all --yes
```

You can also run it interactively:

```bash
./infra/gcp/scripts/push-runners.sh
```

The script:

- Reads GCP settings from the saved `CloudCredential` row in Postgres.
- Configures local Docker auth for the Artifact Registry host with
  `gcloud auth configure-docker`.
- Builds the API image as `linux/amd64`.
- Pushes the API image to the Terraform-created `api` repository.
- Deploys the API Cloud Run service with `gcloud run deploy`.
- Builds the Orchestrator image as `linux/amd64`.
- Pushes the Orchestrator image to the URI rendered from
  `orchestratorImageUriTemplate`.
- Deploys the Orchestrator Cloud Run service with `gcloud run deploy`.
- Builds and pushes every TypeScript and Python Playwright runner image defined
  in `config/playwright-runner-versions.json`.
- Deletes cached Cloud Run Jobs named `playrunner-*` so the next workflow run
  recreates them with the latest image.

Useful variants:

```bash
# Push only the API image and redeploy the API service.
./infra/gcp/scripts/push-runners.sh --target api --yes

# Push only the orchestrator image and redeploy the service.
./infra/gcp/scripts/push-runners.sh --target orchestrator --yes

# Push only Playwright runner images and clear cached jobs.
./infra/gcp/scripts/push-runners.sh --target playwright --yes

# Push only the two runner images, preserving the old behavior of "both".
./infra/gcp/scripts/push-runners.sh --target both --yes

# Override the project for this run.
./infra/gcp/scripts/push-runners.sh --project-id my-other-project --target all --yes
```

Run `./infra/gcp/scripts/push-runners.sh --help` for all flags.

## 6. Run a Workflow on GCP

Use either the local Playrunner API or the API Cloud Run service. For a live GCP
API, point the frontend at `api_service_uri` with `VITE_API_URL`, then start or
deploy the frontend. In the editor, select the GCP runner and run the workflow.

On the Pub/Sub transport, no tunnel is required for local debugging. The cloud
runners publish execution events to Pub/Sub, the API pulls those messages over
outbound HTTPS, persists them to PostgreSQL, and streams them to the editor. The
Orchestrator also uses Pub/Sub `runner_control` messages to start prepared
Playwright jobs and `runner_status` messages to observe readiness/start/failure.

The first run may create or update the Orchestrator Cloud Run service and
Playwright Cloud Run Jobs. Later runs reuse those resources unless the image
template, runner version, CPU, memory, or runtime selection requires a new job.
Playrunner configures the Orchestrator service with the saved minimum instance
count, which can be `0`, and the saved CPU idle policy. Keep CPU always
allocated when the background DAG run must continue after the service's
`/execute` request has returned. Those service defaults come from the GCP
integration settings saved in PostgreSQL.
At execution time, the Orchestrator schedules Playwright job preparation in the
background so dependency preparation can overlap with earlier workflow nodes. It
then sends the Pub/Sub start signal only when the DAG reaches the corresponding
Playwright node.

During this preparation phase, Playwright nodes should remain `pending`. They
move to `running` only after the runner receives the start signal and begins
executing the test.

## When to Rerun `push-runners.sh`

Rerun the push script after changing:

- `apps/api/**`
- `apps/runners/orchestrator/**`
- `apps/runners/playwright/**`
- `packages/*/src/api/**` or `packages/*/src/api-runtime/**` code consumed by
  the API image
- `config/playwright-runner-versions.json`
- The image URI templates saved in the Connect to GCP dialog

For local-only API debugging, restarting the local API is enough. For a live GCP
API, any API or API-runtime package change requires rebuilding and pushing the
API image with `./infra/gcp/scripts/push-runners.sh --target api --yes`, or
`--target all` when runner images should be refreshed too. The next GCP run will
patch the existing Orchestrator service configuration when saved GCP integration
settings, such as min/max instances or CPU idle policy, drift from what
Playrunner expects. Any change to the Orchestrator or Playwright runner code
requires rebuilding and pushing the corresponding Cloud Run image before a real
GCP workflow can use it.

## When to Rerun Terraform

Rerun Terraform before publishing cloud images when the saved GCP settings now
point at infrastructure that does not already exist:

- The selected GCP project changed.
- The Cloud Run / Artifact Registry region changed.
- The image URI templates now use different Artifact Registry repositories.
- The shared workflow events topic name changed.
- The API service name, scaling, ingress, public invocation policy, or live API
  environment variables changed.

Changing only `orchestratorServiceName` does not require Terraform. The
Orchestrator Cloud Run service is created or updated by `push-runners.sh` and
the runtime path, not by Terraform.

## Troubleshooting

| Symptom                                      | Check                                                                                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No GCP cloud credential found`              | Connect GCP in the Integrations modal and save the runner settings first.                                                                                                           |
| `GCP setting "..." is empty`                 | Reopen the GCP modal and save project, region, service name, and image templates.                                                                                                   |
| Docker push is denied                        | The push script runs `gcloud auth configure-docker` automatically. Check that `gcloud auth login` is using the expected account and that the account can push to Artifact Registry. |
| Cloud Run cannot pull the image              | Confirm the image URI template matches the Terraform-created repository and that the image was pushed.                                                                              |
| API Cloud Run service starts but routes fail | Confirm `api_environment_variables.DATABASE_URL` points to a Postgres database reachable from Cloud Run and that the schema has been migrated.                                      |
| Pub/Sub setup fails                          | Confirm Terraform applied cleanly, the topic name matches `GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC`, and the connected GCP user can create subscriptions and publish messages.             |
| Playwright job prepares but never starts     | Confirm the Orchestrator can publish `runner_control` messages and the Playwright job can pull its filtered control subscription on the shared topic.                               |
| Workflow outputs fail to upload              | Confirm the connected GCP user can create and write to Storage buckets in the selected project.                                                                                     |

For local debugging of cloud-runner messaging, see
[Remote Runner Messaging](../../local-dev/remote-debugging).
