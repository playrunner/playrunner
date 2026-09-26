---
sidebar_position: 1
sidebar_label: Overview
title: Playrunner MCP
description: Connect AI assistants to Playrunner through the Model Context Protocol to create workflows, run Playwright tests, and inspect results.
keywords: ['playrunner mcp', 'playwright mcp', 'ai test automation']
---

# Playrunner MCP

Playrunner's Model Context Protocol (MCP) interface lets an AI assistant work
with your testing workflows from a conversation. Connect your Playrunner Cloud
account to discover projects, build workflows, run Playwright tests, and inspect
execution results.

For example, ask your connected assistant:

```text
Show my Playrunner workflows and the latest run of my checkout smoke tests.
```

```text
Create a workflow for my staging checkout tests using my connected GitHub
repository. Reuse my staging environment and Authentication Profile.
```

```text
Run my checkout smoke workflow once, wait for it to finish, and report the
actual test results with any report links returned by Playrunner.
```

## Choose your connection

| Connection                            | Authentication                    | Capabilities                                                                                           |
| ------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Playrunner Cloud](./connect.md)      | Browser sign-in and OAuth consent | Manage projects, environments, profiles and workflows; connect GitHub; run workflows and read results. |
| [Standalone server](./self-hosted.md) | Playrunner API token              | Discover and run saved workflows, read status, and list recent runs on your installation.              |

The Cloud endpoint is `https://playrunner.cloud/mcp`. Use a client that supports
remote MCP over Streamable HTTP with OAuth. The standalone server has a smaller
tool set and uses bearer tokens; follow its separate setup guide.

## What happens when you run a workflow?

The assistant discovers the saved workflow, starts an execution, and checks its
status until it finishes. Playrunner runs the workflow on its configured
infrastructure. Cloud runs consume your account's workflow-run allowance.

The assistant should use the returned execution ID to check progress. A run
being accepted, or even a workflow completing, does not by itself prove that
the tests passed: inspect the returned test events and reports.

## MCP and the CLI

MCP exposes tools to an AI assistant. The [CLI](../cli/index.md) provides
terminal commands for workflow execution, workflow definitions, and the local
browser authentication companion.

Cloud MCP operations do not require a local CLI installation. If your tests
need a signed-in browser session, the companion captures that session on your
computer for an [Authentication Profile](../tutorials/06-authentication-profiles.md).
See [Connect an assistant](./connect.md) for the complete flow and
[Cloud tools](./tools.md) for the available operations.
