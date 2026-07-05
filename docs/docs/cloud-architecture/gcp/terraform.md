---
sidebar_position: 5
title: Terraform Setup
sidebar_label: Terraform
---

# Terraform Setup

Run this after [Google OAuth setup](./oauth) and
[Project and Region setup](./project-region) are complete. Terraform expects
the saved project ID to reference a Google Cloud project that already exists.

## 1. Generate `terraform.tfvars`

From the repo root, run:

```bash
./infra/gcp/scripts/setup-terraform.sh
```

The script:

- Reads the saved GCP `CloudCredential` row from Postgres.
- Writes `infra/gcp/terraform.tfvars`.
- Warns if local Terraform state already exists in `infra/gcp`.
- Prints the Terraform commands to run next.

If multiple local users have saved GCP credentials, pass the user ID:

```bash
./infra/gcp/scripts/setup-terraform.sh --user-id <user-id>
```

## 2. Run Terraform

Review `infra/gcp/terraform.tfvars`, then run Terraform directly:

```bash
terraform -chdir=infra/gcp init
terraform -chdir=infra/gcp plan
terraform -chdir=infra/gcp apply
```

If you are retesting the first-time setup from a checkout that has already run
Terraform, remove the local state first so Terraform behaves like a clean
install into the `project_id` in `terraform.tfvars`:

```bash
rm -f infra/gcp/terraform.tfstate infra/gcp/terraform.tfstate.backup
```

Do not remove state for an existing environment that you are continuing to
manage with Terraform.

## 3. Generated Values

The setup script writes the required values from the Connect to GCP dialog:

```hcl
project_id = "my-gcp-project"
region     = "us-central1"

scheduler_service_account_id = "playrunner-scheduler"

api_service_name           = "playrunner-api"
workflow_events_topic_name = "playrunner-workflow-events"
```

The full scheduler service account email is not an input. Terraform creates the
service account from `scheduler_service_account_id` and `project_id`, then
prints the full email as an output:

```bash
terraform -chdir=infra/gcp output scheduler_service_account_email
```

For `project_id = "my-gcp-project"`, the output is:

```text
playrunner-scheduler@my-gcp-project.iam.gserviceaccount.com
```

## 4. Optional Values

For local evaluation, the simplest IAM path is to use a project owner account.
For tighter IAM, add the connected Google account to
`scheduler_service_account_users` so it can create Cloud Scheduler jobs that act
as the scheduler service account:

```hcl
scheduler_service_account_users = [
  "user:you@example.com",
]
```

If the Playrunner API should run in GCP, set a Postgres URL reachable from Cloud
Run. Do not use `127.0.0.1` or a Docker-only hostname for this value:

```hcl
api_environment_variables = {
  DATABASE_URL = "postgresql://USER:PASSWORD@HOST:PORT/playrunner?schema=public"
}
```

Terraform marks `api_environment_variables` sensitive, but the values still
exist in Terraform state, so keep state storage private.

## 5. What Terraform Creates

Terraform creates:

- Required Google Cloud APIs
- Artifact Registry Docker repositories named `api`, `orchestrator`, and
  `playwright-runner`
- A `playrunner-api` Cloud Run service with a bootstrap image
- A shared Pub/Sub topic named `playrunner-workflow-events`
- A `playrunner-scheduler` service account for Cloud Scheduler OIDC callbacks
- IAM bindings for API invocation

The API Cloud Run service starts with a public bootstrap image. After Terraform
succeeds, `push-runners.sh` replaces it with the real Playrunner API image.

## 6. Check Outputs

After apply, inspect the key outputs:

```bash
terraform -chdir=infra/gcp output repository_urls
terraform -chdir=infra/gcp output api_service_uri
terraform -chdir=infra/gcp output api_image_uri
terraform -chdir=infra/gcp output workflow_events_topic_name
terraform -chdir=infra/gcp output scheduler_service_account_email
```

You can inspect the matching saved Playrunner settings with:

```bash
node infra/gcp/scripts/gcp-settings.mjs json
```

## 7. Publish Runtime Images

After Terraform succeeds, publish the API, Orchestrator, and Playwright runner
images:

```bash
./infra/gcp/scripts/push-runners.sh --target all --yes
```

The script reads the saved project, region, service defaults, and generated
image URI templates from the same local `CloudCredential` row.

## Troubleshooting

| Symptom                                                      | Check                                                                                                                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No GCP cloud credential found`                              | Complete OAuth, select a project and region, then click **Save GCP Settings**.                                                                                    |
| `GCP setting "selectedProject" is empty`                     | Reopen Connect to GCP, select the project, and save again.                                                                                                        |
| `GCP setting "cloudRunLocation" is empty`                    | Reopen Connect to GCP, set the Cloud Run region, and save again.                                                                                                  |
| Cloud Resource Manager is disabled while selecting a project | Enter the project ID manually in Connect to GCP. The project list is autocomplete only; Terraform enables the required APIs for the selected project.             |
| Terraform cannot create resources                            | Confirm the account used by Terraform can enable services and create Artifact Registry, Cloud Run, Pub/Sub, IAM, and Scheduler resources in the selected project. |
| Cloud Run cannot pull images                                 | Run `./infra/gcp/scripts/push-runners.sh --target all --yes` after Terraform creates the Artifact Registry repositories.                                          |
