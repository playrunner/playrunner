---
sidebar_position: 1
title: Overview
---

# Integrations

Integrations ship external service nodes in deployable npm packages:

- frontend registration and configuration UI
- backend API routes
- image assets required by the integration

The current integrations are `@playrunner/environment` in `packages/environment`, `@playrunner/github` in `packages/github`, `@playrunner/jira` in `packages/jira`, `@playrunner/javascript` in `packages/javascript`, `@playrunner/playwright` in `packages/playwright`, and `@playrunner/schedule` in `packages/schedule`. Shared contracts and reusable UI helpers live in `@playrunner/integration-sdk` in `packages/integration-sdk`.

## Install from npm

These packages will be published publicly on npm. The links below are placeholders until the packages are published.

| Integration | Install command | npm |
| --- | --- | --- |
| Environment | `npm install @playrunner/environment` | [@playrunner/environment](https://www.npmjs.com/package/@playrunner/environment) |
| GitHub | `npm install @playrunner/github` | [@playrunner/github](https://www.npmjs.com/package/@playrunner/github) |
| JavaScript | `npm install @playrunner/javascript` | [@playrunner/javascript](https://www.npmjs.com/package/@playrunner/javascript) |
| Jira | `npm install @playrunner/jira` | [@playrunner/jira](https://www.npmjs.com/package/@playrunner/jira) |
| Playwright | `npm install @playrunner/playwright @playrunner/github` | [@playrunner/playwright](https://www.npmjs.com/package/@playrunner/playwright) |
| Schedule | `npm install @playrunner/schedule` | [@playrunner/schedule](https://www.npmjs.com/package/@playrunner/schedule) |

## Package layout

```text
packages/
├── integration-sdk/
│   ├── package.json
│   ├── src/frontend/index.tsx
│   └── src/api/index.ts
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
├── jira/
│   ├── package.json
│   ├── assets/jira.svg
│   ├── src/frontend/index.tsx
│   ├── src/frontend/JiraConfigPanel.tsx
│   ├── src/frontend/JiraSettingsModal.tsx
│   └── src/api/index.ts
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
└── schedule/
    ├── package.json
    ├── src/frontend/index.tsx
    ├── src/frontend/ScheduleConfigPanel.tsx
    └── src/api/index.ts
```

Each package has the same basic shape:

- `package.json` declares the package name, exports, peer dependencies, and publish settings.
- `src/frontend/index.tsx` exports the `Integration` metadata plus any settings modal or config panel components.
- `src/api/index.ts` exports an Express router for backend endpoints owned by the integration.
- `assets/` stores package-owned image assets when the integration needs SVGs or other media.

## SDK responsibilities

Use `@playrunner/integration-sdk` for the pieces that every integration should share:

- `Integration` and `IntegrationConfigPanelProps` contracts
- `IntegrationSdkProvider` and `useIntegrationHost`
- reusable configuration and setup UI such as `IntegrationSettingsModal`, `IntegrationConfigField`, `IntegrationSetupGuide`, and `IntegrationCopyableCode`
- API contribution typing for backend route packages

Integrations should not import from `apps/frontend/src/...`. The host app provides auth, persistence, and UI primitives through `IntegrationSdkProvider`.

## How integrations use the SDK

Frontend integration code runs inside the host app, but it should only talk to the host through the SDK:

```ts
import { useIntegrationHost } from '@playrunner/integration-sdk';

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

| Data | Store it in |
| --- | --- |
| OAuth credentials, connected account IDs, provider-level settings | `store.saveIntegration(userId, provider, data)` |
| Node-specific settings such as selected project, script, branch, or schedule frequency | the workflow node `config` |
| Named environment variables shared across workflow nodes | `store.saveEnvironment` |
| Standalone sensitive values that should be referenced by key | `store.saveSecret` |

An integration saves account-level data through the SDK store:

```ts
const userId = auth.currentUser?.uid;
if (!userId) return;

await store.saveIntegration(userId, 'jira', {
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
const current = await store.getIntegration(userId, 'jira');
const {
  id,
  provider,
  userId: _storedUserId,
  createdAt,
  updatedAt,
  ...currentData
} = current ?? {};

await store.saveIntegration(userId, 'jira', {
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
npm install --prefix packages/environment
npm install --prefix packages/github
npm install --prefix packages/javascript
npm install --prefix packages/jira
npm install --prefix packages/playwright
npm install --prefix packages/schedule
npm install --prefix apps/api
npm install --prefix apps/frontend
```

The frontend also has Vite and TypeScript aliases for local package source, so frontend package edits are picked up during normal Vite development.

```bash
npm run dev --prefix apps/frontend
npm start --prefix apps/api
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
8. Add the package as a `file:` dependency in both consuming apps that need it while developing locally.
9. Register the frontend integration in `apps/frontend/src/integrations/registry.ts`.
10. Mount the backend router in `apps/api/src/index.ts`.

## Publishing to npm

Publish integrations to the public npm registry:

```bash
cd packages/<integration-id>
npm publish --access public
```

Before publishing, authenticate with npm and make sure the package version has been bumped.
