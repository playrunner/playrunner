---
sidebar_position: 3
sidebar_label: Jira bugs on failure
title: Create Jira bugs from failed Playwright tests
description: Open a Jira ticket automatically when a Playwright run fails, with run context in the fields, using a failure edge on the Playrunner canvas.
keywords:
  [
    'playwright jira integration',
    'auto create jira bug from test failure',
    'playwright test failure ticket',
  ]
---

# Create Jira bugs from failed Playwright tests

Filing the ticket is the step that gets skipped. It happens after the run, when
whoever noticed the failure is already three tabs away. Making it part of the
workflow means the ticket exists before anyone has to remember to create it.

## What you need

- Playrunner running — see [Get started](/docs/start/).
- A repository with Playwright tests
  [connected through GitHub](/docs/tutorials/connect-github/).
- A Jira site you can authorise, and a project to file into.

## Connect Jira

The [Jira integration](/docs/integration-packages/jira/) uses OAuth and looks
up your projects once connected, so the node configuration offers a project
picker rather than asking for IDs. It supports both **create** and **update**
actions.

## Build the workflow

```text
Environment ──sequential──▶ Playwright ──failure──▶ Jira (create)
```

Draw an **On Failure** connection from the Playwright node to the Jira node.
The ticket is created only when the run fails.

## Fill the fields with run context

A ticket that says "tests failed" wastes the automation. Configure the Jira
node so the issue carries enough to triage without opening Playrunner:

- **Summary** — the workflow and branch, so duplicates are recognisable at a
  glance.
- **Description** — which specs failed, and a link back to the run for the
  Playwright report, screenshots, and traces.
- **Project, issue type, and any required custom fields** — set once on the
  node.

## Avoiding duplicate tickets

This is the part worth thinking about before you turn it on. A nightly
regression suite that has been failing for a week will file seven tickets if
you let it.

Options, roughly in order of effort:

- **File from a narrow workflow.** Point the Jira edge at a smoke or critical
  path suite rather than the full regression run, so tickets mean something.
- **Use the update action.** The Jira node supports updating as well as
  creating, so a follow-up node can append to an existing issue rather than
  opening another.
- **Put a human in the loop.** Send the
  [Slack alert](/docs/use-cases/slack-alerts-for-failed-playwright-tests/)
  automatically and keep ticket creation on a workflow someone triggers
  deliberately.
- **Triage first.** Route the failure through
  [AI analysis](/docs/use-cases/ai-triage-for-playwright-test-failures/) and
  file the summary, so a repeated failure at least reads as the same problem.

There is no built-in deduplication today. Design the workflow so that a ticket
per failure is the behaviour you actually want.

## Alerting and filing at once

Two failure edges out of the same Playwright node both run on the same failure:

```text
                   ┌──failure──▶ Jira   (create bug)
Playwright ────────┤
                   └──failure──▶ Slack  (#qa-alerts)
```

## Next steps

- [Jira integration reference](/docs/integration-packages/jira/)
- [Connection state rules](/docs/local-dev/connection-nodes/)
- [AI triage for Playwright test failures](/docs/use-cases/ai-triage-for-playwright-test-failures/)
