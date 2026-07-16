---
sidebar_position: 1
title: Overview
description: Build-time Playrunner integration packages, runtime configuration, SDK usage, and persistence.
hide_title: true
---

import {
IntegrationDirectory,
IntegrationDirectoryHero,
IntegrationDirectoryItem,
} from '@site/src/components/IntegrationPage';

<IntegrationDirectoryHero title="Integrations">
Choose Playrunner integration packages as part of the application build. Each
package can ship frontend registration, configuration UI, backend routes,
package-owned assets, and a trusted Orchestrator contribution.
</IntegrationDirectoryHero>

<IntegrationDirectory>
  <IntegrationDirectoryItem
    name="Jira"
    packageName="@playrunner/jira"
    description="Create and sync Jira tickets from Playrunner workflows."
    icon="jira"
    href="/docs/integration-packages/jira"
    installCommand="npm install @playrunner/jira"
  />
  <IntegrationDirectoryItem
    name="JavaScript"
    packageName="@playrunner/javascript"
    description="Run custom JavaScript inside workflow nodes."
    icon="javascript"
    href="/docs/integration-packages/javascript"
    installCommand="npm install @playrunner/javascript"
  />
  <IntegrationDirectoryItem
    name="GitHub"
    packageName="@playrunner/github"
    description="Connect repositories and manage GitHub auth."
    icon="github"
    href="/docs/integration-packages/github"
    installCommand="npm install @playrunner/github"
  />
  <IntegrationDirectoryItem
    name="GCP"
    packageName="@playrunner/gcp"
    description="Connect Google Cloud and register GCP runner runtime backends."
    icon="gcp"
    href="/docs/integration-packages/gcp"
    installCommand="npm install @playrunner/gcp"
  />
  <IntegrationDirectoryItem
    name="Environment"
    packageName="@playrunner/environment"
    description="Manage reusable environment variables for workflow nodes."
    icon="environment"
    href="/docs/integration-packages/environment"
    installCommand="npm install @playrunner/environment"
  />
  <IntegrationDirectoryItem
    name="Schedule"
    packageName="@playrunner/schedule"
    description="Trigger workflows on recurring schedules."
    icon="schedule"
    href="/docs/integration-packages/schedule"
    installCommand="npm install @playrunner/schedule"
  />
  <IntegrationDirectoryItem
    name="Playwright"
    packageName="@playrunner/playwright"
    description="Run Playwright test workflows with repository-backed config."
    icon="playwright"
    href="/docs/integration-packages/playwright"
    installCommand="npm install @playrunner/playwright @playrunner/github"
  />
  <IntegrationDirectoryItem
    name="Slack"
    packageName="@playrunner/slack"
    description="Send notifications and alerts to Slack channels."
    icon="slack"
    href="/docs/integration-packages/slack"
    installCommand="npm install @playrunner/slack"
  />
</IntegrationDirectory>

The current integrations are `@playrunner/environment` in `packages/environment`, `@playrunner/gcp` in `packages/gcp`, `@playrunner/github` in `packages/github`, `@playrunner/jira` in `packages/jira`, `@playrunner/javascript` in `packages/javascript`, `@playrunner/playwright` in `packages/playwright`, `@playrunner/schedule` in `packages/schedule`, and `@playrunner/slack` in `packages/slack`. Shared contracts and reusable UI helpers live in `@playrunner/integration-sdk` in `packages/integration-sdk`.

## Build-time installation only

Integration code is never installed during a workflow run or from a running
marketplace. Package versions are selected before the relevant Playrunner apps
and images are built. The current repository consumes them as local `file:`
dependencies, and package manifests target the restricted GitHub Packages
registry for publishing.

Runtime users can connect credentials, add an already-bundled node to a
workflow, connect it to other nodes, select an action, and edit its fields.
Those operations only change stored settings and workflow data; they do not
download or activate new code.

Executable packages are statically imported by
`@playrunner/integration-registry/orchestrator` and bundled into the
Orchestrator artifact. Adding, upgrading, or removing an executable integration
therefore requires a new Orchestrator build and deployment. There is no runtime
package discovery, installation, or hot-loading. See
[Orchestrator contributions](./orchestrator) for the contract, registration,
and deployment flow.

The install commands shown on the integration cards are build/development
commands for the operator assembling an artifact. They are not commands that a
running Playrunner deployment executes.

## Package layout

