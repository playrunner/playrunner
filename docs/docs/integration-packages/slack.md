---
sidebar_position: 8
sidebar_label: Slack
title: Slack Integration
description: Send notifications and alerts to Slack channels from Playrunner workflows.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="Slack"
packageName="@playrunner/slack"
description="Send notifications and alerts to Slack channels from Playrunner workflows using OAuth or incoming webhooks."
icon="slack"
installCommand="npm install @playrunner/slack"
npmUrl="https://www.npmjs.com/package/@playrunner/slack"
badges={['Action node', 'OAuth', 'Webhook']}
facts={[
{ label: 'Node type', value: 'Action' },
{ label: 'Auth path', value: 'users/{uid}/integrations/slack' },
{ label: 'Backend mount', value: '/api/slack' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Reference package UI">
    Exports `slackIntegration`, `SlackConfigPanel`, and `SlackSettingsModal` for
    the canvas node, settings flow, and node configuration panel.
  </IntegrationCard>

  <IntegrationCard eyebrow="Backend" title="OAuth and channel routes">
    Exports `slackRouter`, mounted by the host API at `/api/slack`, for OAuth
    token exchange and channel listing.
  </IntegrationCard>

  <IntegrationCard eyebrow="Orchestrator" title="Package-owned execution">
    Exports `slackOrchestratorContribution` with the bundled webhook and Bot API
    executor used by local and GCP workflow runs.
  </IntegrationCard>

  <IntegrationCard eyebrow="SDK usage" title="Host services only">
    Slack uses SDK UI helpers and reads Playrunner host services through
    `useIntegrationHost`, keeping package code decoupled from app internals.
  </IntegrationCard>

  <IntegrationCard eyebrow="Assets" title="Package-owned icon">
    The Slack SVG lives inside the package and is resolved by the frontend
    entrypoint.
  </IntegrationCard>
</IntegrationGrid>

:::important Build-time installation only

The install command on this page is for building a Playrunner deployment. Slack
declares its frontend, API, and Orchestrator surfaces in its own package
manifest. The package must be a direct production dependency of each app that
uses one of those surfaces. The app build discovers that package-owned metadata
and generates static imports. A running workflow never downloads, installs, or
discovers the package.

At runtime, a user can connect Slack, add a Slack node to a workflow, and
configure its channel and message because that code is already bundled. Adding,
removing, or upgrading the package requires rebuilding and redeploying the
affected Playrunner apps and orchestrator image.

:::

## Setup

Slack supports two authentication modes: **OAuth** (recommended) and **incoming webhooks** (simpler fallback).

### OAuth setup (recommended)

1. Go to the [Slack API Apps page](https://api.slack.com/apps) and click **Create New App** → **From scratch**.
2. Give the app a name and select your workspace.
3. In **OAuth & Permissions**, add these **Bot Token Scopes**:
   - `chat:write` — Send messages
   - `channels:read` — List public channels
   - `groups:read` — List private channels the bot is invited to
4. In **OAuth & Permissions** → **Redirect URLs**, add the callback URL shown in the Playrunner Slack settings modal (e.g. `http://localhost:3100/oauth/callback/slack`).
5. Go to **Basic Information** and copy the **Client ID** and **Client Secret**.
6. In Playrunner, go to **Integrations** → **Slack** → paste the Client ID and Secret → click **Authenticate**.
7. Authorize the app in the Slack popup. Once complete, Playrunner stores the bot token securely.
8. Invite the bot to the channels where you want to post messages (`/invite @YourBotName`).

### Incoming webhook setup

1. Go to the [Slack API Apps page](https://api.slack.com/apps) and create or select an app.
2. Enable **Incoming Webhooks** and create a webhook for the target channel.
3. Copy the webhook URL.
4. In Playrunner, go to **Integrations** → **Slack** → switch to **Incoming Webhook** tab → paste the URL → click **Save Webhook**.

## Exports

```ts
import slackIntegration, {
  SlackConfigPanel,
  SlackSettingsModal,
} from "@playrunner/slack";
import slackApiContribution, { slackRouter } from "@playrunner/slack/api";
import slackOrchestratorContribution from "@playrunner/slack/orchestrator";
```

The same objects remain available as named exports. The default exports are the
build-composition contract.

## Frontend

The frontend entrypoint default-exports `slackIntegration`, which includes the
integration metadata, SVG icon URL, settings modal, and node config panel. Slack
uses SDK UI helpers and reads Playrunner host services through
`useIntegrationHost`. The frontend build finds the declared `.` surface while
scanning its installed direct production dependencies; no shared registry edit
is required.

## API

The API entrypoint default-exports `slackApiContribution`, which contains the
stable ID, `/api/slack` mount path, and `slackRouter`. The API build discovers
and registers it from Slack's package metadata.

The router owns:

- `POST /oauth-token` — Exchange an OAuth code for a bot access token
- `GET /channels` — List Slack channels visible to the bot

## Action node configuration

When a Slack action node is added to the workflow canvas, the config panel offers:

| Field            | Description                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Channel**      | Slack channel to post to (OAuth mode — fetched from the API). In webhook mode, messages go to the channel configured in Slack.                               |
| **Message**      | Message body, supporting `{{workflow.definition.name}}`, `{{workflow.run.status}}`, `{{workflow.run.failedNode.name}}`, and other shared workflow variables. |
| **Bot Username** | Optional override for the bot display name.                                                                                                                  |

## Orchestrator

The `@playrunner/slack/orchestrator` subpath default-exports
`slackOrchestratorContribution`. Slack's own manifest declares that entrypoint.
When Slack is an installed direct production dependency, the Orchestrator build
generates a static import and bundles the Slack executor into `dist/index.js`.
`@playrunner/integration-registry/orchestrator` only validates and resolves the
resulting contributions; it contains no Slack reference. There is no runtime
package loader, discovery scan, or package installation step.

See [Orchestrator contributions](../orchestrator/) for the shared contract,
self-contained package checklist, and rebuild commands.

### Executor resolution

Slack registers one default executor for persisted workflow nodes whose
`nodeType` is exactly `slack`. It is selected only when `config.action` is
missing, `null`, or `""`. A non-empty action string requires an exact action
registration, so it fails workflow preflight instead of falling back to the
default executor. Whitespace-only and non-string action values are invalid.
Resolution never falls back to the node's display label.

### Runtime behavior

During workflow execution (local, scheduled, or GCP), the bundled Slack
executor:

1. Receives only the scoped `settings.slack` credential object rather than all
   provider credentials.
2. Renders supported template variables in the message and optional bot
   username. An empty message uses `Workflow completed.`.
3. If a webhook URL is configured, sends a `POST` to that URL. Webhook mode has
   priority if both credential types are present.
4. Otherwise, calls `chat.postMessage` with the scoped bot access token and
   configured channel ID.
5. Passes the host `AbortSignal` to `fetch`, so stopping the matching execution
   and node cancels the in-flight provider request.
6. Returns only a success outcome to the host, which remains responsible for
   node state transitions and workflow events.

The executor also receives immutable node, environment, and workflow snapshots,
a template renderer, and a log function. It does not receive credentials for
other providers, event-publishing credentials, or host state mutation helpers.

## Failure modes

| Failure                            | Logged message                                                                                    | Node state |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| No credentials configured          | `Slack credentials missing. Cannot send message.`                                                 | `error`    |
| No channel selected (Bot API mode) | `Slack action failed: No Slack channel configured. Please select a channel in the node settings.` | `error`    |
| Webhook HTTP error                 | `Slack action failed: Slack webhook returned <status>: request failed`                            | `error`    |
| Slack API error                    | `Slack action failed: Slack API error: <sanitized-code>`                                          | `error`    |
| Unexpected request failure         | `Slack action failed: Slack request failed.`                                                      | `error`    |
| Host cancellation                  | `Node executor was cancelled.`                                                                    | `error`    |

The Slack API error code is accepted only when it contains a short safe set of
letters, numbers, underscores, dots, or hyphens; otherwise it is reported as
`unknown`. Raw provider response bodies, credentials, webhook URLs, and tokens
are never included in user-visible execution errors.

## Assets

The Slack SVG lives inside the package at `packages/slack/assets/slack.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
