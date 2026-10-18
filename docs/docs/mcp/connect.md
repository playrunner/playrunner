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

## Gemini CLI

Merge this entry into `mcpServers` in your user-level
`~/.gemini/settings.json`, preserving your other settings:

```json
{
  "mcpServers": {
    "playrunner": {
      "httpUrl": "https://playrunner.cloud/mcp",
      "oauth": {
        "enabled": true,
        "redirectUri": "http://127.0.0.1:7777/oauth/callback"
      }
    }
  }
}
```

Restart Gemini CLI, then enter `/mcp auth playrunner` in its interactive prompt.
Complete the browser sign-in and consent flow. Use `/mcp` to inspect the
connection, then ask the agent to call `get_account`.

The explicit callback uses an IP loopback address accepted by Playrunner Cloud;
Gemini CLI's default `localhost` callback is not accepted. If port `7777` is
busy, choose another unused port in `redirectUri`. Run authorization on a
computer with browser access. Tool confirmations remain enabled by default.

This setup is for **Gemini CLI**, not the consumer Gemini chat application.
See the official [Gemini CLI MCP guide](https://geminicli.com/docs/tools/mcp-server/)
for OAuth discovery and configuration options.

## Google Antigravity

In Antigravity IDE, open **MCP Servers → Manage MCP Servers → View raw config**.
Merge the following entry into the existing `mcpServers` object:

```json
{
  "mcpServers": {
    "playrunner": {
      "serverUrl": "https://playrunner.cloud/mcp"
    }
  }
}
```

Refresh the server list and use **Authenticate** for Playrunner in
**Agent Settings → Customizations**. Complete the browser authorization and
follow Antigravity's return-to-client instructions. Keep authorization codes in
that authentication flow, not in an agent conversation. Then ask the agent to
call `get_account`.

Antigravity documents remote Streamable HTTP and automatic OAuth with dynamic
client registration, which Playrunner Cloud provides. A manually configured
client secret or Google Application Default Credentials is not needed for this
connection. The exact settings location varies between Antigravity surfaces;
see Google's [Antigravity MCP guide](https://antigravity.google/docs/mcp).

### Connection verification

These Gemini CLI and Antigravity examples are based on their documented MCP
capabilities and Playrunner's Cloud protocol implementation. They have not yet
been verified through a complete sign-in and workflow run in those clients.
Confirm `get_account`, workflow discovery, and a test run before relying on a
new connection. MCP support alone does not guarantee every client version or
authentication flow is compatible.

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

## Run tests on your own compute

Connect a worker on your laptop, server or VM using
[Run Cloud tests on your own machine](../cli/local-workers.md). Then ask your
assistant to list local workers and run the saved workflow on the machine you
choose. Cloud keeps the execution history, logs and reports. The
[local execution tool sequence](./tools.md#run-on-a-connected-machine) requires
an explicit device choice and never falls back to hosted compute.

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