```text
packages/
├── integration-sdk/
│   ├── package.json
│   ├── src/frontend/index.tsx
│   ├── src/api/index.ts
│   └── src/orchestrator/index.ts
├── integration-registry/
│   ├── package.json
│   ├── src/frontend/index.ts
│   ├── src/api/index.ts
│   └── src/orchestrator/index.ts
├── environment/
│   ├── package.json
│   ├── src/frontend/index.tsx
│   ├── src/frontend/EnvironmentConfigPanel.tsx
│   ├── src/frontend/VariablesTable.tsx
│   ├── src/frontend/types.ts
│   └── src/api/index.ts
├── github/
│   ├── package.json
│   ├── assets/github.svg
│   ├── src/frontend/index.tsx
│   ├── src/frontend/GithubSettingsModal.tsx
│   └── src/api/index.ts
├── gcp/
│   ├── package.json
│   ├── assets/gcp.svg
│   ├── src/frontend/index.tsx
│   ├── src/frontend/GcpSettingsModal.tsx
│   ├── src/api/index.ts
│   └── src/api-runtime/index.ts
├── jira/
│   ├── package.json
│   ├── assets/jira.svg
│   ├── src/frontend/index.tsx
│   ├── src/frontend/JiraConfigPanel.tsx
│   ├── src/frontend/JiraSettingsModal.tsx
│   ├── src/api/index.ts
│   └── src/orchestrator/index.ts
├── javascript/
│   ├── package.json
│   ├── src/frontend/index.tsx
│   ├── src/frontend/JavascriptConfigPanel.tsx
│   └── src/api/index.ts
├── playwright/
│   ├── package.json
│   ├── assets/playwright.svg
│   ├── src/frontend/index.tsx
│   ├── src/frontend/PlaywrightConfigPanel.tsx
│   ├── src/frontend/playwrightRunnerConfig.ts
│   └── src/api/index.ts
├── schedule/
│   ├── package.json
│   ├── src/frontend/index.tsx
│   ├── src/frontend/ScheduleConfigPanel.tsx
│   └── src/api/index.ts
└── slack/
    ├── package.json
    ├── assets/slack.svg
    ├── src/frontend/index.tsx
    ├── src/frontend/SlackConfigPanel.tsx
    ├── src/frontend/SlackSettingsModal.tsx
    ├── src/api/index.ts
    └── src/orchestrator/index.ts
```

Each package has the same basic shape:

- `package.json` declares the package name, exports, peer dependencies, and publish settings.
- `src/frontend/index.tsx` exports the `Integration` metadata plus any settings modal or config panel components.
- `src/api/index.ts` exports an Express router for backend endpoints owned by the integration.
- `src/orchestrator/index.ts` optionally exports trusted workflow executors through `@playrunner/<integration-id>/orchestrator`.
- `assets/` stores package-owned image assets when the integration needs SVGs or other media.

## SDK responsibilities

Use `@playrunner/integration-sdk` for the pieces that every integration should share:

- `Integration` and `IntegrationConfigPanelProps` contracts
- `IntegrationSdkProvider` and `useIntegrationHost`
- reusable configuration and setup UI such as `IntegrationSettingsModal`, `IntegrationConfigField`, `IntegrationSetupGuide`, and `IntegrationCopyableCode`
- API contribution typing for backend route packages
- the versioned Orchestrator contract, including `ORCHESTRATOR_CONTRACT_VERSION`, `OrchestratorIntegrationContribution`, `NodeExecutionContext`, `NodeExecutionResult`, and `createOrchestratorContribution`

Integrations should not import from `apps/frontend/src/...`. The host app provides auth, persistence, and UI primitives through `IntegrationSdkProvider`.

## Node selector and inbound connections

Package metadata controls how a node behaves in the visual editor:

| Field                       | Editor behaviour                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `nodeType`                  | Describes the frontend node category shown in the selector: `trigger`, `action`, or `config`.                                |
| `showInNodeSelector: false` | Hides the integration from the add-node selector.                                                                            |
| `showInputPanel: false`     | Removes the inbound input panel and prevents the node from being selected as a connection target while drawing a connection. |

Use `showInputPanel: false` for nodes that provide workflow context or start
workflow behavior but should not receive upstream inputs. Environment and
Schedule use this setting, so they can be added directly from the selector but
appear disabled when the selector is opened to complete an inbound connection.

This frontend `Integration.nodeType` category is not the persisted workflow
node's `node.nodeType`. The persisted value is the integration ID, such as
`jira` or `slack`, and is what the Orchestrator uses to resolve an executor.

## How integrations use the SDK

Frontend integration code runs inside the host app, but it should only talk to the host through the SDK:

```ts
import { useIntegrationHost } from "@playrunner/integration-sdk";

export function ProviderSettingsModal() {
  const { auth, store, ui } = useIntegrationHost();
  const Input = ui.Input;

  // Use auth.currentUser for the current user and store for persistence.
}
```

The host app wires the SDK to its actual auth, database, and UI implementation in `apps/frontend/src/integrations/sdkHost.ts`. Packages should not import `DbAPI`, Prisma, app UI components, or application routes directly.

## Persistence model

Integration credentials and account-level settings are stored in one shared Prisma model:

```prisma
model Integration {
  id        String   @id @default(cuid())
  userId    String
  provider  String
  data      Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, provider])
  @@index([userId])
}
```

