---
sidebar_position: 5
sidebar_label: Environment
title: Environment Integration
---

# Environment Integration

`@playrunner/environment` contains the built-in environment variable config node and shared environment variable table.

## Install

```bash
npm install @playrunner/environment
```

npm: [@playrunner/environment](https://www.npmjs.com/package/@playrunner/environment) (placeholder until published)

## Exports

```ts
import {
  environmentIntegration,
  EnvironmentConfigPanel,
  VariablesTable,
} from "@playrunner/environment";
import type { EnvVar, SavedEnvironment } from "@playrunner/environment";
import { environmentRouter } from "@playrunner/environment/api";
```

## Frontend

The frontend entrypoint exports `environmentIntegration`, which keeps the existing integration id as `environment` so saved workflows continue to resolve their config nodes.

The integration uses `@playrunner/integration-sdk` for host-provided auth, persistence, and UI primitives. The host app registers Environment in `apps/frontend/src/integrations/registry.ts`, and the Environments page reuses the package's `VariablesTable` and environment types.

## API

The API entrypoint exports an empty `environmentRouter`, mounted by the host API at `/api/environment`. Environment persistence still uses the shared store routes under `/api/store/environments`.

## Assets

Environment uses the `Settings` icon from `lucide-react`, so it does not need a packaged image asset.
