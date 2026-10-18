---
sidebar_position: 4
sidebar_label: Standalone server
title: Run the standalone Playrunner MCP server
description: Connect an MCP client to a local or self-hosted Playrunner installation using the standalone HTTP server and a scoped API token.
---

# Run the standalone Playrunner MCP server

The repository includes a standalone MCP server in `apps/mcp`. It connects an
AI assistant to an existing Playrunner installation's machine API. It provides
tools for discovering, authoring and executing workflows, then reading their
test evidence.
GitHub setup and profile management are available through the broader
[Cloud MCP interface](./index.md).

## Start the server

First, start your Playrunner installation using the
[local setup guide](../tutorials/01-getting-started.md). With Node.js 20 or
later available, run these commands from the Playrunner repository root in a
separate terminal:

```bash
npm ci --prefix apps/mcp
PLAYRUNNER_API_URL=http://localhost:3011 MCP_PORT=3013 \
  npm start --prefix apps/mcp
```

| Variable             | Default                 | Purpose                         |
| -------------------- | ----------------------- | ------------------------------- |
| `PLAYRUNNER_API_URL` | `http://localhost:3011` | Base URL of the Playrunner API. |
| `MCP_PORT`           | `3013`                  | Port for the MCP server.        |

Set the API URL to your installation's public API entry point when using a
gateway, so its access and usage checks apply. Expose the MCP endpoint over
HTTPS when connecting from another machine. A hosted assistant cannot reach
`localhost` on your computer.

The MCP URL is `http://localhost:3013/mcp`. Check that the server is running:

```bash
curl --fail http://localhost:3013/health
```

The health endpoint returns `OK`; it does not verify your API token or workflow
access.

## Connect with an API token

1. Open **Settings → API tokens** in your Playrunner installation.
2. Create a token restricted to the workflows the assistant should run. For
   project listing, workflow authoring or deletion, use an unrestricted token
   with `workflow:write`. Restricted execution keys cannot manage resources.
3. Add your MCP URL to a client supporting remote Streamable HTTP and bearer
   authentication.
4. Store the token in the client's protected credential settings. The client
   must send `Authorization: Bearer YOUR_API_TOKEN` on every request.
5. Ask the assistant to list workflows to verify API access.

The server forwards each caller's token to the API, which enforces scope and
workflow restrictions. Revoking the token removes that token's access. Keep
tokens out of source control and chat messages.

## Tools

| Tool                   | Required inputs                                           | Optional inputs                                                                            | Purpose                                                                                                          |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `list_workflows`       | None                                                      | `limit`                                                                                    | Discover workflows this token may run.                                                                           |
| `run_workflow`         | `workflowId`                                              | `inputs`, `idempotencyKey`, `acceptanceCriteria`, `changeContext`, `regression`, `release` | Start a saved workflow and return an execution ID immediately.                                                   |
| `get_run_status`       | `workflowId`, `executionId`                               | None                                                                                       | Read the current status of one execution.                                                                        |
| `list_runs`            | `workflowId`                                              | `limit`                                                                                    | List recent runs, newest first.                                                                                  |
| `get_authoring_guide`  | None                                                      | None                                                                                       | Read saved regression mappings, immutable run requests and feedback conventions before authoring.                |
| `open_workflow_editor` | `workflowId`                                              | None                                                                                       | Open the saved graph in clients supporting the workflow editor. Requires management access.                      |
| `get_workflow_editor`  | `workflowId`                                              | None                                                                                       | Read the current saved graph through the editor integration. Requires management access.                         |
| `list_projects`        | None                                                      | `limit`                                                                                    | List owned projects and workflow counts. Requires a management key.                                              |
| `save_workflow`        | `definition`                                              | None                                                                                       | Save a project and workflow by stable keys. Requires a management key.                                           |
| `delete_workflow`      | `workflowId`                                              | None                                                                                       | Delete an owned workflow after schedule cleanup. Rejects active executions.                                      |
| `delete_project`       | `projectId`                                               | None                                                                                       | Delete an owned empty project. Non-empty projects are rejected.                                                  |
| `get_run_events`       | `workflowId`, `executionId`                               | `after`                                                                                    | Read execution events using a cursor.                                                                            |
| `get_run_feedback`     | `workflowId`, `executionId`                               | `after`                                                                                    | Read compact progress, selected journeys, failure identities and authenticated report paths. Never starts a run. |
| `get_release_policy`   | `workflowId`                                              | None                                                                                       | Read saved release requirements and the policy hash for review.                                                  |
| `get_release_verdict`  | `workflowId`, `executionId`, `candidate`, `policyVersion` | `maxAgeSeconds`                                                                            | Evaluate evidence for an exact candidate and reviewed policy. Never starts or deploys a run.                     |

