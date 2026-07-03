---
sidebar_position: 2
title: Create Your First Workflow
---

# Create Your First Workflow

In this tutorial you'll build a simple two-node workflow in the Playrunner visual editor — a **Schedule** trigger that fires a **Playwright** test run.

**Prerequisites:** Complete [Getting Started](./getting-started) first.

---

## Step 1 — Open the Editor

Navigate to the URL printed by `./start-local.sh` and click **Editor** in the sidebar. With defaults, that is `http://127.0.0.1:3100`. The canvas opens with an empty workflow.

---

## Step 2 — Add a Schedule node

1. Click the **+** button (or right-click the canvas) to open the node selector.
2. Under **Triggers**, choose **Schedule**.
3. The node appears on the canvas. Click it to open its configuration panel.
4. Set a cron expression, e.g. `0 9 * * 1-5` for weekdays at 9 AM.

---

## Step 3 — Add a Playwright node

1. Open the node selector again.
2. Under **Integrations**, choose **Playwright**.
3. Drag it to the right of the Schedule node.

---

## Step 4 — Connect the nodes

Click the **output port** on the right edge of the Schedule node and drag a connection line to the **input port** on the left edge of the Playwright node.

The workflow now reads: _"On schedule → run Playwright tests"_.

---

## Step 5 — Configure the Playwright node

Click the Playwright node to open its panel:

- **Repository** — select a GitHub repo (you'll connect GitHub in the next tutorial)
- **Branch** — choose a branch, e.g. `main`
- **Playwright version** — pick the version matching your project

---

## Step 6 — Save the workflow

Click **Save** in the top toolbar. Your workflow is persisted to PostgreSQL through the Prisma-backed API and will be available next time you open the editor.

---

## Next steps

➡️ [Connect GitHub](./connect-github)
