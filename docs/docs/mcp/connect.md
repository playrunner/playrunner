---
sidebar_position: 2
sidebar_label: Connect an assistant
title: Connect an AI assistant to Playrunner Cloud
description: Set up the hosted Playrunner MCP connection with OAuth and start using your Cloud workflows from an AI assistant.
---

# Connect an AI assistant to Playrunner Cloud

## Add the hosted server

In your assistant's MCP settings, add a remote server with these values. The
exact field names depend on the client.

| Setting        | Value                          |
| -------------- | ------------------------------ |
| Name           | `Playrunner`                   |
| Server URL     | `https://playrunner.cloud/mcp` |
| Transport      | Streamable HTTP                |
| Authentication | OAuth through Playrunner Cloud |

1. Start the client's connection or authorization flow.
2. Sign in to Playrunner Cloud, or create an account, in the browser page it opens.
3. Review and approve the requested access.
4. Return to the assistant and ask it to check your Playrunner account.
5. Complete any account setup through the returned browser link, then ask the
   assistant to check again.

The assistant should call `get_account` first. Once setup is complete, ask it
to list your projects and workflows to confirm that the connection works.

Cloud MCP uses the browser authorization flow. A machine API token from
**Settings → API tokens** is for the [CLI](../cli/index.md) or
[standalone MCP server](./self-hosted.md); it does not replace Cloud OAuth.

## Access permissions

| Permission                | Allows the assistant to                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| `playrunner:read`         | Inspect account and resource metadata, workflows, and execution results.          |
| `playrunner:write`        | Create projects and create or update environments, profiles, and workflow graphs. |
| `playrunner:run`          | Start saved Cloud workflows using your account allowance.                         |
| `playrunner:authenticate` | Request browser sign-in on a paired companion device.                             |

If a tool reports a missing permission, reconnect through the client's
authorization flow and review the requested access. Shared workflows may be
read-only; workflow editing requires ownership.

## Connect GitHub

Ask the assistant to connect GitHub. The `connect_github` tool returns a
Playrunner browser page where you authorize GitHub and select repositories.
Afterward, the assistant can list accessible repositories and branches to
configure a workflow. Playrunner Cloud provides the GitHub connection flow.

## Tests that need a browser sign-in

An Authentication Profile describes the sign-in page and the condition that
confirms a successful login. Creating a profile does not capture a session.

1. [Pair the CLI authentication companion](../cli/authentication-companion.md)
   on the computer where you will sign in, and keep it connected.
2. Ask the assistant to list your companion devices and Authentication Profiles.
3. Ask it to authenticate the intended profile on the online device.
4. Complete sign-in and any MFA in the browser, then follow the companion's
   prompt to finish capture.
5. The assistant checks the authentication session and profile readiness before
   running the workflow.

Enter passwords and MFA codes in the browser. Enter environment secrets in
Playrunner Cloud's environment settings. MCP environment configuration accepts
non-secret variables and preserves existing secret variables; profile tools
return readiness metadata without exposing cookies or browser storage.

## Troubleshooting

| Symptom                                           | What to check                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| The client only offers a local command or SSE URL | Use a client with remote Streamable HTTP and OAuth support.                              |
| The connection asks you to sign in again          | Reconnect your Cloud account through the client's authorization flow.                    |
| Account setup is incomplete                       | Open the setup URL returned by `get_account`, complete setup, then retry.                |
| A tool asks for an additional permission          | Reauthorize with the scope named in the error.                                           |
| A workflow will not start                         | Check account allowance, access, and that the workflow uses the Playrunner Cloud runner. |
| No device is online for authentication            | Start the paired companion on the computer where the browser will open.                  |
| Opening `/mcp` in a browser shows an error        | It is a protocol endpoint. Add it through an MCP client to authorize and call tools.     |

See [Cloud tools](./tools.md) for the discovery, authoring, and execution sequence.
