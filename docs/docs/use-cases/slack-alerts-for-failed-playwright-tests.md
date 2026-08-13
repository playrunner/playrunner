---
sidebar_position: 2
sidebar_label: Slack alerts on failure
title: Send Slack alerts when Playwright tests fail
description: Route failed Playwright runs to a Slack channel automatically, and send passing runs somewhere quieter, using a failure edge on the Playrunner canvas.
keywords:
  [
    'playwright slack notification',
    'notify slack when tests fail',
    'playwright slack integration',
  ]
---

# Send Slack alerts when Playwright tests fail

The usual version of this is a conditional step at the end of a CI job that
shells out to `curl` with a hand-built JSON payload, duplicated across every
workflow file that needs it. This does the same job as an edge on the canvas.

## What you need

- Playrunner running — see [Get started](/docs/start/).
- A repository with Playwright tests
  [connected through GitHub](/docs/tutorials/connect-github/).
- A Slack workspace you can authorise.

## Connect Slack

The [Slack integration](/docs/integration-packages/slack/) authenticates either
through OAuth or an incoming webhook. OAuth is the better default: it lets
Playrunner list your channels, so the node configuration becomes a channel
picker rather than a pasted URL.

Connect it once from settings. The connection is reused by every workflow.

## Build the workflow

The graph is three nodes:

```text
Environment ──sequential──▶ Playwright ──failure──▶ Slack
```

1. **Environment node** — the variables your suite needs, defined once and
   injected into the run.
2. **Playwright node** — the repository, branch, and Playwright version to run.
3. **Slack node** — the channel and the message.

The important part is the **edge type between Playwright and Slack**. Draw an
**On Failure** connection. The Slack node then runs only when the Playwright
node fails, and is skipped when it passes. No condition inside the node, and
nothing to keep in sync.

## Route passing and failing runs differently

Most teams want failures loud and passes quiet. Draw two edges out of the same
Playwright node:

```text
                   ┌──failure──▶ Slack  (#qa-alerts)
Playwright ────────┤
                   └──success──▶ Slack  (#qa-runs)
```

Both nodes exist on the canvas, each configured with its own channel and
message. Exactly one of them runs per execution, because
[On Success and On Failure are mutually exclusive](/docs/local-dev/connection-nodes/).

If you want a message on _every_ run regardless of outcome, use an
**Independent** connection instead — it runs after the parent finishes either
way.

## What to put in the message

Keep it short enough to read in a notification and useful enough to act on:

- Which workflow ran, and on which branch.
- Whether it passed or failed.
- A link back to the run, so the Playwright report, screenshots, and traces are
  one click away.

Artefacts stay attached to the run rather than being uploaded into Slack, so
the channel does not become a dumping ground for zip files.

## Common variations

- **Escalate only repeated failures** — put the Slack node behind a second
  workflow triggered on a [schedule](/docs/use-cases/scheduled-playwright-test-runs/)
  rather than on every run.
- **Summarise before alerting** — insert an
  [AI triage node](/docs/use-cases/ai-triage-for-playwright-test-failures/)
  between Playwright and Slack, so the message says what broke rather than that
  something broke.
- **Open a ticket at the same time** — draw a second failure edge to a
  [Jira node](/docs/use-cases/create-jira-bugs-from-failed-playwright-tests/).
  Both run on the same failure.

## Next steps

- [Slack integration reference](/docs/integration-packages/slack/)
- [Connection state rules](/docs/local-dev/connection-nodes/)
- [Create Jira bugs from failed tests](/docs/use-cases/create-jira-bugs-from-failed-playwright-tests/)
