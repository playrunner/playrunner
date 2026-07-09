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

  <IntegrationCard eyebrow="SDK usage" title="Host services only">
    Slack uses SDK UI helpers and reads Playrunner host services through
    `useIntegrationHost`, keeping package code decoupled from app internals.
  </IntegrationCard>

  <IntegrationCard eyebrow="Assets" title="Package-owned icon">
    The Slack SVG lives inside the package and is resolved by the frontend
    entrypoint.
  </IntegrationCard>
</IntegrationGrid>

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
import {
  slackIntegration,
  SlackConfigPanel,
  SlackSettingsModal,
} from "@playrunner/slack";
import { slackRouter } from "@playrunner/slack/api";
```

## Frontend

The frontend entrypoint exports `slackIntegration`, which includes the integration metadata, SVG icon URL, settings modal, and node config panel. Slack uses SDK UI helpers and reads Playrunner host services through `useIntegrationHost`.

## API

The API entrypoint exports `slackRouter`, mounted by the host API at `/api/slack`.

The router owns:

- `POST /oauth-token` — Exchange an OAuth code for a bot access token
- `GET /channels` — List Slack channels visible to the bot

## Action node configuration

When a Slack action node is added to the workflow canvas, the config panel offers:

| Field | Description |
|-------|-------------|
| **Channel** | Slack channel to post to (OAuth mode — fetched from the API). In webhook mode, messages go to the channel configured in Slack. |
| **Message** | Message body, supporting `{{workflow.definition.name}}`, `{{workflow.run.status}}`, `{{workflow.run.failedNode.name}}`, and other shared workflow variables. |
| **Bot Username** | Optional override for the bot display name. |

## Runtime behavior

During workflow execution (local, scheduled, or GCP runner), the orchestrator:

1. Reads the Slack integration settings from the workflow's stored credentials.
2. Resolves `{{workflow.*}}` template variables in the message body.
3. If **webhook mode**: sends a `POST` to the stored webhook URL with the rendered message.
4. If **OAuth mode**: calls `chat.postMessage` with the bot token and selected channel ID.
5. Logs success or failure to run logs without leaking tokens, webhook URLs, or workspace IDs.

## Failure modes

| Failure | Logged message | Node state |
|---------|---------------|------------|
| No credentials configured | `Slack credentials missing. Cannot send message.` | `error` |
| No channel selected (OAuth mode) | `No Slack channel configured.` | `error` |
| Webhook HTTP error | `Slack webhook returned {status}: {body}` | `error` |
| Slack API error | `Slack API error: {error}` | `error` |

Credentials, webhook URLs, and tokens are never included in user-visible log messages.

## Assets

The Slack SVG lives inside the package at `packages/slack/assets/slack.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