That means the data is normalized by user and provider:

```text
userId = user_123
provider = jira
data = { clientId, clientSecret, accessToken, refreshToken, expiresAt }
```

Use this split when deciding where data belongs:

| Data                                                                                   | Store it in                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| OAuth credentials, connected account IDs, provider-level settings                      | `store.saveIntegration(userId, provider, data)` |
| Node-specific settings such as selected project, script, branch, or schedule frequency | the workflow node `config`                      |
| Named environment variables shared across workflow nodes                               | `store.saveEnvironment`                         |
| Standalone sensitive values that should be referenced by key                           | `store.saveSecret`                              |

An integration saves account-level data through the SDK store:

```ts
const userId = auth.currentUser?.uid;
if (!userId) return;

await store.saveIntegration(userId, "jira", {
  clientId,
  clientSecret,
  accessToken,
  refreshToken,
  expiresAt: Date.now() + tokenData.expires_in * 1000,
  updatedAt: new Date().toISOString(),
});
```

`saveIntegration` currently replaces the provider's `data` JSON object. If you are updating one field, first read the existing record and write back the complete provider-owned data shape:

```ts
const current = await store.getIntegration(userId, "jira");
const {
  id,
  provider,
  userId: _storedUserId,
  createdAt,
  updatedAt,
  ...currentData
} = current ?? {};

await store.saveIntegration(userId, "jira", {
  ...currentData,
  accessToken,
  refreshToken,
  expiresAt,
  updatedAt: new Date().toISOString(),
});
```

Custom per-integration database tables are not part of the package SDK today. If an integration needs new persistent data beyond the shared `Integration`, `Environment`, or `Secret` stores, add an explicit host API route and document the host migration requirement.

## Local linking

The app consumes local packages through `file:` dependencies:

```bash
./install-local.sh
```

For manual package work, install the package folders before starting the apps:

```bash
npm install --prefix packages/integration-sdk
npm install --prefix packages/integration-registry
npm install --prefix packages/environment
npm install --prefix packages/gcp
npm install --prefix packages/github
npm install --prefix packages/javascript
npm install --prefix packages/jira
npm install --prefix packages/playwright
npm install --prefix packages/schedule
npm install --prefix packages/slack
npm install --prefix apps/api
npm install --prefix apps/frontend
npm install --prefix apps/runners/orchestrator
```

The frontend also has Vite and TypeScript aliases for local package source, so frontend package edits are picked up during normal Vite development.

```bash
npm run dev --prefix apps/frontend
npm start --prefix apps/api
```

Package executor source is different: it is bundled into the Orchestrator
artifact and then copied into its image. Changes under
`packages/integration-sdk/src/orchestrator`,
`packages/integration-registry/src/orchestrator`, or an integration's
`src/orchestrator` directory are not visible to an already-running image.
Rebuild it after changing executable package code:

```bash
./infra/scripts/rebuild-orchestrator.sh
```

If local package links become stale, reinstall the app dependencies:

```bash
rm -rf apps/frontend/node_modules/@playrunner apps/api/node_modules/@playrunner
npm install --prefix apps/frontend
npm install --prefix apps/api
```

## Adding an integration

1. Create `packages/<integration-id>/package.json` with a scoped package name such as `@playrunner/<integration-id>`.
2. Put frontend exports in `src/frontend/index.tsx`.
3. Put backend route exports in `src/api/index.ts`.
4. Put service images under `assets/` when the integration needs packaged image assets.
5. Use SDK components for settings dialogs, setup instructions, copyable callback URLs, and config fields.
6. Use `useIntegrationHost().store` for integration credentials and account-level settings.
7. Keep node-specific configuration in workflow node `config`.
8. If the package executes workflow nodes, add `src/orchestrator/index.ts`, export `./orchestrator`, and use the versioned SDK contract.
9. Add the package as a `file:` dependency in every app that consumes it while developing locally. Executable packages must be production dependencies of `apps/runners/orchestrator`.
10. Update the affected lockfiles.
11. Register the frontend integration in `packages/integration-registry/src/frontend/index.ts`.
12. Register the backend contribution in `packages/integration-registry/src/api/index.ts`.
13. Register executable contributions through static imports in `packages/integration-registry/src/orchestrator/index.ts`.
14. Run the package checks, Orchestrator tests, and production bundle build described in [Orchestrator contributions](./orchestrator#validation).
15. Rebuild the Orchestrator image. Push and redeploy it for a GCP deployment.

## Publishing packages

The current package manifests publish restricted packages to GitHub Packages.
Authenticate for that registry, bump the package version, then publish from the
package directory:

```bash
cd packages/<integration-id>
npm publish
```

Publishing an executable package does not change a running deployment. Update
the build dependency and lockfile, rebuild the Orchestrator artifact and image,
then push and redeploy that image.
