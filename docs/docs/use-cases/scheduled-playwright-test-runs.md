---
sidebar_position: 5
sidebar_label: Scheduled runs
title: Run Playwright tests on a schedule
description: Set up nightly and recurring Playwright runs with a Schedule node, without maintaining a cron entry in CI or a second duplicated pipeline.
keywords:
  [
    'schedule playwright tests',
    'nightly playwright run',
    'playwright cron without ci',
    'recurring playwright tests',
  ]
---

# Run Playwright tests on a schedule

Scheduled runs are where CI pipelines get duplicated. The nightly regression is
usually a copy of the pull-request workflow with a different trigger and a few
things commented out, and the two drift apart within a month.

A [Schedule node](/docs/integration-packages/schedule/) makes the trigger part
of the graph instead of part of the pipeline file, so the same workflow can be
started by a schedule and by anything else.

## What you need

- Playrunner running — see [Get started](/docs/start/).
- A repository with Playwright tests
  [connected through GitHub](/docs/tutorials/connect-github/).

## Build the workflow

```text
Schedule ──sequential──▶ Environment ──sequential──▶ Playwright
```

The Schedule node starts the run on a recurring cadence. Everything downstream
is the workflow you would have built anyway.

Note that Schedule is a trigger node and does not accept inbound connections —
nothing can point _at_ it. The
[connection state rules](/docs/local-dev/connection-nodes/) explain how the
editor derives this from node metadata; in practice the editor simply will not
offer it as a connection target.

## Choosing a cadence

- **Nightly** suits a full regression suite that takes too long for every pull
  request.
- **Hourly or more often** suits a small smoke suite against a live
  environment, where the point is detecting an outage rather than a regression.
- **Weekly** suits long-running or expensive suites — cross-browser matrices,
  or anything hitting a rate-limited third party.

Set the cadence so a run has comfortably finished before the next one starts.
Each node runs at most once per execution, but two overlapping executions of
the same workflow against the same environment will interfere with each other
at the application level.

## Running against different environments

Rather than duplicating the workflow per environment, branch after the
schedule:

```text
                ┌──concurrent──▶ Environment (staging)  ──▶ Playwright
Schedule ───────┤
                └──concurrent──▶ Environment (preprod)  ──▶ Playwright
```

**Concurrent** edges start both branches at once, so the two environments are
tested in parallel rather than one after the other. Use **Sequential** instead
if they share a resource that cannot handle both.

## Alerting on a scheduled run

Nobody watches a nightly run. Attach the notification to it directly:

```text
Schedule ──▶ Environment ──▶ Playwright ──failure──▶ Slack
```

See [Slack alerts for failed tests](/docs/use-cases/slack-alerts-for-failed-playwright-tests/).
For a nightly suite specifically, routing the failure through
[AI triage](/docs/use-cases/ai-triage-for-playwright-test-failures/) first is
worth it — someone reads that message cold the next morning with no context.

## Versus `on: schedule` in CI

A cron entry in CI works. It stops being pleasant when the scheduled variant
needs different environment variables, a different browser matrix, different
retry behaviour, and a notification the pull-request version does not have — at
which point it is a second pipeline to keep in sync. Here the schedule is one
node in front of a workflow that already exists.

## Next steps

- [Schedule integration reference](/docs/integration-packages/schedule/)
- [Trigger tests from a webhook](/docs/use-cases/trigger-playwright-tests-from-a-webhook/)
- [Connection state rules](/docs/local-dev/connection-nodes/)
