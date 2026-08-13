---
sidebar_position: 4
sidebar_label: AI failure triage
title: AI triage for Playwright test failures
description: Summarise what broke in a failed Playwright run with an OpenAI or Hugging Face node, then send the summary to Slack or into a Jira ticket.
keywords:
  [
    'ai playwright test failure analysis',
    'summarise flaky test failures',
    'ai test triage',
  ]
---

# AI triage for Playwright test failures

A failure notification that says "12 tests failed" tells you nothing you could
not have guessed. The useful version says which ones, whether they look
related, and whether it resembles an environment problem rather than a
regression. That summary is a node on the canvas.

## What you need

- Playrunner running — see [Get started](/docs/start/).
- A repository with Playwright tests
  [connected through GitHub](/docs/tutorials/connect-github/).
- An API key for either
  [OpenAI](/docs/integration-packages/openai/) or
  [Hugging Face](/docs/integration-packages/huggingface/).

:::note Available AI nodes
Playrunner ships two AI integrations: **OpenAI** and **Hugging Face**. There is
no Gemini node. See the
[integration reference](/docs/integration-packages/) for the full list.
:::

## Build the workflow

```text
Playwright ──failure──▶ OpenAI ──sequential──▶ Slack
```

Draw an **On Failure** edge from the Playwright node into the AI node, then a
**Sequential** edge from the AI node to wherever the summary should go.

Sequential matters here: because the AI node has a conditional connection
upstream, a sequential child runs only when its parent completed successfully.
If the model call fails, you do not get a Slack message containing an error
object.

## What the AI node receives and returns

The [OpenAI node](/docs/integration-packages/openai/) calls the Responses API
and can return either plain text or structured JSON. On success it exposes to
downstream nodes:

- the response data,
- the model used,
- the response ID where present,
- numeric usage information.

Downstream nodes read that output, which is what makes "summarise, then post
the summary" a two-node chain rather than a script.

Prefer **structured output** when the summary feeds a ticket. Asking for fields
like `likely_cause`, `affected_areas`, and `confidence` gives you something you
can map onto Jira fields, instead of a paragraph you have to parse.

## Writing a prompt that earns its place

The failure mode here is a confident summary that is wrong. Some things that
help:

- **Ask it to distinguish** between an application regression, a test problem,
  and an environment or infrastructure failure. That single distinction is most
  of the triage value.
- **Ask for uncertainty explicitly.** A model told to say "insufficient
  information" will sometimes do it; one told to summarise never will.
- **Keep it short.** The output is going into a Slack message or a ticket
  description, not a report.
- **Do not let it close the loop.** The summary is a starting point for whoever
  picks the failure up, not a verdict.

## Feeding it into a ticket

Chain the summary into Jira rather than Slack, or into both:

```text
                                    ┌──sequential──▶ Slack  (#qa-alerts)
Playwright ──failure──▶ OpenAI ─────┤
                                    └──sequential──▶ Jira   (create bug)
```

Both downstream nodes read the same AI output, so the ticket description and
the Slack message stay consistent.

## Cost and privacy, briefly

The AI node calls an external API with whatever context you give it. Two things
worth deciding deliberately:

- **What leaves your environment.** Test names and error messages can contain
  application detail. Hugging Face Inference Providers may suit teams with
  stricter constraints.
- **When it runs.** A failure edge means the model is only called when
  something actually broke, which keeps cost proportional to failures rather
  than to runs.

## Next steps

- [OpenAI integration reference](/docs/integration-packages/openai/)
- [Hugging Face integration reference](/docs/integration-packages/huggingface/)
- [Create Jira bugs from failed tests](/docs/use-cases/create-jira-bugs-from-failed-playwright-tests/)
