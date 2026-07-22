# @playrunner/integration-sdk

Shared contracts, host interfaces, and UI helpers for Playrunner integration packages.

[![npm version](https://img.shields.io/npm/v/@playrunner/integration-sdk.svg)](https://www.npmjs.com/package/@playrunner/integration-sdk)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/integration-sdk)

## Install

```bash
npm install @playrunner/integration-sdk
```

Integration packages normally declare the SDK as a peer dependency. The consuming Playrunner frontend, API, or orchestrator must provide the matching SDK version directly.

## Package surfaces

- `@playrunner/integration-sdk` and `@playrunner/integration-sdk/frontend` expose frontend contracts, the host provider, connection inputs, setup helpers, and settings-modal primitives.
- `@playrunner/integration-sdk/api` exposes API contribution contracts and helpers.
- `@playrunner/integration-sdk/orchestrator` exposes the versioned orchestrator executor contract.
- `@playrunner/integration-sdk/e2e` exposes the package-owned scenario, data,
  page-object, and host contracts used by the shared browser harness.

```ts
import {
  IntegrationConfigField,
  IntegrationSdkProvider,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { createApiContribution } from '@playrunner/integration-sdk/api';
import { createOrchestratorContribution } from '@playrunner/integration-sdk/orchestrator';
```

## Testing

Run the SDK checks and integration-composition test from the repository root:

```bash
npm run format:check --prefix packages/integration-sdk
npm run lint --prefix packages/integration-sdk
npm run typecheck --prefix packages/integration-sdk
npm run test:integration-composition
npm run test:e2e:mock
```

The SDK does not register a provider scenario of its own. The mock E2E suite
exercises its contracts through every installed package contribution while
using the real Playrunner frontend, API, authentication, and dedicated E2E
database.

## Documentation

See the [integration package architecture documentation](https://playrunner.dev/docs/local-dev/integrations/package-architecture/) for package metadata, host selection, and contribution composition.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
