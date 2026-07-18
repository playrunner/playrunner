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

  <IntegrationCard eyebrow="Orchestrator" title="Package-owned execution">
    Exports `jiraOrchestratorContribution` with the bundled create and update
    executors used by local and GCP workflow runs.
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

:::important Build-time installation only

The install command on this page is for building a Playrunner deployment. Jira
declares its frontend, API, and Orchestrator surfaces in its own package
manifest. The package must be a direct production dependency of each app that
uses one of those surfaces. The app build discovers that package-owned metadata
and generates static imports. A running workflow never downloads, installs, or
discovers the package.

At runtime, a user can connect Jira, add a Jira node to a workflow, select an
action, and configure its fields because that code is already bundled. Adding,
removing, or upgrading the package requires rebuilding and redeploying the
affected Playrunner apps and orchestrator image.

:::

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
import jiraIntegration, {
  JiraConfigPanel,
  JiraSettingsModal,
} from '@playrunner/jira';
import jiraApiContribution, { jiraRouter } from '@playrunner/jira/api';
import jiraOrchestratorContribution from '@playrunner/jira/orchestrator';
```

The same objects remain available as named exports. The default exports are the
build-composition contract.

## Frontend

The frontend entrypoint default-exports `jiraIntegration`, which includes the
integration metadata, SVG icon URL, settings modal, and node config panel. Jira
uses SDK UI helpers and reads Playrunner host services through
`useIntegrationHost`. The frontend build finds the declared `.` surface while
scanning its installed direct production dependencies; no shared registry edit
is required.

## API

The API entrypoint default-exports `jiraApiContribution`, which contains the
stable ID, `/api/jira` mount path, and `jiraRouter`. The API build discovers and
registers it from Jira's package metadata.

The router owns:

- `POST /token`
- `POST /refresh`
- `GET /projects`

## Orchestrator

The `@playrunner/jira/orchestrator` subpath default-exports
`jiraOrchestratorContribution`. Jira's own manifest declares that entrypoint.
When Jira is an installed direct production dependency, the Orchestrator build
generates a static import and bundles the Jira executor into `dist/index.js`.
The Orchestrator's host-owned registry only validates and resolves the resulting
contributions; it contains no Jira reference. There is no runtime package
loader, discovery scan, or package installation step.

See
[Orchestrator contributions](../local-dev/integrations/orchestrator-contributions.md)
for the shared contract, self-contained package checklist, and rebuild commands.

### Executor resolution

Jira registers two executors for persisted workflow nodes whose `nodeType` is
exactly `jira`:

| Persisted `config.action` | Executor                          |
| ------------------------- | --------------------------------- |
| Missing, `null`, or `""`  | `create` (the registered default) |
| `create`                  | `create` (exact action match)     |
| `update`                  | `update` (exact action match)     |

Any other non-empty action string requires an exact registered executor and
fails workflow preflight. Whitespace-only and non-string action values are
invalid. Resolution uses the persisted `nodeType` and never falls back to the
node's display label.

### Runtime behavior

The host selects the credential value stored at `settings.jira` and exposes that
scoped object to the executor as `context.settings`. The immutable execution
context also contains the current node, environment and workflow template data,
a log function, and an `AbortSignal`. It does not receive credentials for other
providers, event-publishing credentials, or host state mutation helpers.

For both actions, Jira renders template variables in `summary` and
`description`. The update action also renders `issueKey`. The executors then:

- use the scoped Jira `accessToken`;
- send create requests to Jira's issue endpoint and update requests to the
  selected issue key;
- pass the host `AbortSignal` to `fetch`, so stopping the matching execution and
  node cancels the in-flight provider request; and
- return only a success outcome to the host, which remains responsible for node
  state transitions and workflow events.

### Failure safety

Provider response bodies and access tokens are not included in execution
errors. Expected messages include:

| Failure                    | Logged message                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------- |
| No Jira access token       | `Jira credentials missing. Cannot execute Jira action.`                             |
| Project context missing    | `Jira Action failed: Missing cloudId in Jira node config. Please reselect project.` |
| Update issue key missing   | `Jira Action failed: Issue key is required for update action.`                      |
| Jira HTTP failure          | `Jira Action failed: Jira API returned <status>: request failed`                    |
| Unexpected request failure | `Jira Action failed: Jira request failed.`                                          |
| Host cancellation          | `Node executor was cancelled.`                                                      |

## Assets

The Jira SVG lives inside the package at `packages/jira/assets/jira.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
