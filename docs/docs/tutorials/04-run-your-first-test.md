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
runs. Each workflow node starts collapsed. Use its expand arrow to reveal child
processes such as discovery, numbered shards, and report aggregation. Collapse
the node again to hide those details.

The parent row keeps its combined test progress visible while collapsed:
completed and total tests, percentage, remaining tests, and passed, failed,
skipped, and running counts. Shard counts are added together; discovery and
aggregation do not count the same tests again. For example, shards reporting
53 of 236 and 47 of 226 tests produce 100 of 462 completed tests on the parent.

A running node without test counts shows an activity bar until progress is
available. Expanded child rows retain their own status, progress, runner
resources when available, and report links. Your expand/collapse choices stay
in place during live updates and reconnections; reloading the page resets them.
During a connection interruption, running progress is marked **Last reported**.

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
