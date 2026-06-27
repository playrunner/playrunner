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
│   ├── src/frontend/index.tsx
│   └── src/api/index.ts
├── environment/
│   ├── src/frontend/index.tsx
│   ├── src/frontend/EnvironmentConfigPanel.tsx
│   ├── src/frontend/VariablesTable.tsx
│   ├── src/frontend/types.ts
│   └── src/api/index.ts
├── github/
│   ├── assets/github.svg
│   ├── src/frontend/index.tsx
│   ├── src/frontend/GithubSettingsModal.tsx
│   └── src/api/index.ts
├── jira/
│   ├── assets/jira.svg
│   ├── src/frontend/index.tsx
│   ├── src/frontend/JiraConfigPanel.tsx
│   ├── src/frontend/JiraSettingsModal.tsx
│   └── src/api/index.ts
├── javascript/
│   ├── src/frontend/index.tsx
│   ├── src/frontend/JavascriptConfigPanel.tsx
│   └── src/api/index.ts
├── playwright/
│   ├── assets/playwright.svg
│   ├── src/frontend/index.tsx
│   ├── src/frontend/PlaywrightConfigPanel.tsx
│   ├── src/frontend/playwrightRunnerConfig.ts
│   └── src/api/index.ts
└── schedule/
    ├── src/frontend/index.tsx
    ├── src/frontend/ScheduleConfigPanel.tsx
    └── src/api/index.ts
```

## SDK responsibilities

Use `@playrunner/integration-sdk` for the pieces that every integration should share:

- `Integration` and `IntegrationConfigPanelProps` contracts
- `IntegrationSdkProvider` and `useIntegrationHost`
- reusable configuration and setup UI such as `IntegrationSettingsModal`, `IntegrationConfigField`, `IntegrationSetupGuide`, and `IntegrationCopyableCode`
- API contribution typing for backend route packages

Integrations should not import from `apps/frontend/src/...`. The host app provides auth, persistence, and UI primitives through `IntegrationSdkProvider`.

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
6. Add the package as a `file:` dependency in both consuming apps that need it while developing locally.
7. Register the frontend integration in `apps/frontend/src/integrations/registry.ts`.
8. Mount the backend router in `apps/api/src/index.ts`.

## Publishing to npm

Publish integrations to the public npm registry:

```bash
cd packages/<integration-id>
npm publish --access public
```

Before publishing, authenticate with npm and make sure the package version has been bumped.
