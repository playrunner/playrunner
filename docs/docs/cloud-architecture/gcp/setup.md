---
sidebar_position: 2
title: GCP Setup
sidebar_label: Setup
---

# GCP Setup

Use this page as the top-level setup checklist. The detailed instructions are
split into the two setup phases that happen in the app:

1. [Google OAuth setup](./oauth) connects Playrunner to your Google account.
2. [Terraform setup](./terraform) creates the Google Cloud infrastructure.

OAuth and Terraform are separate on purpose. OAuth saves credentials, the
selected project, and the Cloud Run region in Playrunner's local database.
Terraform reads those saved values through the setup script and writes
`infra/gcp/terraform.tfvars`.

## First-Time Setup Order

1. Start Playrunner locally:

```bash
./start-local.sh
```

2. Open **Integrations** and choose **Connect to GCP**.
3. Complete [Google OAuth setup](./oauth).
4. After OAuth succeeds, select the Google Cloud project and Cloud Run region in
   the dialog, then click **Save GCP Settings**.
5. From the repo root, generate `infra/gcp/terraform.tfvars`:

```bash
./infra/gcp/scripts/setup-terraform.sh
```

6. Review the generated file, then run Terraform directly:

```bash
terraform -chdir=infra/gcp init
terraform -chdir=infra/gcp plan
terraform -chdir=infra/gcp apply
```

7. After Terraform succeeds, publish the runtime images:

```bash
./infra/gcp/scripts/push-runners.sh --target all --yes
```

8. In the editor, select the GCP runner and run a workflow.

## What Each Step Owns

| Step          | Owner                 | What it creates or saves                                                                                                            |
| ------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| OAuth         | Connect to GCP dialog | Google OAuth tokens, selected project, Cloud Run region, and standard Playrunner runner defaults in the local `CloudCredential` row |
| Terraform     | `infra/gcp`           | Required APIs, Artifact Registry repositories, API Cloud Run service, shared Pub/Sub topic, and Cloud Scheduler service account     |
| Image publish | `push-runners.sh`     | API, Orchestrator, and Playwright runner images, plus Cloud Run service redeploys using the standard generated image paths          |

The Connect to GCP dialog does not ask for image URI templates. Playrunner
generates the standard Artifact Registry paths from the saved region:

```text
<region>-docker.pkg.dev/{projectId}/orchestrator/playrunner-orchestrator:latest
<region>-docker.pkg.dev/{projectId}/playwright-runner/playrunner-playwright-runner-{runtime}:{version}
```

## Scheduler Service Account

The full Cloud Scheduler service account email is not something the user should
type into the dialog. The generated `terraform.tfvars` contains this ID:

```hcl
scheduler_service_account_id = "playrunner-scheduler"
```

Terraform combines that ID with `project_id` to create the service account and
prints the full email as the `scheduler_service_account_email` output. For a
project named `my-gcp-project`, the output is:

```text
playrunner-scheduler@my-gcp-project.iam.gserviceaccount.com
```

## Local Scheduler Callbacks

Most GCP workflow debugging does not need a public tunnel because the API pulls
runner events from Pub/Sub over outbound HTTPS.

You only need a tunnel when Google Cloud Scheduler must call a local Playrunner
API for enabled schedules. In that case, start a tunnel to the local API port:

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

## More Detail

- [Google OAuth setup](./oauth)
- [Terraform setup](./terraform)
- [Publishing to GCP](../../local-dev/docker-images#publishing-to-gcp)
- [Remote Runner Messaging](../../local-dev/remote-debugging)
