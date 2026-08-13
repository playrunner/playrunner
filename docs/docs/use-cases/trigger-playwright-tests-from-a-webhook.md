---
sidebar_position: 6
sidebar_label: Webhook triggers
title: Trigger Playwright tests from a webhook
description: Start a Playwright run when another system says so using an inbound webhook node, and call back out to a deploy gate when the run finishes.
keywords:
  [
    'trigger playwright tests via api',
    'webhook test trigger',
    'run playwright tests from another system',
  ]
---

# Trigger Playwright tests from a webhook

Not every test run belongs to a commit. A deploy finishes, a staging
environment finishes seeding, a feature flag flips, a partner system publishes
a build — and something should verify it. Wiring that through a repository
event is usually the wrong shape.

The [Webhooks integration](/docs/integration-packages/webhooks/) handles both
directions: **inbound** triggers that start a workflow, and **outbound** HTTPS
requests that tell another system what happened.

## What you need

- Playrunner running — see [Get started](/docs/start/).
- A repository with Playwright tests
  [connected through GitHub](/docs/tutorials/connect-github/).
- A system that can make an HTTPS request.

## Build the workflow

```text
Webhook (inbound) ──▶ Environment ──▶ Playwright ──success──▶ Webhook (outbound)
                                                 └─failure──▶ Slack
```

The inbound node gives you a URL to call. The outbound node at the end reports
the result back to whatever asked for the run — which is what makes this usable
as a deploy gate rather than just a notification.

## Passing data in from the caller

The interesting part of an inbound trigger is usually the payload. A deploy
webhook knows which environment it just deployed and which version it shipped;
your tests want both.

Feed the payload into an **Environment** node between the webhook and the
Playwright node, so the values arrive as environment variables the suite
already knows how to read. That keeps the tests unchanged — they read
configuration the same way they always did, and the workflow decides what to
put there.

## Using it as a deploy gate

The outbound webhook on the success edge is what closes the loop:

1. Your deploy pipeline promotes a build to staging and calls the Playrunner
   webhook.
2. Playrunner runs the suite against that environment.
3. On success, the outbound webhook calls back and the pipeline continues to
   production.
4. On failure, the pipeline never hears success, and the Slack edge tells
   someone why.

If your CI system can simply wait for a command instead, the
[Playrunner CLI](/blog/playrunner-ci-cd-pipeline/) is the simpler option — it
exits non-zero on failure and gates a pipeline step directly. Webhooks are for
callers that cannot block, or that are not a CI system at all.

## Securing the endpoint

An inbound webhook URL starts real work on real infrastructure. Treat it as a
credential:

- Store it as a secret in the calling system rather than in a repository.
- Rotate it if it is ever exposed in a log or a shared pipeline output.
- Keep the workflow behind it narrow — a webhook that triggers a targeted suite
  is a much smaller problem than one that triggers everything.

## Next steps

- [Webhooks integration reference](/docs/integration-packages/webhooks/)
- [Use Playrunner as a CI/CD quality gate](/blog/playrunner-ci-cd-pipeline/)
- [Scheduled Playwright test runs](/docs/use-cases/scheduled-playwright-test-runs/)
