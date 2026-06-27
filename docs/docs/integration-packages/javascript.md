---
sidebar_position: 3
title: JavaScript Package
---

# JavaScript Package

`@playrunner/javascript` contains the built-in JavaScript code node.

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

The package uses `@playrunner/integration-sdk` for config field layout and host-provided UI primitives. It uses the `Code2` icon from `lucide-react`, so it does not need a packaged image asset.

The host app registers JavaScript in `apps/frontend/src/integrations/registry.ts`.

## API

The API entrypoint exports an empty `javascriptRouter`, mounted by the host API at `/api/javascript`. The current JavaScript node has no backend endpoints, but the package still exposes an API entrypoint so all integration packages have the same frontend/API shape.
