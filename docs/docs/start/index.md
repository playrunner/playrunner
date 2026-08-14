---
sidebar_position: 1
sidebar_label: Choose how to run it
title: Get started with Playrunner
description: Use the managed Playrunner Cloud beta, run it locally with Docker, or deploy it to your own cloud. Compare the three and pick what fits how you work.
keywords:
  [
    'run playwright orchestration',
    'self-host playwright',
    'playrunner setup',
    'playwright cloud test orchestration',
  ]
---

# Get started with Playrunner

Playrunner orchestrates the Playwright suite you already have. Before the first
workflow runs, there is one decision to make: **where Playrunner itself runs.**

## Your options today

|                      | Playrunner Cloud                          | Local (Docker)                         | Your own cloud                              |
| -------------------- | ----------------------------------------- | -------------------------------------- | ------------------------------------------- |
| **Best for**         | Trying Playrunner, and teams sharing work | Day-to-day development and evaluation  | Keeping runs inside your own infrastructure |
| **Setup time**       | A couple of minutes                       | About 15 minutes                       | Longer — you provision cloud resources      |
| **What you operate** | Nothing                                   | Docker on your machine                 | Cloud Run jobs in your GCP project          |
| **Cost**             | Free during the beta                      | Free. No license fee for permitted use | Free license; you pay your cloud provider   |
| **Data location**    | Hosted by Playrunner                      | Entirely on your machine               | Entirely in your cloud account              |
| **Availability**     | Free beta, open to sign-ups               | Available now                          | Available now (GCP; AWS and Azure planned)  |

**If you just want to see it work, use Playrunner Cloud.** Go to
[playrunner.cloud](https://playrunner.cloud), sign in with GitHub or Google, and
you can build a workflow without installing anything.

**If you would rather run it yourself, start locally.** Everything works the
same way, and moving execution to a cloud runner later is a setting on the node
rather than a rewrite.

Workflows you build on one option carry over to the others — the workflow model
is identical.

## Get running

1. **[Set up Playrunner locally](/docs/tutorials/getting-started/)** — Docker,
   Node 20+, and about fifteen minutes.
2. **[Create your first workflow](/docs/tutorials/create-your-first-workflow/)**
   — two nodes and a connection.
3. **[Connect GitHub](/docs/tutorials/connect-github/)** — point Playrunner at
   the repository holding your Playwright tests.
4. **[Run your first test](/docs/tutorials/run-your-first-test/)** — watch node
   state and logs stream back live.

## Moving execution to your own cloud

Once a workflow runs locally, the
[runner architecture](/docs/runner-architecture/) section covers moving
execution off your machine:

- [Local runner architecture](/docs/runner-architecture/local/) — what the
  local setup is actually doing.
- [GCP runner architecture](/docs/runner-architecture/gcp/) — Cloud Run
  runners, Pub/Sub messaging, and Cloud Storage for artefacts.

## Going further

- [Use cases](/docs/use-cases/) — Slack alerts, Jira bugs, AI failure triage,
  schedules, and webhook triggers.
- [Integration reference](/docs/integration-packages/) — every available node.
