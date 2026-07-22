# @playrunner/gcp

Google Cloud credentials, Cloud Run workflow execution, GCS output handling, Pub/Sub events, and scheduler support for Playrunner.

[![npm version](https://img.shields.io/npm/v/@playrunner/gcp.svg)](https://www.npmjs.com/package/@playrunner/gcp)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/gcp)

## Install

```bash
npm install @playrunner/gcp
```

Add the package as a direct production dependency of the Playrunner frontend and API. The API host also imports `@playrunner/gcp/api-runtime` when GCP runtime support is enabled.

## Package surfaces

- `@playrunner/gcp` exports the GCP integration, cloud provider, and settings UI.
- `@playrunner/gcp/api` exports OAuth API routes.
- `@playrunner/gcp/api-runtime` exports the GCP runtime contribution and backend implementations.
- `@playrunner/gcp/e2e` exports the package-owned E2E contribution.
- `@playrunner/gcp/assets/gcp.svg` exports the package-owned icon.

```ts
import gcpIntegration, { gcpCloudProvider } from '@playrunner/gcp';
import gcpApiContribution from '@playrunner/gcp/api';
import { createGcpApiRuntimeContribution } from '@playrunner/gcp/api-runtime';
```

## Testing

Run the package checks from the repository root:

```bash
npm run format:check --prefix packages/gcp
npm run lint --prefix packages/gcp
npm run typecheck --prefix packages/gcp
npm run test:e2e:mock -- --grep @gcp
```

The E2E scenario validates the GCP OAuth setup wizard. It runs in deterministic
mock mode through the shared Playrunner browser harness, which uses the real
frontend, API, authentication, and dedicated E2E database. No Google Cloud
credentials or live provider requests are required.

## Documentation

See the [GCP integration documentation](https://playrunner.dev/docs/integration-packages/gcp/) for authentication, settings, exports, and runtime wiring.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
