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
    Default-exports `playwrightIntegration` and also exports
    `PlaywrightConfigPanel` for repository selection, inline script editing, zip
    upload metadata, environment injection, and runner resources.
  </IntegrationCard>

  <IntegrationCard eyebrow="Dependency" title="GitHub-backed auth">
    Repository authentication uses `GithubSettingsModal` from
    `@playrunner/github`, so both packages must be installed.
  </IntegrationCard>

  <IntegrationCard eyebrow="Execution" title="Workflow runner infrastructure">
    Playwright does not currently declare an Orchestrator contribution.
    Execution remains on the explicit host-managed Playwright runner path.
  </IntegrationCard>

  <IntegrationCard eyebrow="Assets" title="Package-owned icon">
    The Playwright SVG lives inside the package and is resolved by the frontend
    entrypoint.
  </IntegrationCard>
</IntegrationGrid>

<IntegrationCallout title="Install GitHub with Playwright">
Playwright has a dependency on GitHub repository authentication. Install
`@playrunner/github` alongside Playwright as a direct production dependency of
each app that consumes its surfaces. Both packages declare their own build
surfaces, so no shared registry edit is required.
</IntegrationCallout>

## Exports

```ts
import playwrightIntegration, {
  PlaywrightConfigPanel,
} from "@playrunner/playwright";
import playwrightApiContribution, {
  playwrightRouter,
} from "@playrunner/playwright/api";
```

The same contribution objects remain available as named exports. The default
exports are the build-composition contract.

## Frontend

The frontend entrypoint default-exports `playwrightIntegration`, which keeps the
existing integration id as `playwright` so saved workflows continue to resolve
their test runner nodes.

Playwright owns the configuration UI, including repository selection, inline script editing, zip upload metadata, environment variable injection, and runner resource settings.

Playwright keeps its input panel enabled, so it can receive inbound workflow context from nodes such as Environment even though its selector category is `Trigger`.

## GitHub Dependency

Playwright repository authentication still uses GitHub. It imports
`GithubSettingsModal` from `@playrunner/github` and declares
`@playrunner/github` as a peer dependency. The consuming frontend must select
both packages as direct production dependencies. The build composer discovers
their package-owned metadata and generates static imports; neither package
requires a central registration entry.

## API

The API entrypoint default-exports `playwrightApiContribution`, containing the
empty `playwrightRouter` and its `/api/playwright` mount path. The package
manifest declares the `playwright` ID plus its `.` frontend and `./api` surfaces,
and both entrypoints default-export their contribution. Frontend and API builds
discover those surfaces from installed direct production dependencies and
generate static imports.

## Orchestrator

The Playwright package does not currently declare an `./orchestrator` surface.
Its runner preparation and execution are explicit host-managed paths in
`apps/runners/orchestrator`. Installing the package therefore contributes its
frontend and API surfaces, while executable Playwright support still depends on
the host runtime already bundled into the Orchestrator image.

## Assets

The Playwright SVG lives inside the package at `packages/playwright/assets/playwright.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
