---
sidebar_position: 3
sidebar_label: Cloud tools
title: Playrunner Cloud MCP tools
description: Reference for Playrunner Cloud MCP discovery, workflow authoring, authentication, and execution tools.
---

# Playrunner Cloud MCP tools

These tools are available through the [Cloud connection](./connect.md). Your
assistant reads each tool's input schema from the server. The standalone
server's [nine tools](./self-hosted.md#tools) have a separate contract.

## Account and discovery

| Tool                           | Purpose                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `get_account`                  | Check the connected account and onboarding status. Call first.                    |
| `list_projects`                | List your projects.                                                               |
| `list_environments`            | List environments and variable names; variable values are omitted.                |
| `list_authentication_profiles` | List profile metadata and readiness.                                              |
| `list_integrations`            | Inspect connected integrations with credential fields removed.                    |
| `list_workflows`               | Discover accessible workflows, including shared workflows that may be read-only.  |
| `get_workflow`                 | Read a saved workflow by `workflowId` before editing it.                          |
| `get_authoring_guide`          | Read graph conventions, current runner versions, and an example before authoring. |

## Authoring and GitHub

| Tool                          | Purpose                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `create_project`              | Create a project with a `title`.                                                                 |
| `configure_environment`       | Create or update an environment's name and non-secret variables. Omit `environmentId` to create. |
| `save_authentication_profile` | Create or edit profile settings. Omit `profileId` to create; capture sign-in separately.         |
| `save_workflow`               | Create or replace a workflow graph in an owned project. Omit `workflowId` to create.             |
| `connect_github`              | Get a browser link for GitHub authorization and repository selection.                            |
| `list_github_repositories`    | List repositories accessible through the connected GitHub account.                               |
| `list_github_branches`        | List branches for a `repository` in `owner/repository` form.                                     |

Before changing a workflow, read it with `get_workflow` and read
`get_authoring_guide`. `save_workflow` takes the graph's `title`, `projectId`,
`nodes`, and `connections`, plus optional `workflowId` and `concurrency`.
Preserve unrelated nodes and connections when replacing an existing graph.
Cloud MCP saves workflows with the Playrunner Cloud runner.

## Browser authentication

| Tool                         | Required inputs         | Purpose                                              |
| ---------------------------- | ----------------------- | ---------------------------------------------------- |
| `list_companion_devices`     | None                    | Find paired devices and their online status.         |
| `authenticate_profile`       | `profileId`, `deviceId` | Request sign-in in the browser on a specific device. |
| `get_authentication_session` | `sessionId`             | Check the capture request's status.                  |

Use the [authentication companion flow](./connect.md#tests-that-need-a-browser-sign-in)
to capture a session. Pairing a device alone does not make a profile ready.

## Execution and results

| Tool             | Required inputs            | Optional inputs             | Purpose                                                  |
| ---------------- | -------------------------- | --------------------------- | -------------------------------------------------------- |
| `run_workflow`   | `workflowId`, `requestKey` | None                        | Start the saved Cloud workflow.                          |
| `list_runs`      | `workflowId`               | `limit` (1–100, default 20) | List your recent executions of a workflow, newest first. |
| `get_run_status` | `executionId`              | `after`                     | Read execution status and up to 100 events.              |

A typical run uses this sequence:

1. Call `list_workflows` and select the intended workflow's actual ID.
2. Call `run_workflow` with a new UUID as `requestKey` for this intended run.
3. Keep the returned execution ID and poll `get_run_status`, leaving a few
   seconds between requests.
4. When `hasMore` is true, pass the returned `nextCursor` as `after` to read
   the next page of events.
5. Report the final workflow status and actual test evidence. Include test
   counts and artifact links only when present in the returned results.

For example, the arguments to start one run look like this. Replace the
workflow ID and generate a fresh UUID for each intended execution:

```json
{
  "workflowId": "YOUR_WORKFLOW_ID",
  "requestKey": "d0513c7a-8369-4f5b-9161-301f5705a919"
}
```

Reuse that `requestKey` only when retrying an ambiguous response for the same
run. After receiving an execution ID, inspect that execution instead of
starting another. Each intended run consumes Cloud workflow-run allowance.
Stopping a local wait does not cancel the Cloud workflow.
