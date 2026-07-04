---
sidebar_position: 8
sidebar_label: Playwright
title: Playwright Integration
description: Trigger Playwright test runs from Playrunner workflows.
hide_title: true
---

import {
IntegrationCallout,
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="Playwright"
packageName="@playrunner/playwright"
description="Trigger Playwright test runs from workflow nodes with repository, script, artifact, and runner configuration built into the package."
icon="playwright"
installCommand="npm install @playrunner/playwright @playrunner/github"
npmUrl="https://www.npmjs.com/package/@playrunner/playwright"
badges={['Trigger node', 'GitHub dependency', 'Runner config']}
facts={[
{ label: 'Node type', value: 'Trigger' },
{ label: 'Peer dependency', value: '@playrunner/github' },
{ label: 'Backend mount', value: '/api/playwright' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Runner configuration panel">
    Exports `playwrightIntegration` and `PlaywrightConfigPanel` for repository
    selection, inline script editing, zip upload metadata, environment
    injection, and runner resources.
  </IntegrationCard>

  <IntegrationCard eyebrow="Dependency" title="GitHub-backed auth">
    Repository authentication uses `GithubSettingsModal` from
    `@playrunner/github`, so both packages must be installed.
  </IntegrationCard>

  <IntegrationCard eyebrow="Execution" title="Workflow runner infrastructure">
    Playwright execution is handled by workflow runner infrastructure rather
    than package-local API endpoints.
  </IntegrationCard>

  <IntegrationCard eyebrow="Assets" title="Package-owned icon">
    The Playwright SVG lives inside the package and is resolved by the frontend
    entrypoint.
  </IntegrationCard>
</IntegrationGrid>

<IntegrationCallout title="Install GitHub with Playwright">
Playwright has a dependency on GitHub repository authentication. Install
`@playrunner/github` alongside Playwright and keep the GitHub integration
registered in the host app.
</IntegrationCallout>

## Exports

```ts
import {
  playwrightIntegration,
  PlaywrightConfigPanel,
} from "@playrunner/playwright";
import { playwrightRouter } from "@playrunner/playwright/api";
```

## Frontend

The frontend entrypoint exports `playwrightIntegration`, which keeps the existing integration id as `playwright` so saved workflows continue to resolve their test runner nodes.

Playwright owns the configuration UI, including repository selection, inline script editing, zip upload metadata, environment variable injection, and runner resource settings.

Playwright keeps its input panel enabled, so it can receive inbound workflow context from nodes such as Environment even though its selector category is `Trigger`.

## GitHub Dependency

Playwright repository authentication still uses GitHub. It imports `GithubSettingsModal` from `@playrunner/github` and declares `@playrunner/github` as a peer dependency. The host app must install both integrations and keep GitHub registered.

## API

The API entrypoint exports an empty `playwrightRouter`, mounted by the host API at `/api/playwright`. The current Playwright node executes through workflow runner infrastructure rather than package-local API endpoints, but Playwright still exposes an API entrypoint so all integrations have the same frontend/API shape.

## Assets

The Playwright SVG lives inside the package at `packages/playwright/assets/playwright.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
