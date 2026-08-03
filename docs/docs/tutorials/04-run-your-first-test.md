---
sidebar_position: 4
title: Run Your First Test
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

## Step 4 — Inspect the result

Once the run finishes:

- Right-click a **Playwright** node → **View Report** to open the full Playwright HTML report in a new tab.
- The report is stored per-run under a unique ID, so historical reports are always available.

---

## Step 5 — Run the saved workflow from the CLI

Use the Playrunner CLI when you want to start the same saved workflow from a
terminal or CI/CD pipeline.

### Find the workflow ID

Open the saved workflow in Playrunner and copy its workflow ID from the browser
URL. The workflow ID is the value after `/workflows/`; do not copy an example ID
from documentation.

### Create an API token

1. Open **Settings → API tokens**.
2. Select **Create token**.
3. Give the token a descriptive name, such as `CI`.
4. Restrict it to this workflow when appropriate.
5. Copy the token when it is shown. Playrunner cannot display it again.

### Run the workflow

Set your own values as environment variables, then pass the workflow ID to the
CLI:

```bash
export PLAYRUNNER_URL='<your-playrunner-url>'
export PLAYRUNNER_API_KEY='<your-api-token>'
export PLAYRUNNER_WORKFLOW_ID='<your-workflow-id>'

npx playrunner "$PLAYRUNNER_WORKFLOW_ID"
```

For Playrunner Cloud, set `PLAYRUNNER_URL` to `https://playrunner.cloud`. For a
self-hosted or local installation, use the Playrunner URL for that environment.

The command streams progress and returns a non-zero exit code if the workflow
fails. Use `--no-wait` to return as soon as Playrunner accepts the run, or
`--timeout 10m` to choose a different wait limit.

In CI/CD, store the API token in a protected, masked secret variable. Never
commit API tokens to source control or paste them into documentation.

---

## Troubleshooting a failed run

| Symptom                        | Likely cause                                           |
| ------------------------------ | ------------------------------------------------------ |
| Node stays yellow indefinitely | Orchestrator container not running — check `docker ps` |
| `git clone` fails              | GitHub token expired or repo access revoked            |
| Tests error immediately        | Wrong Playwright version selected for your project     |
| `PLAYRUNNER_URL` is required   | Export the URL in the same shell that runs the CLI     |
| `command not found`            | Use `npx playrunner` or install the CLI globally       |

See the [Troubleshooting guide](../local-dev/09-troubleshooting.md) for more
detail.

---

## Next steps

➡️ [Understanding Test Reports](./05-understanding-reports.md)
