# @playrunner/integration-sdk

Shared contracts, host interfaces, and UI helpers for Playrunner integration packages.

## Install

```bash
npm install @playrunner/integration-sdk
```

Integration packages normally declare the SDK as a peer dependency. The consuming Playrunner frontend, API, or orchestrator must provide the matching SDK version directly.

## Package surfaces

- `@playrunner/integration-sdk` and `@playrunner/integration-sdk/frontend` expose frontend contracts, the host provider, connection inputs, setup helpers, and settings-modal primitives.
- `@playrunner/integration-sdk/api` exposes API contribution contracts and helpers.
- `@playrunner/integration-sdk/orchestrator` exposes the versioned orchestrator executor contract.

```ts
import {
  IntegrationConfigField,
  IntegrationSdkProvider,
  useIntegrationHost,
} from '@playrunner/integration-sdk';
import { createApiContribution } from '@playrunner/integration-sdk/api';
import { createOrchestratorContribution } from '@playrunner/integration-sdk/orchestrator';
```

## Documentation

See the [integration package architecture documentation](https://playrunner.dev/docs/local-dev/integrations/package-architecture/) for package metadata, host selection, and contribution composition.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
