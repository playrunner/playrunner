---
sidebar_position: 1
sidebar_label: Choose how to run it
title: Get started with Playrunner
description: Run Playrunner locally with Docker or deploy it to your own cloud account. Compare both options and pick the one that matches how you want to run tests.
keywords:
  ['run playwright orchestration', 'self-host playwright', 'playrunner setup']
---

# Get started with Playrunner

Playrunner orchestrates the Playwright suite you already have. Before the first
workflow runs, there is one decision to make: **where Playrunner itself runs.**

## Your options today

|                         | Local (Docker)                                    | Your own cloud                                               |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| **Best for**            | Evaluating Playrunner, and day-to-day development | Teams running Playwright on a schedule, or sharing workflows |
| **Setup time**          | About 15 minutes                                  | Longer — you provision cloud resources                       |
| **What runs the tests** | Docker containers on your machine                 | Cloud Run jobs in your GCP project                           |
| **Cost**                | Free. No license fee for permitted use            | Free license; you pay your cloud provider                    |
| **Data location**       | Entirely on your machine                          | Entirely in your cloud account                               |
| **Availability**        | Available now                                     | Available now (GCP; AWS and Azure planned)                   |

**If you are not sure, start locally.** It is the fastest path to a running
workflow, everything works the same way, and moving execution to a cloud runner
later is a setting on the node rather than a rewrite.

## What about Playrunner Cloud?

Playrunner Cloud is the fully hosted version — no infrastructure for you to
operate at all. **It is in beta, with limited access.** Beta access and pricing
details will be announced separately; see the [pricing page](/pricing) for the
current position.

If you would like to be included in the beta, ask in
[Discord](https://discord.gg/4zPdBy3DwU).

Everything in these docs works today on the two options above, and workflows
built now carry over.

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
- [How Playrunner compares](/compare/) to CI pipelines and managed grids.
