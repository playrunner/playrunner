---
sidebar_position: 3
sidebar_label: JavaScript
title: JavaScript Integration
description: Run custom JavaScript inside Playrunner workflow nodes.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="JavaScript"
packageName="@playrunner/javascript"
description="Run custom JavaScript inside Playrunner workflows using the shared integration SDK UI contract."
icon="javascript"
installCommand="npm install @playrunner/javascript"
npmUrl="https://www.npmjs.com/package/@playrunner/javascript"
badges={['Action node', 'Code editor', 'No auth']}
facts={[
{ label: 'Node type', value: 'Action' },
{ label: 'Integration id', value: 'code' },
{ label: 'Backend mount', value: '/api/javascript' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Code-node configuration">
    Exports `javascriptIntegration` and `JavascriptConfigPanel`. The integration
    keeps the existing `code` id so saved workflows continue to resolve.
  </IntegrationCard>

  <IntegrationCard eyebrow="SDK usage" title="Shared config fields">
    Uses `@playrunner/integration-sdk` for config field layout and host-provided
    UI primitives.
  </IntegrationCard>

  <IntegrationCard eyebrow="Backend" title="Consistent API shape">
    Exports `javascriptRouter`, mounted at `/api/javascript`, even though the
    current JavaScript node has no backend endpoints.
  </IntegrationCard>

  <IntegrationCard eyebrow="Icon" title="Lucide source">
    Uses the `Code2` icon from `lucide-react`, so it does not need a packaged
    image asset.
  </IntegrationCard>
</IntegrationGrid>

## Exports

```ts
import javascriptIntegration, {
  JavascriptConfigPanel,
} from "@playrunner/javascript";
import javascriptApiContribution, {
  javascriptRouter,
} from "@playrunner/javascript/api";
```

## Frontend

The frontend entrypoint default-exports `javascriptIntegration`, which keeps the existing integration id as `code` so saved workflows continue to resolve their node type.

The integration uses `@playrunner/integration-sdk` for config field layout and host-provided UI primitives. It uses the `Code2` icon from `lucide-react`, so it does not need a packaged image asset.

The package declares its `code` ID plus the `.` frontend and `./api` surfaces in
its own manifest, and each entrypoint default-exports its contribution. Frontend
and API builds discover those surfaces from installed direct production
dependencies and generate static imports; no shared registry edit is required.

## API

The API entrypoint default-exports `javascriptApiContribution`, containing the
empty `javascriptRouter` and its `/api/javascript` mount path. The current
JavaScript node has no backend endpoints, but JavaScript still exposes an API
entrypoint so all integrations have the same frontend/API shape.
