---
sidebar_position: 1
sidebar_label: Overview
title: Playwright workflow use cases
description: 'Common workflows built on the Playrunner canvas: Slack alerts, Jira bugs, AI failure triage, scheduled regression runs, and webhook-triggered tests.'
keywords:
  ['playwright workflow examples', 'playwright test automation workflows']
---

# Playwright workflow use cases

Each page here builds one complete workflow on the canvas, from trigger to
outcome. They all assume you have Playrunner running and a repository connected
— if not, start with [Get started with Playrunner](/docs/start/).

They also share one idea worth understanding first:
[connection state](/docs/local-dev/connection-nodes/). What happens after a
Playwright run is decided by the _kind of edge_ you draw out of it — on
failure, on success, sequential, concurrent, or independent — rather than by a
condition inside a script.

## Reacting to results

- **[Slack alerts for failed Playwright tests](/docs/use-cases/slack-alerts-for-failed-playwright-tests/)**
  — route failures to the right channel, with the run and report attached.
- **[Create Jira bugs from failed Playwright tests](/docs/use-cases/create-jira-bugs-from-failed-playwright-tests/)**
  — open a ticket automatically, with run context in the fields.
- **[AI triage for Playwright test failures](/docs/use-cases/ai-triage-for-playwright-test-failures/)**
  — summarise what broke before a human reads it.

## Starting runs

- **[Scheduled Playwright test runs](/docs/use-cases/scheduled-playwright-test-runs/)**
  — nightly and recurring runs without a cron job in CI.
- **[Trigger Playwright tests from a webhook](/docs/use-cases/trigger-playwright-tests-from-a-webhook/)**
  — run a suite when another system says so, and report back when it finishes.

## Related

- [Integration reference](/docs/integration-packages/) — every available node.
