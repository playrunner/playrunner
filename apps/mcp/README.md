# @playrunner/mcp

A Model Context Protocol server for Playrunner. It lets an AI agent discover
workflows, start runs, and read results from any MCP host.

## What it is

A thin protocol wrapper. It owns no data, no database access and no auth of its
own — every tool call becomes a request to the Playrunner machine API carrying
the caller's own API token, and the API decides what that token may see. Run
metering, rate limiting, the `workflow:execute` scope check and per-token
`allowedWorkflowIds` all stay where they already live.

## Tools

| Tool             | Machine API endpoint                                |
| ---------------- | --------------------------------------------------- |
| `list_workflows` | `GET /api/v1/workflows`                             |
| `run_workflow`   | `POST /api/v1/workflows/:id/executions`             |
| `get_run_status` | `GET /api/v1/workflows/:id/executions/:executionId` |
| `list_runs`      | `GET /api/v1/workflows/:id/executions`              |

Creating and editing workflows is deliberately absent. An agent that can run
things is useful; an agent that can rewire them is a liability.

## Authentication

Hosts send `Authorization: Bearer pr_live_…` on every request — a Playrunner API
token, created under **API tokens** in the app. There is no session: the header
is required on each call and forwarded unchanged. A request without one gets a
`401` with `WWW-Authenticate: Bearer`.

Scope a token to the workflows an agent should reach (`allowedWorkflowIds`) and
revoke it to cut access off.

## Configuration

| Variable             | Default                 | Purpose                        |
| -------------------- | ----------------------- | ------------------------------ |
| `MCP_PORT`           | `3013`                  | Port this server listens on    |
| `PLAYRUNNER_API_URL` | `http://localhost:3011` | Base URL of the Playrunner API |

`PLAYRUNNER_API_URL` must be the **public** API URL in a cloud deployment. Run
metering lives in the gateway that fronts the API, so pointing this at an
internal address would start runs that are never counted against the account's
quota.

## Running it

```bash
npm install
npm start
```

The endpoint is `POST /mcp`. `GET /health` returns `OK`.

## Adding it to an MCP host

Add `https://<your-host>/mcp` as a remote MCP server and paste an API token as
the bearer token. The server is stateless Streamable HTTP and speaks MCP
`2025-06-18`, falling back to `2025-03-26`. Hosts that probe with a newer
discovery method first will get `MethodNotFound` and fall back to `initialize`,
which is the intended path.
