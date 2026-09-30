---
sidebar_position: 4
title: Run Your First Test
description: Trigger a Playwright run from the Playrunner canvas and watch node status, live logs, and artefacts stream back as the workflow executes.
---

# Run Your First Test

With a workflow saved and GitHub connected, you're ready to trigger a live test run and watch it execute in real time.

**Prerequisites:** Complete [Connect GitHub](./03-connect-github.md) first.

---

## Step 1 — Open your workflow

Open the Playrunner editor and select the workflow you created in the previous tutorial.

---

## Step 2 — Trigger a manual run

Click the **▶ Run** button in the editor toolbar. Playrunner will:

1. Start the **Orchestrator** (if not already running)
2. Clone your GitHub repository into an isolated Docker container
3. Execute your Playwright tests inside that container
4. Stream logs back to the editor in real time via SSE

---

## Step 3 — Watch the live logs

Each node displays its status as the run progresses:

| Node colour         | Meaning             |
| ------------------- | ------------------- |
| 🟡 Yellow / pulsing | Currently executing |
| 🟢 Green            | Passed              |
| 🔴 Red              | Failed              |

Click any node while it's running (or after) to open the **log panel** and see the raw test output.

---

### Follow progress in Live executions

Open **Live executions** from the sidebar to follow active workflows and recent
runs. Each execution card starts collapsed. Use the arrow beside its title to
expand or collapse that card independently of other runs.

A collapsed card shows the workflow title, project when available, runner
provider, elapsed time, start time, and overall status. Each workflow node has
an icon with a status indicator that continues updating while the card is
collapsed. Hover over an icon to read the node's name and status; these labels
are also available to screen readers.

Expand the card again to see node progress, runner resources when available,
the execution ID, and workflow or report links. Inside an expanded card, each
workflow node initially hides its child processes. Use the node's own arrow to
reveal discovery, numbered shards, and report aggregation, or collapse the node
again to hide those details.

The parent row keeps its combined test progress visible while its child
processes are hidden and the execution card is expanded:
completed and total tests, percentage, remaining tests, and passed, failed,
skipped, and running counts. Shard counts are added together; discovery and
aggregation do not count the same tests again. For example, shards reporting
53 of 236 and 47 of 226 tests produce 100 of 462 completed tests on the parent.

A running node without test counts shows an activity bar until progress is
available. Expanded child rows retain their own status, progress, runner
resources when available, and report links. Card and child-process
expand/collapse choices stay in place during live updates and reconnections,
including when a run completes. Expanding a card restores its child-process
choices; reloading the page resets both levels.

During a connection interruption, running progress is marked **Last reported**.
Collapsed cards replace running indicators with a warning icon labelled
**Last reported running**. Runs with no recent activity show **Status
unconfirmed**; expand the card for the last-update details.

---

## Step 4 — Inspect the result

Once the run finishes:

- Right-click a **Playwright** node → **View Report** to open the full Playwright HTML report in a new tab.
- The report is stored per-run under a unique ID, so historical reports are always available.

---

## Step 5 — Run the saved workflow from the CLI

To start this saved workflow from a terminal or CI/CD pipeline, follow the
[CLI run guide](/docs/cli/run-workflow/). It covers API tokens, workflow IDs,
waiting and timeouts, workflow inputs, source-change context, and CI/CD setup.

---

## Troubleshooting a failed run

| Symptom                        | Likely cause                                           |
| ------------------------------ | ------------------------------------------------------ |
| Node stays yellow indefinitely | Orchestrator container not running — check `docker ps` |
| `git clone` fails              | GitHub token expired or repo access revoked            |
| Tests error immediately        | Wrong Playwright version selected for your project     |

See the [Troubleshooting guide](../local-dev/09-troubleshooting.md) for more
detail.

---

## Next steps

➡️ [Understanding Test Reports](./05-understanding-reports.md)
