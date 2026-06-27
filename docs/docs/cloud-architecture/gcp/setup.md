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
Integrations modal saves to Postgres.

## How Terraform and Saved Settings Fit Together

There are two setup surfaces, and they deliberately do different jobs:

| Surface | Source | What it controls |
| --- | --- | --- |
| GCP infrastructure | `infra/gcp` Terraform | Artifact Registry repositories and the shared Pub/Sub topic |
| Runtime GCP settings | The GCP Integration modal, stored in the `CloudCredential` row | Selected project, Cloud Run region, Orchestrator service name, and image URI templates |

OAuth does not create infrastructure. After OAuth succeeds, Playrunner can list
projects and save the runtime settings that point to your infrastructure.
Terraform does not write those settings into the database, and the UI does not
apply Terraform.

Keep them aligned with this contract:

| Terraform value | Saved GCP setting | Expected match |
| --- | --- | --- |
| `project_id` | `selectedProject` | Same GCP project ID |
| `region` | `cloudRunLocation` | Same GCP region |
| `repository_urls.orchestrator` | `orchestratorImageUriTemplate` | After replacing `{projectId}`, it should be `<repository_urls.orchestrator>/playrunner-orchestrator:latest` |
| `repository_urls.playwright_runner` | `playwrightImageUriTemplate` | After replacing `{projectId}`, it should be `<repository_urls.playwright_runner>/playrunner-playwright-runner-{runtime}:{version}` |
| `workflow_events_topic_name` | `GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC` | Same topic name; both default to `playrunner-workflow-events` |

`orchestratorServiceName` is not a Terraform output. Terraform creates the
container registry repository; Playrunner and `push-runners.sh` create or update
the Cloud Run service. Use the default `playrunner-orchestrator` unless you have
a reason to name the Cloud Run service differently.

## What This Sets Up

- Artifact Registry Docker repositories named `orchestrator` and
  `playwright-runner`
- A shared Pub/Sub topic named `playrunner-workflow-events` by default
- The GCP APIs used by setup and runtime:
  `artifactregistry.googleapis.com`, `cloudresourcemanager.googleapis.com`,
  `pubsub.googleapis.com`, `run.googleapis.com`, and `storage.googleapis.com`
- Published Orchestrator and Playwright runner images in Artifact Registry
- A deployed `playrunner-orchestrator` Cloud Run service
- Cleaned-up cached Playwright Cloud Run Jobs so the next workflow run recreates
  them with the latest image

The default GCP event path is Pub/Sub. Cloud runners publish events to the
shared topic, the API creates an execution-scoped filtered subscription, writes
each accepted event to PostgreSQL, acknowledges the Pub/Sub message, and streams
the same execution back to the editor with SSE.

## Prerequisites

- A Google Cloud project with billing enabled.
- Local Playrunner setup completed and running with `./start-local.sh`.
- Local CLIs on `PATH`: `docker`, `gcloud`, `terraform`, and `node`.
- API dependencies installed so `apps/api/node_modules/@prisma/client` exists.
  The normal local setup does this; if not, run `npm install` in `apps/api`.
- `apps/api/.env` must contain the working `DATABASE_URL` for your local
  Postgres database. `./start-local.sh` keeps this aligned for the standard
  local setup.
- A Google OAuth client for the Playrunner app. Add the exact redirect URI shown
  in the GCP integration modal. With the default local app URL, this is:

```text
http://127.0.0.1:3000/oauth/callback/gcp
```

For local evaluation, the simplest IAM path is to use a project owner account.
For tighter IAM, the account applying Terraform needs permission to enable
project services and create Artifact Registry repositories and Pub/Sub topics.
The GCP account connected inside Playrunner needs permission to manage Cloud Run
services/jobs, Storage buckets, Pub/Sub topics/subscriptions, and to pull images
from Artifact Registry in the selected project.

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

1. Copy the callback URL from the modal.
2. Create or update a Google OAuth web client with that callback URL as an
   authorized redirect URI.
