---
sidebar_position: 5.5
sidebar_label: Microsoft Teams
title: Microsoft Teams Integration
description: Connect a work or school Teams account and send channel messages from Playrunner workflows.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="Microsoft Teams"
packageName="@playrunner/microsoft-teams"
description="Send templated channel notifications from Playrunner workflows using a connected work or school account."
icon="microsoft-teams"
installCommand="npm install @playrunner/microsoft-teams"
npmUrl="https://www.npmjs.com/package/@playrunner/microsoft-teams"
badges={['Action node', 'OAuth', 'Channel messages']}
facts={[
{ label: 'Node type', value: 'Action' },
{ label: 'Auth path', value: 'users/{uid}/integrations/microsoft-teams' },
{ label: 'Backend mount', value: '/api/microsoft-teams' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Reference package UI">
    Exports `teamsIntegration`, `TeamsConfigPanel`, and `TeamsSettingsModal` for
    the canvas node, settings flow, and node configuration panel.
  </IntegrationCard>

  <IntegrationCard eyebrow="Backend" title="OAuth and channel routes">
    Exports `teamsRouter`, mounted at `/api/microsoft-teams`, for OAuth token
    exchange, token refresh, and team and channel discovery.
  </IntegrationCard>

  <IntegrationCard eyebrow="Orchestrator" title="Package-owned execution">
    Exports `teamsOrchestratorContribution` with the channel-message executor
    used by local and GCP workflow runs.
  </IntegrationCard>

  <IntegrationCard eyebrow="SDK usage" title="Host services only">
    Teams uses SDK UI helpers and reads Playrunner host services through
    `useIntegrationHost`, keeping package code decoupled from app internals.
  </IntegrationCard>

  <IntegrationCard eyebrow="Assets" title="Package-owned icon">
    The Teams SVG lives inside the package and is resolved by the frontend
    entrypoint.
  </IntegrationCard>
</IntegrationGrid>

:::important[Build-time installation only]

The install command is for building a Playrunner deployment. Add
`@playrunner/microsoft-teams` as a direct production dependency of the frontend,
API, and orchestrator. Each app discovers the package's declared surfaces at
build time. A running workflow never downloads or installs the package.

Connecting an account and configuring a Teams node use code already bundled
into Playrunner. Adding or upgrading the package requires rebuilding and
redeploying the affected apps and orchestrator image.

:::

## Setup

:::important[Work or school account required]

This integration requires an organizational Microsoft Teams account and an
Entra app registration. **Personal Teams Free accounts are not supported.**
Microsoft Graph does not support personal Microsoft accounts for the
[channel-message API](https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0).
Enabling personal accounts on an app registration does not remove that limitation.

:::

Before connecting, make sure you can use Teams in your organization's tenant,
belong to the destination team, and have permission to post in its channel.
You also need permission to register an Entra application, or help from your
organization's administrator. The integration uses Microsoft's public cloud
endpoints; sovereign-cloud endpoints are not configurable through this setup.

### 1. Copy the Playrunner redirect URL

In Playrunner, open **Integrations**, find **Microsoft Teams**, and choose
**Connect**. Copy the **Web redirect URL** displayed in the dialog.

For local development it normally looks like
`http://localhost:3100/oauth/callback/microsoft-teams`. For a hosted deployment, use the
HTTPS URL shown by that deployment. Copy it exactly, including the host, port,
and callback path; `localhost` and `127.0.0.1` are different hosts.

### 2. Register an Entra application

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) and
   select the organization that owns your Teams account.
2. Open **Entra ID → App registrations → New registration**.
3. Give the application a recognizable name, such as **Playrunner Teams**.
4. Select the single-tenant account option for your organization, then register
   the application.
5. From its overview, copy **Application (client) ID** and **Directory (tenant)
   ID** for the Playrunner connection form.
6. Under **Authentication**, add a **Web** platform and register the redirect
   URL copied from Playrunner. Use Web, because the Playrunner API exchanges
   the authorization code with a client secret.

Microsoft's references provide additional details about
[app registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
and [redirect URIs](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri).

### 3. Add delegated permissions

Under **API permissions → Add a permission → Microsoft Graph → Delegated
permissions**, add:

| Permission              | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `Team.ReadBasic.All`    | List teams the connected account has joined. |
| `Channel.ReadBasic.All` | List accessible channels in a selected team. |
| `ChannelMessage.Send`   | Send channel messages as the connected user. |
| `offline_access`        | Allow Playrunner to refresh the connection.  |

These are delegated permissions, not application permissions. Playrunner
requests these scopes during sign-in. If your organization's consent policy
requires administrator approval, have an administrator approve the permissions
before connecting.

### 4. Create a client secret

Under **Certificates & secrets → Client secrets → New client secret**, create
a secret and copy its **Value** immediately. The Secret ID is not the value
Playrunner needs. Record its expiry so you can rotate it before it expires.

See Microsoft's [app credentials guide](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials)
for the provider-side steps. Enter the value only in the Playrunner connection
dialog, not in a workflow message or node configuration.

### 5. Connect in Playrunner

1. Return to the Microsoft Teams connection dialog.
2. Enter the **Tenant ID or domain**, **Application ID**, and **Client secret**
   from your app registration.
3. Select **Connect Microsoft Teams**. Allow popups if your browser blocks the
   Microsoft sign-in window.
4. Sign in with your work or school account in the selected organization and
   approve the requested permissions.
5. Wait for **Microsoft Teams Connected Successfully**, then close the dialog.

Playrunner exchanges the code on the API server and stores the credentials
encrypted. Access and refresh tokens are not returned to the browser. The API
refreshes access tokens when needed for resource discovery or workflow credential
preparation. Use **Change Credentials** to reconnect after rotating a secret,
or **Disconnect** to remove the saved Playrunner connection.

## Exports

```ts
import teamsIntegration, {
  TeamsConfigPanel,
  TeamsSettingsModal,
} from '@playrunner/microsoft-teams';
import teamsApiContribution, {
  teamsRouter,
} from '@playrunner/microsoft-teams/api';
import teamsOrchestratorContribution from '@playrunner/microsoft-teams/orchestrator';
```

The default exports are the build-composition contract. The same contribution
objects are also available as named exports.

## Frontend

The frontend contribution registers the `microsoft-teams` action node, connection dialog,
and configuration panel. It uses the package-owned SVG and shared SDK host
services. No provider-specific edit to the host registry is needed.

## API

The API contribution mounts `teamsRouter` at `/api/microsoft-teams` and registers
`refreshTeamsCredentials` for workflow credential preparation.

The API provides `POST /oauth-token`, `GET /teams`, and
`GET /teams/:teamId/channels` beneath its mount path. It deliberately avoids
`/api/teams`, which belongs to Playrunner's own team-management API.

## Action node configuration

1. Open your workflow in the canvas and add **Microsoft Teams** from the node
   picker.
2. Open the node's configuration and select a **Team**, then a **Channel**.
3. Enter a **Message**, then save the workflow. Changing the team clears the
   selected channel, so choose a channel again after changing teams.
4. Connect the node at the point where the workflow should send the notification.
   Running that path sends a real message to the selected channel.

| Field       | Saved key   | Behavior                                                     |
| ----------- | ----------- | ------------------------------------------------------------ |
| **Team**    | `teamId`    | Required; lists teams the connected account directly joined. |
| **Channel** | `channelId` | Required; lists accessible channels in the selected team.    |
| **Message** | `message`   | Required; plain text with shared template variables.         |

For example, enter this message:

```text
Workflow {{workflow.definition.name}} finished with {{workflow.run.status}}.
```

The message reflects the workflow state when the node executes. The integration
sends a new channel message; it does not send direct chats, threaded replies,
attachments, or adaptive cards. Successful execution returns a `messageId` in
the node output.

## Orchestrator

The `teamsOrchestratorContribution` registers the default executor for `microsoft-teams`
workflow nodes. The executor posts a text message to Microsoft Graph's
`/v1.0/teams/{teamId}/channels/{channelId}/messages` endpoint. It respects workflow
cancellation, limits a request to 30 seconds, and reports sanitized errors
without including tokens or raw provider response bodies.

See [integration development](../local-dev/integrations/index.md) for the shared
package contracts and host responsibilities.

## Troubleshooting

| Symptom                                   | What to check                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal account cannot connect           | Use an organizational work or school Teams account. Personal Teams Free is unsupported.                                                              |
| Sign-in fails or the redirect is rejected | Match the dialog's redirect URL exactly in the app's Web platform. Check the tenant, application ID, and secret value.                               |
| Administrator approval required           | Ask your tenant administrator to approve the requested delegated permissions.                                                                        |
| Popup cancelled or timed out              | Allow popups and complete the Microsoft sign-in before the five-minute connection timeout.                                                           |
| No joined teams found                     | Verify the signed-in account is a direct member of a team. Access only to another team's shared channel does not make that team appear in this list. |
| Channel missing                           | Check channel membership, particularly for private or shared channels, then reopen the config panel.                                                 |
| Unable to load your Teams connection      | Check that the Playrunner API is running and reachable, then reopen the connection dialog.                                                           |
| Unable to load teams or channels          | Check the saved connection and delegated read permissions. Reconnect if consent or credentials changed.                                              |
| HTTP 401 or refresh fails                 | Reconnect with a valid client secret; consent or refresh access may have expired or been revoked.                                                    |
| HTTP 403 when sending                     | Check channel membership, permission to post, and `ChannelMessage.Send` consent.                                                                     |
| HTTP 429 when sending                     | Microsoft Graph is rate limiting requests. Wait before retrying; the executor does not automatically retry.                                          |

The provider references describe which resources are returned by
[joined teams](https://learn.microsoft.com/en-us/graph/api/user-list-joinedteams?view=graph-rest-1.0)
and [channel discovery](https://learn.microsoft.com/en-us/graph/api/channel-list?view=graph-rest-1.0).

## Assets

The Teams logo is exported from `@playrunner/microsoft-teams/assets/microsoft-teams.svg` and resolved
by the frontend entrypoint. The documentation reuses the same package-owned SVG.
