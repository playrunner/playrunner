---
sidebar_position: 6
sidebar_label: Environment
title: Environment Integration
description: Configure reusable environment variables and inject them into Playrunner workflow nodes.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="Environment"
packageName="@playrunner/environment"
description="Configure reusable environment variables and inject them into workflow nodes from a shared package-owned UI."
icon="environment"
installCommand="npm install @playrunner/environment"
npmUrl="https://www.npmjs.com/package/@playrunner/environment"
badges={['Config node', 'Variables table', 'Shared storage']}
facts={[
{ label: 'Node type', value: 'Config' },
{ label: 'Integration id', value: 'environment' },
{ label: 'Backend mount', value: '/api/environment' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Environment config node">
    Exports `environmentIntegration`, `EnvironmentConfigPanel`, `VariablesTable`,
    and environment types used by the host Environments page.
  </IntegrationCard>

  <IntegrationCard eyebrow="Persistence" title="Shared environment store">
    Environment persistence uses shared store routes under
    `/api/store/environments`, exposed to packages through the SDK host.
  </IntegrationCard>

  <IntegrationCard eyebrow="Backend" title="Consistent API shape">
    Exports `environmentRouter`, mounted at `/api/environment`, even though
    environment records use the shared store routes.
  </IntegrationCard>

  <IntegrationCard eyebrow="Icon" title="Lucide source">
    Uses the `Settings` icon from `lucide-react`, so it does not need a packaged
    image asset.
  </IntegrationCard>
</IntegrationGrid>

## Exports

```ts
import environmentIntegration, {
  EnvironmentConfigPanel,
  VariablesTable,
} from "@playrunner/environment";
import type { EnvVar, SavedEnvironment } from "@playrunner/environment";
import environmentApiContribution, {
  environmentRouter,
} from "@playrunner/environment/api";
```

## Frontend

The frontend entrypoint default-exports `environmentIntegration`, which keeps the existing integration id as `environment` so saved workflows continue to resolve their config nodes.

The integration uses `@playrunner/integration-sdk` for host-provided auth,
persistence, and UI primitives. Its own package manifest declares the `.`
frontend and `./api` surfaces, and each entrypoint default-exports its
contribution. Frontend and API builds discover those surfaces from installed
direct production dependencies and generate static imports; no shared registry
edit is required. The Environments page also reuses the package's
`VariablesTable` and environment types.

Environment sets `showInputPanel: false`, so it does not accept inbound workflow connections. It can be added directly to the canvas and connected out to nodes such as Playwright, but it appears disabled in the node selector when the user is completing a connection target.

## API

The API entrypoint default-exports `environmentApiContribution`, containing the
empty `environmentRouter` and its `/api/environment` mount path. Environment
persistence still uses the shared store routes under `/api/store/environments`.

## Assets

Environment uses the `Settings` icon from `lucide-react`, so it does not need a packaged image asset.
