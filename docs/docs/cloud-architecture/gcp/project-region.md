---
sidebar_position: 4
title: Project and Region Setup
sidebar_label: Project & Region
---

# Project and Region Setup

This step tells Playrunner which Google Cloud project and Cloud Run region to
use. It does not create the Google Cloud project.

Create the project in GCP if it is not already created. Playrunner and the
`infra/gcp` Terraform expect `project_id` to reference an existing Google Cloud
project.

## 1. Create or Choose a Google Cloud Project

Use an existing Google Cloud project, or create a new one in the
[Google Cloud Console](https://console.cloud.google.com/projectcreate).

Copy the **Project ID**, not the project display name. For example, use
`my-gcp-project-123`, not `My GCP Project`.

Before continuing, confirm:

- The project exists in Google Cloud.
- Billing is enabled if your organization requires it for Cloud Run, Artifact
  Registry, Pub/Sub, or Cloud Scheduler.
- The account that will run Terraform can enable services and create resources
  in the project.

Terraform enables the required Google Cloud APIs, but it does not create the
project itself.

## 2. Enter the Project in Playrunner

Open **Integrations**, choose **Connect to GCP**, and go to
**Project & Region**.

After OAuth connects, Playrunner loads the Google Cloud projects visible to the
connected account. Start typing in **Google Cloud Project** and select the
matching **Project ID** from the suggestions.

If the project is new, not visible to the connected account, or Google project
lookup fails, click **Refresh projects**. If it still does not appear, type the
Project ID manually. The project must already exist in GCP before you continue
to Terraform.

## 3. Choose the Cloud Run Region

Enter the Cloud Run region where Playrunner should create and run GCP services,
for example:

```text
us-central1
```

Use a region that supports Cloud Run and Artifact Registry. The saved region is
also used to generate the standard Artifact Registry image paths for the API,
Orchestrator, and Playwright runner images.

## 4. Review Advanced Runner Defaults

The default settings are usually enough for local evaluation:

- **Orchestrator Service Name** defaults to `playrunner-orchestrator`.
- **Min Instances** can be `0` if you want the Orchestrator to scale to zero.
- **Max Instances** must be at least `1`.
- **Always-allocated CPU** keeps background DAG work active after `/execute`.

Change these only when you know the runtime behavior you want.

## 5. Save and Continue

Click **Save and Continue** in the Connect to GCP dialog.

Playrunner saves the project, region, scheduler service account email, runner
defaults, and generated image URI templates in the local `CloudCredential` row.
The dialog then moves to **Terraform**, where you can generate
`infra/gcp/terraform.tfvars`.

Continue to [Terraform setup](./terraform.md).

## Changing Project or Region Later

If you change the project or region after Terraform has already been run:

1. Save the new values in **Project & Region**.
2. Re-run the setup script:

```bash
./infra/gcp/scripts/setup-terraform.sh
```

3. Review `infra/gcp/terraform.tfvars`.
4. Run Terraform again:

```bash
terraform -chdir=infra/gcp plan
terraform -chdir=infra/gcp apply
```

5. Publish the runtime images again so the generated image paths match the saved
   project and region:

```bash
./infra/gcp/scripts/push-runners.sh --target all --yes
```

## Troubleshooting

| Symptom                                  | Check                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project does not appear in suggestions   | Click **Refresh projects**. If it is still missing, confirm the project exists and the connected Google account can see it, then type the Project ID manually. |
| Terraform says `project_id` is invalid   | Confirm the project already exists in Google Cloud and that you used the Project ID, not the project name.                                                     |
| Terraform cannot enable services         | Confirm the account running Terraform has permission to enable services in the selected project.                                                               |
| Cloud Run or Artifact Registry fails     | Confirm billing and organization policy allow these services in the selected project and region.                                                               |
| Published images go to the wrong project | Save the correct project and region, re-run `setup-terraform.sh`, apply Terraform, then run `push-runners.sh --target all --yes` from the repo root.           |
