---
sidebar_position: 1.5
sidebar_label: Orchestrator contributions
title: Orchestrator Contributions
description: Add trusted package-owned node executors to the Playrunner orchestrator at build time.
---

# Orchestrator Contributions

> **Build-time only.** Executable integration code is selected, installed, and
> bundled while the Orchestrator image is built. A running Playrunner instance
> never downloads, installs, or hot-loads marketplace packages.

An executable integration can own its provider-specific workflow behavior under
`src/orchestrator/`. The Orchestrator host still owns workflow policy, lifecycle,
transport, and state publication.

## Build time and runtime

These are deliberately separate operations:

| Build time                                                             | Runtime                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Select the trusted integration packages included in the deployment.    | Connect OAuth, tokens, webhooks, or other provider settings.              |
| Install package dependencies and update lockfiles.                     | Add an already-bundled integration node to a workflow.                    |
| Register package contributions through static imports.                 | Select the node action and configure its fields.                          |
| Rebuild the Orchestrator image, then push and redeploy it when needed. | Resolve and execute the registered handler without changing the artifact. |

Adding a node or connecting its settings does not install code. Changing the
installed package set or any executor implementation requires a new Orchestrator
build. GCP deployments also require the rebuilt image to be pushed and rolled
out.

## Architecture

The contribution model has four layers:

| Layer                                           | Responsibility                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `@playrunner/integration-sdk/orchestrator`      | Versioned contribution, execution-context, result, and logging contracts.                    |
| `@playrunner/<integration-id>/orchestrator`     | Provider validation, API requests, provider-specific progress messages, and output shaping.  |
| `@playrunner/integration-registry/orchestrator` | Static composition of the trusted contributions included in the artifact.                    |
| `apps/runners/orchestrator`                     | DAG scheduling, preflight, lifecycle, state, transport, timeouts, cancellation, and cleanup. |

Jira and Slack currently provide package-owned executors. Environment,
Playwright, Schedule, and GitHub remain on explicit host-managed paths.

## Package layout and export

Executable packages add a server-only entrypoint alongside their frontend and
API surfaces:

```text
packages/<integration-id>/
├── assets/
├── package.json
└── src/
    ├── frontend/
    │   └── index.tsx
    ├── api/
    │   └── index.ts
    └── orchestrator/
        └── index.ts
```

Expose the entrypoint with all TypeScript source export conditions used by the
repo's consumers:

```json
{
  "exports": {
    "./orchestrator": {
      "types": "./src/orchestrator/index.ts",
      "import": "./src/orchestrator/index.ts",
      "require": "./src/orchestrator/index.ts",
      "default": "./src/orchestrator/index.ts"
    }
  }
}
```

## Contribution example

```ts
import {
  createOrchestratorContribution,
  ORCHESTRATOR_CONTRACT_VERSION,
} from "@playrunner/integration-sdk/orchestrator";

export const exampleOrchestratorContribution = createOrchestratorContribution({
  contractVersion: ORCHESTRATOR_CONTRACT_VERSION,
  id: "example",
  executors: [
    {
      nodeType: "example",
      action: "send",
      default: true,
      validate: ({ node, settings }) => {
        if (!settings.accessToken) {
          throw new Error("Example credentials are missing.");
        }
        if (!node.config.message) {
          throw new Error("Example message is required.");
        }
      },
      execute: async ({ node, settings, renderTemplate, log, signal }) => {
        const message = renderTemplate(String(node.config.message));

        await log("Sending example message...", "info");
        await sendExampleMessage({
          accessToken: String(settings.accessToken),
          message,
          signal,
        });

        return { outcome: "success" };
      },
    },
  ],
});
```

An executor returns `success` or `warning`. It throws a safe, user-facing error
when execution fails; the host normalizes that exception and publishes the
terminal error state.

## Resolution rules

- `node.nodeType` is the persisted integration ID used for executor lookup.
- `node.config.action`, when present, must match an executor action exactly.
- A default executor is used only when the persisted node has no action.
- Resolution never falls back to the node's display label.
- `Integration.nodeType` in the frontend contract is only a selector category
  (`trigger`, `action`, or `config`). It is not the persisted integration ID.
- Duplicate contribution IDs, duplicate executor keys, multiple defaults,
  malformed contributions, and unsupported contract versions stop startup.
- A missing executor or unsupported action fails preflight with an
  `executor not installed/registered` error. It does not silently succeed.

## Executor capabilities

The host supplies each executor with:

- its execution ID and optional workflow ID;
- the current node ID, persisted integration ID, and node configuration;
- only that contribution's provider settings;
- read-only environment and workflow snapshots;
- host-owned template rendering and logging functions; and
- an `AbortSignal` controlled by the host timeout and stop path.

Executors do not receive the full workflow request, other integrations'
credentials, event publishers, transport credentials, DAG routing functions, or
node-state mutation functions.

## Host-owned lifecycle

The Orchestrator preflights every executable node before starting the DAG. Each
package invocation then runs inside host-owned `try/catch/finally` handling. The
host always performs terminal-state publication and bookkeeping, including when
an executor throws, times out, or is cancelled.

Active package executions are keyed by both `executionId` and `nodeId`. This
allows concurrent workflow runs to contain the same persisted node ID without
their cancellation state colliding.

## Registering an executable package

1. Add `src/orchestrator/index.ts` and the `./orchestrator` package export.
2. Add the package to the Orchestrator's build-time dependencies.
3. Import its public subpath from
   `packages/integration-registry/src/orchestrator/index.ts` and add its
   contribution to `packageOrchestratorContributions`.
4. Declare the package as a required registry peer so a missing build input
   fails during installation.
5. Update the affected app lockfiles.
6. Rebuild the Orchestrator artifact. Do not add runtime package-install logic.

## Validation

Run the package checks first:

```bash
npm run typecheck --prefix packages/<integration-id>
npm run lint --prefix packages/<integration-id>
npm run format:check --prefix packages/<integration-id>
(cd packages/<integration-id> && npm pack --dry-run --json)
```

Then verify the registry, host lifecycle, and production bundle:

```bash
npm test --prefix apps/runners/orchestrator
npm run typecheck --prefix apps/runners/orchestrator
npm run lint --prefix apps/runners/orchestrator
npm run build --prefix apps/runners/orchestrator
node --check apps/runners/orchestrator/dist/index.js
```

For a local image test:

```bash
./infra/scripts/rebuild-orchestrator.sh
```

Reopen the Editor so the API starts a container from the rebuilt image, then
inspect the bundled contribution IDs and contract versions:

```bash
curl --silent http://localhost:3012/runtime
```

`orchestratorContributions` lists each contribution's contract version and
registered action/default executors. `activePackageExecutorCount` reports
in-flight package executions, and `orchestratorExecutorTimeoutMs` reports the
host timeout applied to each invocation.

For GCP, build, push, and redeploy the Orchestrator image after the local test
passes:

```bash
./infra/gcp/scripts/push-runners.sh --target orchestrator --yes
```

The running `/runtime` response is the deployment check. If the expected
contribution is absent, the selected package was not included in that image.

## Trust boundary

Package executors run inside the privileged Orchestrator process. The static
registry is therefore for trusted packages selected by the deployment. Running
arbitrary third-party marketplace code requires a separate isolation, signing,
capability, and rollback design; it must not be implemented as runtime download
or direct hot-loading into this process.
