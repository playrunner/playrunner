---
sidebar_position: 4
title: Project and Region Setup
sidebar_label: Project & Region
---

# Project and Region Setup

This stage tells Playrunner which existing Google Cloud project and Cloud Run
region to provision through OAuth. Playrunner does not create the project.

## 1. Create or Choose a Google Cloud Project

Use an existing project, or create one in the
[Google Cloud Console](https://console.cloud.google.com/projectcreate).

Copy the **Project ID**, not the display name. For example, use
`my-gcp-project-123`, not `My GCP Project`.

Before continuing, confirm:

- the project exists;
- billing is enabled when required for the selected services;
- organization policies allow Artifact Registry, Cloud Run, Pub/Sub, Cloud
  Scheduler, IAM service accounts, and Cloud Storage; and
- the connected Google account has the required project permissions.

## 2. Enter the Project in Playrunner

Open **Integrations**, choose **Connect to GCP**, and go to **Project & Region**.

After OAuth connects, Playrunner loads the projects visible to the connected
account. Start typing in **Google Cloud Project** and select the matching
Project ID.

If the project is new or lookup fails, click **Refresh projects**. If it still
does not appear, type the Project ID manually. If provisioning reports that
Cloud Resource Manager is disabled, enable that API in the selected project and
retry.

## 3. Choose the Cloud Run Region

Enter the region where Playrunner should create and run GCP services, for
example:

```text
us-central1
```

Use a region that supports Cloud Run and Artifact Registry. The saved region is
also used to generate the Orchestrator and Playwright Artifact Registry paths.

## 4. Review Advanced Runner Defaults

The defaults are suitable for most evaluations:

- **Orchestrator Service Name** defaults to `playrunner-orchestrator`.
- **Min Instances** can be `0` to allow scale-to-zero.
- **Max Instances** must be at least `1`.
- **Always-allocated CPU** lets background DAG work continue after `/execute`
  returns.

## 5. Save and Provision

Click **Save and Continue**. Playrunner saves the project, region, runner
defaults, generated image URI templates, and scheduler service account email
with the GCP connection.

The dialog then moves to **Provision**. Click **Provision cloud runners** to
check permissions, enable APIs, and create the shared runner resources. No
Terraform command is required.

## Changing Project or Region

Changing the project or region clears the saved provisioning result:

1. Save the new project or region.
2. Click **Provision cloud runners**.
3. Upload the runner images to the new repositories:

```bash
./infra/gcp/scripts/push-runners.sh --target both --yes
```

4. Click **Recheck setup**.

Existing resources in the previous project or region are not deleted
automatically.

## Troubleshooting

| Symptom                                     | Check                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Project is missing from suggestions         | Confirm the connected account can see it, refresh the list, or enter the Project ID manually.                 |
| Provisioning says the Project ID is invalid | Use the immutable Project ID rather than the project name or number.                                          |
| API enablement fails                        | Grant `serviceusage.services.enable` and confirm organization policy permits the required APIs.               |
| Artifact Registry creation fails            | Confirm the selected region supports Artifact Registry and the account has the listed repository permissions. |
| Images go to the wrong project              | Save the correct project and region, provision again, then rerun `push-runners.sh --target both --yes`.       |

Return to [GCP Setup](./setup.md) for the provisioning checklist and complete
permission list.