Deletion requires an unrestricted `workflow:write` key. Workflow deletion
retains historical execution records. Project deletion does not cascade into
workflows. The matching machine API endpoints are `DELETE /api/v1/workflows/:workflowId`
and `DELETE /api/v1/projects/:projectId`.

`save_workflow.definition` contains `project: { key, title }` and
`workflow: { key, title, nodes, connections }`, with optional workflow runner,
concurrency and test-plan settings. The API validates the graph and rejects
embedded secret values. Reusing the same keys updates the owned resources.

`get_run_events.after` is a non-negative integer string, defaulting to `"0"`.
`acceptanceCriteria` accepts text or a list of up to 20 strings. `changeContext`
accepts repository owner/name, commit SHAs, refs, event type and pull-request
number for CI runs; it cannot override workflow inputs.

`limit` defaults to 25 and accepts integers from 1 to 100. `inputs` is an
object of named workflow inputs. `idempotencyKey` is an optional string of up
to 200 characters: reuse it for a retry of the same intended run, and use a
fresh key for a new run.

The standalone `run_workflow` uses `idempotencyKey`, while Cloud uses the
required `requestKey`. Standalone `get_run_status` requires both workflow and
execution IDs; Cloud requires the execution ID and supports event pagination.

## Change-aware regression and agent feedback

Follow [Focused regression](../cli/focused-regression.md) to save source-to-journey
mappings on Playwright nodes, then pass a versioned `regression` request with
exact base/head commit SHAs to `run_workflow`. This requires an updated API,
orchestrator, Playwright runner and MCP server; a server connection alone does
not establish feature availability.

The call returns immediately. Continue other work and read `get_run_feedback`
for that execution, passing its `nextCursor` as `after` on subsequent reads.
Drain pages while `hasMore` is true. `after` is a non-negative integer string
and defaults to `"0"`.

Check the actual selected scope, full-suite fallback reasons, final failures,
expected failures and any incomplete or truncated evidence. The tool does not
compare a baseline test run or independently verify the deployed application
revision. A completed workflow or an empty failure list is not release approval.

`regression` cannot be combined with `changeContext` or `release`. Use a fresh
`idempotencyKey` for each intended run and reuse it only to recover an ambiguous
start response for that same run. Once the execution ID is known, inspect it
instead of launching another execution.

## Troubleshooting

| Symptom                             | What to check                                                    |
| ----------------------------------- | ---------------------------------------------------------------- |
| `401 Unauthorized`                  | Supply a valid bearer token on every request.                    |
| Workflow is missing or inaccessible | Check token ownership, scope, and allowed workflows.             |
| Connection refused                  | Check `MCP_PORT`, the server process, and client network access. |
| MCP connects but tools fail         | Check `PLAYRUNNER_API_URL` and that the API is running.          |
| Rate or usage limit error           | Address the API's reported limit before starting another run.    |
| Authoring tools are absent          | Update the standalone MCP server to the current release.         |

The server supports MCP protocol versions `2025-06-18` and `2025-03-26`
over stateless Streamable HTTP at `POST /mcp`.
