---
sidebar_position: 2
title: GCP Setup
sidebar_label: Setup
---

# GCP Setup

Playrunner provisions the Google Cloud resources required by its cloud runners
through the connected user's OAuth session. You do not need to run Terraform to
connect a local Playrunner installation to GCP.

The **Connect to GCP** dialog has three stages:

1. [OAuth](./oauth.md) connects Playrunner to a Google account.
2. [Project & Region](./project-region.md) selects the existing Google Cloud
   project and Cloud Run region.
3. **Provision** checks permissions, enables APIs, and creates or reconciles the
   shared runner resources.

## Before You Start

You need:

- an existing Google Cloud project;
- billing enabled when required by Cloud Run, Artifact Registry, Pub/Sub, or
  Cloud Scheduler;
- a Google OAuth web client for Playrunner; and
- a Google account with the provisioning and runtime permissions listed below.

Playrunner does not create the Google Cloud project itself.

## First-Time Setup

1. Start Playrunner locally:

```bash
./start-local.sh
```

2. Open **Integrations** and choose **Connect to GCP**.
3. Complete [Google OAuth setup](./oauth.md).
4. Select the project and region, review the runner defaults, and click
   **Save and Continue**.
5. Click **Provision cloud runners**.
6. Review each provisioning check. The operation is idempotent, so you can run
   it again after correcting a permission or organization-policy problem.
7. If **Runner images** shows a warning, upload the locally built Orchestrator
   and Playwright runner images:

```bash
./infra/gcp/scripts/push-runners.sh --target both --yes
```

8. Click **Recheck setup**. When the dialog reports **Cloud runners are ready**,
   close it and run a workflow with the GCP runner selected.

The image upload remains a local command because OAuth provisioning creates the
Artifact Registry repositories but does not build or publish container images.

## What OAuth Provisioning Creates

Playrunner enables these Google Cloud APIs:

- Artifact Registry
- Cloud Scheduler
- Cloud Resource Manager
- Identity and Access Management
- Pub/Sub
- Cloud Run
- Service Usage
- Cloud Storage

It then creates or reuses:

| Resource                        | Name                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| Artifact Registry repository    | `orchestrator`                                              |
| Artifact Registry repository    | `playwright-runner`                                         |
| Pub/Sub topic                   | `playrunner-workflow-events`                                |
| Cloud Scheduler service account | `playrunner-scheduler@<project-id>.iam.gserviceaccount.com` |

The provisioning request also checks whether both Artifact Registry
repositories contain images. Cloud Run services, jobs, execution subscriptions,
and workflow output buckets are reconciled later by the API and Orchestrator as
workflows are run.

## Required Google Cloud Permissions

Before changing resources, Playrunner calls `testIamPermissions` for the
selected project.

The connected account must have these permissions to complete provisioning:

```text
artifactregistry.dockerimages.list
artifactregistry.repositories.create
artifactregistry.repositories.get
iam.serviceAccounts.create
iam.serviceAccounts.get
pubsub.topics.create
pubsub.topics.get
serviceusage.services.enable
```

The account also needs these runtime permissions for the setup to be reported
as fully ready:

```text
artifactregistry.dockerimages.list
cloudscheduler.jobs.create
cloudscheduler.jobs.delete
cloudscheduler.jobs.get
cloudscheduler.jobs.update
iam.serviceAccounts.actAs
pubsub.subscriptions.consume
pubsub.subscriptions.create
pubsub.subscriptions.delete
pubsub.subscriptions.get
pubsub.topics.create
pubsub.topics.get
pubsub.topics.publish
run.jobs.create
run.jobs.get
run.jobs.run
run.jobs.runWithOverrides
run.jobs.update
run.services.create
run.services.get
run.services.setIamPolicy
run.services.update
storage.buckets.create
storage.buckets.get
```

Grant these through your organization's preferred predefined or custom IAM
roles. Playrunner reports the exact missing permissions in the **Project
permissions** step; it does not grant project IAM roles to the connected user.

## Provisioning States

| State    | Meaning                                                                | Next action                                                  |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Complete | The check or resource reconciliation succeeded.                        | Continue to the next item.                                   |
| Warning  | Provisioning succeeded, but runtime permissions or images are missing. | Grant the listed permissions or upload images, then recheck. |
| Failed   | Playrunner could not complete the current step.                        | Correct the displayed Google Cloud error and retry.          |

A saved result applies only to the project and region shown in the dialog.
Changing either value clears the previous result and requires provisioning
again.

## Generated Runner Settings

Playrunner generates the standard Artifact Registry paths from the selected
region:

```text
<region>-docker.pkg.dev/{projectId}/orchestrator/playrunner-orchestrator:latest
<region>-docker.pkg.dev/{projectId}/playwright-runner/playrunner-playwright-runner-{runtime}:{version}
```

It also saves the Orchestrator service name, minimum and maximum instances, CPU
idle policy, and scheduler service account email with the GCP connection.

## Local Scheduler Callbacks

Most GCP workflow debugging does not need a public tunnel because the API pulls
runner events from Pub/Sub over outbound HTTPS.

You only need a tunnel when Google Cloud Scheduler must call a local Playrunner
API for enabled schedules. Start a tunnel to the local API port:

```bash
cloudflared tunnel --url http://127.0.0.1:3011
```

Use the API port printed by `./start-local.sh` or the `PORT` value in
`apps/api/.env`. Put Cloudflare's HTTPS URL in `apps/api/.env`:

```dotenv
PLAYRUNNER_PUBLIC_API_URL=https://your-tunnel.trycloudflare.com
```

Restart the local API, then save the workflow with the schedule enabled.

## Troubleshooting

| Symptom                                | Resolution                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project lookup is unavailable          | Enter the Project ID manually. If provisioning reports that Cloud Resource Manager is disabled, enable that API in the selected project and retry. |
| Project permissions fails              | Grant the exact permissions displayed by the dialog to the connected account, then retry.                                                          |
| Google reports an API or billing error | Confirm billing and organization policy permit the service in the selected project and region.                                                     |
| Runner images shows a warning          | Run `./infra/gcp/scripts/push-runners.sh --target both --yes`, then click **Recheck setup**.                                                       |
| OAuth has expired                      | Return to the OAuth stage and reconnect the Google account.                                                                                        |
| Setup was interrupted                  | Click **Provision cloud runners** again. Existing matching resources are reused.                                                                   |

## Optional Terraform Deployment

Terraform is not required for OAuth cloud-runner setup. Use
[Terraform setup](./terraform.md) only when you intentionally want Terraform to
manage the wider GCP deployment, including the Playrunner API Cloud Run service
and its infrastructure state.

## More Detail

- [Google OAuth setup](./oauth.md)
- [Project and Region setup](./project-region.md)
- [Optional Terraform deployment](./terraform.md)
- [Publishing to GCP](../../local-dev/06-docker-images.md#publishing-to-gcp)
- [Remote Runner Messaging](../../local-dev/10-remote-debugging.md)
