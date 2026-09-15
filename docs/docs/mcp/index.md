---
sidebar_position: 1
sidebar_label: MCP server
title: Playrunner MCP server
description: Connect an AI agent to Playrunner over the Model Context Protocol to discover, run, and inspect Playwright workflows from any MCP host.
keywords:
  [
    'playrunner mcp',
    'mcp server',
    'model context protocol',
    'playwright mcp',
    'ai agent testing',
  ]
---

# Playrunner MCP server

Playrunner Cloud speaks the [Model Context Protocol](https://modelcontextprotocol.io), so an AI agent can discover your workflows, start a run, and read the result — without leaving whatever tool you already work in.

Ask an agent to _"run the regression suite against staging"_ and it runs, shards, and reports back.

## The endpoint

```
https://playrunner.cloud/mcp
```

One URL, every host. It is a remote server over streamable HTTP, so nothing is installed locally.

## Authorisation

The server uses OAuth 2.1 with PKCE and supports dynamic client registration, which means most hosts need nothing but the URL. Your agent registers itself, sends you to Playrunner to approve, and stores its own token.

You approve a named set of permissions and can revoke them at any time from your Playrunner Cloud account. An agent only ever sees the projects and workflows your account owns.

## Add it to a host

### Claude Code

```bash
claude mcp add --transport http playrunner https://playrunner.cloud/mcp
```

Then run `/mcp` and authorise when prompted.

### Codex

Playrunner is packaged as a Codex plugin. Install it from the Codex plugin
directory, then ask Codex to work with Playrunner — it handles the connection
and browser sign-in itself. You do not need an API token or any manual MCP
configuration.

The plugin also carries a skill covering workflow authoring, GitHub connection,
and the local browser authentication companion used for Authentication
Profiles.

:::note
The plugin listing is still in review. Until it is published, add
`https://playrunner.cloud/mcp` to Codex as a remote MCP server and authorise it
in the browser — the same tools are available either way.
:::

### VS Code

Add the server with **MCP: Add Server** from the command palette, or commit a
`.vscode/mcp.json` so the whole team picks it up:

```json
{
  "servers": {
    "playrunner": {
      "type": "http",
      "url": "https://playrunner.cloud/mcp"
    }
  }
}
```

Copilot prompts you to authorise in the browser the first time it connects.

### Kody

1. Open [`/account/mcp-servers`](https://kody.codes/account/mcp-servers) and choose **Add any remote MCP server**.
2. Set the **Server name** to `playrunner` and the **Server URL** to `https://playrunner.cloud/mcp`.
3. Kody returns an authorisation link. Open it, sign in to Playrunner Cloud, and approve.
4. The tools appear as `kody.mcp["playrunner"].list_workflows(...)`.

The name must be lowercase kebab-case — Kody uses it as the accessor in code.

### Other hosts

Anything that accepts a remote MCP server takes the same URL. Where a host asks for a transport, choose **streamable HTTP**.

## What an agent can do

| Area                | Tools                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery           | `get_account`, `list_projects`, `list_workflows`, `get_workflow`, `get_authoring_guide`                                                       |
| Authoring           | `create_project`, `save_workflow`, `list_environments`, `configure_environment`                                                               |
| Running             | `run_workflow`, `get_run_status`, `list_runs`                                                                                                 |
| Repositories        | `connect_github`, `list_github_repositories`, `list_github_branches`, `list_integrations`                                                     |
| Authenticated tests | `list_authentication_profiles`, `save_authentication_profile`, `authenticate_profile`, `get_authentication_session`, `list_companion_devices` |

`run_workflow` returns a run id immediately rather than waiting, so an agent starts a suite and polls `get_run_status` for the outcome.

## Limits worth knowing

Runs started through MCP consume the same workflow-run allowance as any other trigger, and the same per-minute request limits apply. Repeated calls carrying the same idempotency key return the original run instead of starting a second one.

## Scoping access

Give an agent less than your whole account where that matters:

- Kody can lock a server to specific packages, so ad hoc code cannot call it.
- Revoke an agent's access from your Playrunner Cloud account whenever you want. Nothing else is affected.

## Related

- [Playrunner CLI](../cli/index.md) — the same operations from a terminal or CI
- [Webhooks](../integration-packages/webhooks.md) — trigger a workflow over plain HTTP