3. Enter the OAuth client ID and client secret in Playrunner.
4. Authenticate with Google.
5. Select the Google Cloud project you chose for Terraform.
6. Set the same Cloud Run region you will put in `terraform.tfvars`, for example
   `us-central1`.
7. Keep the default Orchestrator service name unless you need a custom one:
   `playrunner-orchestrator`.
8. Save the image URI templates.

For a standard Artifact Registry setup in `us-central1`, use:

```text
us-central1-docker.pkg.dev/{projectId}/orchestrator/playrunner-orchestrator:latest
```

```text
us-central1-docker.pkg.dev/{projectId}/playwright-runner/playrunner-playwright-runner-{runtime}:{version}
```

Replace `us-central1` with your Cloud Run region. Keep `{projectId}` in
both templates, and keep `{runtime}` and `{version}` in the Playwright template.

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
```

Then plan and apply:

```bash
terraform plan
terraform apply
```

This creates the Artifact Registry repositories and the shared Pub/Sub topic.
It also enables the GCP APIs used by the setup and runtime paths. The API
creates execution-scoped Pub/Sub subscriptions at workflow runtime.

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
terraform -chdir=infra/gcp output workflow_events_topic_name
node infra/gcp/scripts/gcp-settings.mjs json
```

They should describe the same project, region, repositories, and Pub/Sub topic.
For example, if Terraform prints:

```text
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

If they do not line up, reopen the GCP Integration modal, update the saved
project, region, or image URI templates, and save again before running
`push-runners.sh`.

## 5. Push the Runner Images

From the repo root, publish both the Orchestrator and Playwright runner images:

```bash
./infra/gcp/scripts/push-runners.sh --target both --yes
```

You can also run it interactively:

```bash
./infra/gcp/scripts/push-runners.sh
```

The script:

- Reads GCP settings from the saved `CloudCredential` row in Postgres.
- Configures local Docker auth for the Artifact Registry host with
  `gcloud auth configure-docker`.
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
# Push only the orchestrator image and redeploy the service.
./infra/gcp/scripts/push-runners.sh --target orchestrator --yes

# Push only Playwright runner images and clear cached jobs.
./infra/gcp/scripts/push-runners.sh --target playwright --yes

# Override the project for this run.
./infra/gcp/scripts/push-runners.sh --project-id my-other-project --target both --yes
```

Run `./infra/gcp/scripts/push-runners.sh --help` for all flags.

## 6. Run a Workflow on GCP

Keep the local Playrunner API and web app running. In the editor, select the
GCP runner and run the workflow.

On the default Pub/Sub transport, no tunnel is required for local debugging. The
cloud runners publish execution events to Pub/Sub, your local API pulls those
messages over outbound HTTPS, persists them to PostgreSQL, and streams them to
the editor.

The first run may create or update the Orchestrator Cloud Run service and
Playwright Cloud Run Jobs. Later runs reuse those resources unless the image
template, runner version, CPU, memory, or runtime selection requires a new job.

## When to Rerun `push-runners.sh`

Rerun the push script after changing:

- `apps/runners/orchestrator/**`
- `apps/runners/playwright/**`
- `config/playwright-runner-versions.json`
- The image URI templates saved in the GCP integration modal

For code changes in the API or frontend only, rerunning `push-runners.sh` is not
normally required.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `No GCP cloud credential found` | Connect GCP in the Integrations modal and save the runner settings first. |
| `GCP setting "..." is empty` | Reopen the GCP modal and save project, region, service name, and image templates. |
| Docker push is denied | The push script runs `gcloud auth configure-docker` automatically. Check that `gcloud auth login` is using the expected account and that the account can push to Artifact Registry. |
| Cloud Run cannot pull the image | Confirm the image URI template matches the Terraform-created repository and that the image was pushed. |
| Pub/Sub setup fails | Confirm Terraform applied cleanly, the topic name matches `GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC`, and the connected GCP user can create subscriptions. |
| Workflow outputs fail to upload | Confirm the connected GCP user can create and write to Storage buckets in the selected project. |

For local debugging of cloud-runner messaging, see
[Remote Runner Messaging](../../local-dev/remote-debugging).
