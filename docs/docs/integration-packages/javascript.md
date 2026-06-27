---
sidebar_position: 3
sidebar_label: JavaScript
title: JavaScript Integration
---

# JavaScript Integration

`@playrunner/javascript` contains the built-in JavaScript code node.

## Install

```bash
npm install @playrunner/javascript
```

npm: [@playrunner/javascript](https://www.npmjs.com/package/@playrunner/javascript) (placeholder until published)

## Exports

```ts
import {
  javascriptIntegration,
  JavascriptConfigPanel,
} from "@playrunner/javascript";
import { javascriptRouter } from "@playrunner/javascript/api";
```

## Frontend

The frontend entrypoint exports `javascriptIntegration`, which keeps the existing integration id as `code` so saved workflows continue to resolve their node type.

The integration uses `@playrunner/integration-sdk` for config field layout and host-provided UI primitives. It uses the `Code2` icon from `lucide-react`, so it does not need a packaged image asset.

The host app registers JavaScript in `apps/frontend/src/integrations/registry.ts`.

## API

The API entrypoint exports an empty `javascriptRouter`, mounted by the host API at `/api/javascript`. The current JavaScript node has no backend endpoints, but JavaScript still exposes an API entrypoint so all integrations have the same frontend/API shape.
