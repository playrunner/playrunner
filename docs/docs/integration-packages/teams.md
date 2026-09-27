---
sidebar_position: 5
sidebar_label: Microsoft Teams
title: Microsoft Teams Integration
description: Connect a work or school Teams account and send channel messages from Playrunner workflows.
---

# Microsoft Teams Integration

Use the Microsoft Teams action node to send a plain-text message to a team
channel. Messages support Playrunner workflow and environment variables and
are sent on behalf of the connected Microsoft account.

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
`http://localhost:3100/oauth/callback/teams`. For a hosted deployment, use the
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

## Configure a workflow node

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

## Package reference

`@playrunner/teams` lives at `packages/teams`. It currently uses local `file:`
dependencies in consuming apps; an npm release is a separate publication step.
The package declares frontend, API, and orchestrator contributions. Include it
as a direct production dependency in each consuming app and rebuild those apps
when the package changes. Workflows use the bundled code; they do not install
packages at runtime.

| Surface      | Entrypoint                       | Responsibility                                                                  |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------- |
| Frontend     | `@playrunner/teams`              | `teams` action node, connection dialog, and team/channel/message configuration. |
| API          | `@playrunner/teams/api`          | OAuth exchange, token refresh, and discovery under `/api/microsoft-teams`.      |
| Orchestrator | `@playrunner/teams/orchestrator` | Render templates and send the channel message through Microsoft Graph.          |

The API provides `POST /oauth-token`, `GET /teams`, and
`GET /teams/:teamId/channels` beneath its mount path. It deliberately avoids
`/api/teams`, which belongs to Playrunner's own team-management API.

The executor posts a text message to Microsoft Graph's
`/v1.0/teams/{teamId}/channels/{channelId}/messages` endpoint. It respects workflow
cancellation, limits a request to 30 seconds, and reports sanitized errors
without including tokens or raw provider response bodies.

See [integration development](../local-dev/integrations/index.md) for the shared
package contracts and host responsibilities.
