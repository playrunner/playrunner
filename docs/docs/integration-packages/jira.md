---
sidebar_position: 2
sidebar_label: Jira
title: Jira Integration
description: Create and sync Jira tickets from Playrunner workflows.
hide_title: true
---

import {
  IntegrationCard,
  IntegrationGrid,
  IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
  name="Jira"
  packageName="@playrunner/jira"
  description="Create and sync Jira tickets from Playrunner workflows with OAuth-backed project access."
  icon="jira"
  installCommand="npm install @playrunner/jira"
  npmUrl="https://www.npmjs.com/package/@playrunner/jira"
  badges={['Action node', 'OAuth', 'Project sync']}
  facts={[
    { label: 'Node type', value: 'Action' },
    { label: 'Auth path', value: 'users/{uid}/integrations/jira' },
    { label: 'Backend mount', value: '/api/jira' },
  ]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Reference package UI">
    Exports `jiraIntegration`, `JiraConfigPanel`, and `JiraSettingsModal` for
    the canvas node, settings flow, and node configuration panel.
  </IntegrationCard>

  <IntegrationCard eyebrow="Backend" title="Token and project routes">
    Exports `jiraRouter`, mounted by the host API at `/api/jira`, for OAuth token
    exchange, token refresh, and project lookup.
  </IntegrationCard>

  <IntegrationCard eyebrow="SDK usage" title="Host services only">
    Jira uses SDK UI helpers and reads Playrunner host services through
    `useIntegrationHost`, keeping package code decoupled from app internals.
  </IntegrationCard>

  <IntegrationCard eyebrow="Assets" title="Package-owned icon">
    The Jira SVG lives inside the package and is resolved by the frontend
    entrypoint.
  </IntegrationCard>
</IntegrationGrid>

## Setup

Open Playrunner, go to **Integrations**, and open **Connect to Jira**. Copy the
callback URL shown in the dialog, then create the Atlassian OAuth integration:

1. Go to the
   [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/).
2. Click **Create** and select **OAuth 2.0 integration**.
3. Give the app a name, accept the terms, and click **Create**.
4. In the left menu, select **Permissions** and add the Jira API.
5. Grant the scopes `read:jira-work`, `write:jira-work`, and `offline_access`.
6. In the left menu, select **Authorization** and add the callback URL copied
   from Playrunner.
7. Go back to **Settings** and copy the **Client ID** and **Secret**.
8. Paste the client ID and secret into Playrunner and click **Authenticate**.

## Exports

```ts
import {
  jiraIntegration,
  JiraConfigPanel,
  JiraSettingsModal,
} from "@playrunner/jira";
import { jiraRouter } from "@playrunner/jira/api";
```

## Frontend

The frontend entrypoint exports `jiraIntegration`, which includes the integration metadata, SVG icon URL, settings modal, and node config panel. Jira uses SDK UI helpers and reads Playrunner host services through `useIntegrationHost`.

The host app registers Jira in `apps/frontend/src/integrations/registry.ts`.

## API

The API entrypoint exports `jiraRouter`, mounted by the host API at `/api/jira`.

The router owns:

- `POST /token`
- `POST /refresh`
- `GET /projects`

## Assets

The Jira SVG lives inside the package at `packages/jira/assets/jira.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
