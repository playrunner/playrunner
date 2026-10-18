---
sidebar_position: 2.5
sidebar_label: Focused regression
title: Run change-aware regression tests
description: Map journeys to source and Playwright tests, compare immutable commits, and let an agent inspect asynchronous test feedback.
---

# Run change-aware regression tests

Give your agent a saved testing workflow, source-to-journey mappings, and the
commits being compared. Playrunner calculates the changed files, follows their
dependencies, and runs the mapped Playwright test files. Your agent can keep
working, read progress and failures, then act on the evidence.

When impact cannot be established safely, Playrunner widens the run to the full
configured suite. You can also request a full suite explicitly.

## Availability and prerequisites

This guide covers the updated upstream machine API and
[standalone MCP server](../mcp/self-hosted.md), plus the
[Cloud MCP contract](#use-playrunner-cloud-mcp) for hosted runs. Cloud requires
the corresponding server rollout: before using it, check that the connected
`run_workflow` schema includes `regression` and that `get_run_feedback` is
available. Publishing this guide or installing a client does not upgrade an
existing server.

The published `playrunner@0.3.0` CLI does **not** include `--regression` or
`feedback`. Until a release includes them, build the CLI from an upstream
checkout containing this feature. From the repository root, with Node.js 20
or later:

```bash
npm ci --prefix packages/cli
npm run build --prefix packages/cli
node packages/cli/dist/cli.js --help
node packages/cli/dist/cli.js feedback --help
```

The CLI examples below use that source build against a local or self-hosted
installation. Its help must list `--regression`
and `feedback`; a version number alone does not establish feature support.
Your API, orchestrator and Playwright runner must also include the change.
Updating only the CLI or MCP server is insufficient.

Prepare a saved workflow with GitHub-backed TypeScript Playwright tests, a
working target environment and any required Authentication Profile. Version 1
does not support inline tests, Python, sharding or AI Container steps for
regression execution. The GitHub connection must allow access to every
repository used for the comparison and dependency analysis.

Use `PLAYRUNNER_URL` for the intended installation and provide
`PLAYRUNNER_API_KEY` through a protected environment variable. A scoped
`workflow:execute` token can run and inspect allowed workflows; authoring
requires an unrestricted `workflow:write` token. Browser device pairing with
`playrunner login` does not replace the workflow API token.

## 1. Save the journey mappings

Read the existing workflow before editing it. Add `regression` to each relevant
Playwright node's saved `config`, preserving its repository, folder, environment,
Authentication Profile and other settings. Use the
[workflow definition format](./create-workflow.md) or standalone MCP
`get_authoring_guide`, `get_workflow_editor` and `save_workflow` tools. Preserve
unrelated nodes and connections when saving the graph.

The following is the `regression` portion of a node's configuration, not a
complete workflow. Replace the example repository names, paths and revision
with your own values:

```json
{
  "regression": {
    "version": 1,
    "repositories": [
      {
        "repository": "example/shop",
        "aliases": {
          "@/*": "src/*"
        }
      },
      {
        "repository": "example/ui",
        "revision": "3333333333333333333333333333333333333333"
      }
    ],
    "dependencies": [
      {
        "source": {
          "repository": "example/ui",
          "path": "src/Dropdown.tsx"
        },
        "consumer": {
          "repository": "example/shop",
          "path": "src/checkout.ts"
        },
        "specifier": "@example/ui/dropdown"
      }
    ],
    "journeys": [
      {
        "id": "checkout",
        "title": "Complete checkout",
        "sources": [
          {
            "repository": "example/shop",
            "path": "src/checkout.ts"
          }
        ],
        "tests": [
          {
            "file": "tests/checkout.spec.ts",
            "project": "chromium"
          }
        ]
      }
    ]
  }
}
```

Each journey links application source paths to the test files that exercise
that behavior. Keep the mappings reviewed alongside your tests: inferred
dependencies cannot prove that an assertion covers a requirement.

| Field                | Meaning                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repositories`       | Repositories participating in impact analysis, in `owner/name` form. Pin an exact `revision` for any repository absent from the run's changed sources.            |
| `aliases`            | Explicit import aliases for that repository. Use a literal module name or one trailing `/*` on both sides, such as `@/*` → `src/*`.                               |
| `dependencies`       | Explicit edges from a source to its consumer, including cross-repository and service relationships that static imports cannot infer. Use `[]` if none are needed. |
| `specifier`          | Optional literal import resolved by that edge, only in the named consumer. It does not resolve every import from that package.                                    |
| `journeys[].sources` | Literal paths relative to the named repository root.                                                                                                              |
| `journeys[].tests`   | Literal test files relative to the Playwright test workspace. If the node selects a `folder`, paths are relative to that folder.                                  |

Paths must not contain globs, absolute paths or parent traversal. The optional
test `project` verifies that discovery includes that project; it does not limit
execution to that project. Selected files run across all configured browser
projects. Read `nodes[].discovery.files` for the actual file/project pairs.

The example's dependency means a change to `example/ui:src/Dropdown.tsx` can
affect checkout in `example/shop`. For a service relationship without a module
import, omit `specifier` and keep the explicit source and consumer paths.

## 2. Describe the commits being compared

Save this as `regression-request.json`, replacing the example hashes with real
commits accessible through the GitHub connection:

```json
{
  "version": 1,
  "mode": "affected",
  "sources": [
    {
      "repository": "example/shop",
      "baseSha": "1111111111111111111111111111111111111111",
      "headSha": "2222222222222222222222222222222222222222"
    }
  ]
}
```

Use distinct, complete 40-character hexadecimal commit SHAs. Branch names,
abbreviated hashes and uncommitted working-tree changes are not accepted.
Include one source entry for each changed repository, up to 16 unique
repositories. In the example, `example/ui` is unchanged and uses the revision
saved in the mapping. If it also changed, add its own base/head source entry.

Playrunner compares the immutable base and head snapshots and follows reverse
dependencies through supported static JavaScript and TypeScript imports in
both snapshots. It also follows the saved explicit edges. When the test
repository is a changed source, execution pins it to that source's `headSha`;
otherwise, pin its revision in the saved configuration.

Set `"mode": "full"` to request the full configured suite for a release that
needs broader coverage. Keep the exact source comparison in the request.
Full mode does not limit execution to the test files listed in the mappings.

## 3. Start once, then keep working

With the server URL and API token already configured, start the saved workflow:

```bash
node packages/cli/dist/cli.js WORKFLOW_ID \
  --regression regression-request.json \
  --no-wait \
  --json
```

Replace `WORKFLOW_ID` with the workflow's actual ID. Keep the returned execution
ID and idempotency key. `--no-wait` returns after the server accepts the run;
your agent can continue other work while Playrunner runs the tests. Stopping a
client's wait does not cancel the workflow.

The CLI generates an idempotency key unless you supply `--idempotency-key`.
If a start response is lost or ambiguous, retain the reported key and reuse it
only for the same intended run. Use a fresh key for a new run, including an
intentional full-suite follow-up. Once an execution ID is known, inspect that
execution instead of starting it again.

The older `--repository`, `--base-sha` and related CI flags attach
[source-change context](./run-workflow.md#pass-source-change-context); they do
not enable this selection contract. Do not combine them with `--regression`.
A regression file takes precedence over ambient CI change-context variables.

## 4. Read incremental feedback

Use the execution ID from the start response:

```bash
node packages/cli/dist/cli.js feedback WORKFLOW_ID EXECUTION_ID \
  --after 0 \
  --json
```

This command performs one read and never starts a workflow. Keep the returned
`nextCursor` and use it as `--after` on the next read. Drain additional pages
while `hasMore` is true, then leave a few seconds between polls while your agent
continues its work. Read the final feedback when the workflow finishes.

A successful feedback request exits `0` even if tests failed. That exit code
means the response was retrieved, not that the tests passed or a release is
approved.

| Feedback                          | What the agent should inspect                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `status`, `progress`              | Workflow state and test progress. Workflow completion alone is not a test verdict.                         |
| `nodes[].plan`                    | Requested and actual mode, selected journeys, reasons, hashes and fallback reasons.                        |
| `nodes[].discovery`               | Actual discovered test count and file/project pairs; `blocked` means coverage was not established.         |
| `changes`                         | Cursor-based progress and terminal-attempt test outcomes, available while execution continues.             |
| `failures`                        | Current unexpected failures, with test identity, mapped journey IDs and available error/artifact evidence. |
| `expectedFailureCount`, `issues`  | Failures marked expected by test configuration, plus incomplete or blocked evidence.                       |
| `artifacts`                       | Authenticated report and plan paths. Open them using the same authorized installation/account.             |
| `truncated`, `evidenceIncomplete` | Limits or missing evidence that prevent treating the compact response as a complete passing result.        |

Live test outcomes are emitted after a pass or the final retry attempt. The
final report is authoritative and reconciles retries; a failed attempt followed
by a pass should not become a new failure alert. Failures marked expected with
Playwright's `test.fail()` are reported separately as `expectedFailureCount`.
That configuration does not prove a historical baseline, and it does not turn
the failure into passing release evidence.

Compact feedback is bounded. Read the authenticated report and
`regression-plan.json` artifact when details are truncated; plan omission
counters identify omitted entries. A stale activity timestamp, missing final
report or zero reported failures must not be interpreted as a passing suite.

## Use Playrunner Cloud MCP

[Connect the Cloud MCP server](../mcp/connect.md), call `get_account` first,
then read `get_authoring_guide` and the existing workflow before authoring.
Use the Cloud tools' current schemas to save the node mappings above. If the
connected server does not advertise `regression` and `get_run_feedback`, that
deployment does not yet support this flow.

Cloud uses `requestKey` for the intended execution. Call `run_workflow` with
these arguments, replacing the ID, commits and request key:

```json
{
  "workflowId": "YOUR_WORKFLOW_ID",
  "requestKey": "630e66c6-5727-48f8-8db2-2e155def417e",
  "regression": {
    "version": 1,
    "mode": "affected",
    "sources": [
      {
        "repository": "example/shop",
        "baseSha": "1111111111111111111111111111111111111111",
        "headSha": "2222222222222222222222222222222222222222"
      }
    ]
  }
}
```

Regression requests currently use hosted execution on Playrunner servers.
Do not combine them with `executionTarget: "local"`, `deviceId` or `source`;
the connected-machine path does not support this feature. Normal local worker
runs remain a separate flow.

Keep the returned `executionId` and call
`get_run_feedback` with both IDs:

```json
{
  "workflowId": "YOUR_WORKFLOW_ID",
  "executionId": "RETURNED_EXECUTION_ID",
  "after": "0"
}
```

Use `nextCursor` as the next `after`, drain `hasMore` pages and leave a few
seconds between polls. Reuse the same `requestKey` only to recover an ambiguous
start response for the same intended run. Starting a run does not install an
automatic chat notification; the agent must poll or revisit its execution.

## Use the standalone MCP server

After [connecting the standalone server](../mcp/self-hosted.md), read
`get_authoring_guide` and discover the saved workflow. Call `run_workflow` with
the following arguments, replacing the workflow ID, hashes and idempotency key:

```json
{
  "workflowId": "YOUR_WORKFLOW_ID",
  "idempotencyKey": "68f967ae-2847-44c9-bbd7-087532a06d38",
  "regression": {
    "version": 1,
    "mode": "affected",
    "sources": [
      {
        "repository": "example/shop",
        "baseSha": "1111111111111111111111111111111111111111",
        "headSha": "2222222222222222222222222222222222222222"
      }
    ]
  }
}
```

Then call `get_run_feedback` with the returned execution ID:

```json
{
  "workflowId": "YOUR_WORKFLOW_ID",
  "executionId": "RETURNED_EXECUTION_ID",
  "after": "0"
}
```

Use `nextCursor` as the next `after` and drain `hasMore` pages as with the CLI.
The agent must poll or revisit the execution; starting a run does not install
an automatic chat notification. Do not combine `regression` with `changeContext`
or `release` in the same start request. Do not substitute Cloud's `requestKey`
for standalone `idempotencyKey`.

## When Playrunner widens or blocks the run

Affected mode is conservative. Unmapped changes, unresolved imports, unsupported
framework/template sources, broad configuration changes and incomplete
dependency information can widen the run to the full configured suite. Import
aliases and explicit edges improve coverage, but do not make unsupported
framework relationships automatically understood.

Playwright discovery validates the selected test files before execution. If a
mapped test or required project is missing, Playrunner widens to the full suite.
If full-suite discovery fails or finds no tests, coverage is blocked. Repository
access failures or unavailable commit snapshots can also prevent execution;
they are not evidence that the change is safe.

Report the actual `plan.mode`, fallback reasons, discovered scope and any
unverified remainder. A full fallback is broader testing, not proof that every
user journey has an adequate test.

## What the result proves

The base commit is used for impact analysis. This workflow does not run the
application at the base commit and compare a baseline test result. A failing
head run is a failure or possible regression; it is not a confirmed new
regression without comparable baseline evidence. Feedback therefore leaves
`regressionConclusion` as `not_evaluated`.

Pinning source commits also does not prove that the application at your target
URL is running that build. Release approval needs independently observed
deployment identity, the agreed requirements and complete, fresh evidence for
the intended candidate. Keep that release decision separate from focused test
selection and workflow completion.
