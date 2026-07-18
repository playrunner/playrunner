# @playrunner/gcp

Google Cloud credentials, Cloud Run workflow execution, GCS output handling, Pub/Sub events, and scheduler support for Playrunner.

## Install

```bash
npm install @playrunner/gcp
```

Add the package as a direct production dependency of the Playrunner frontend and API. The API host also imports `@playrunner/gcp/api-runtime` when GCP runtime support is enabled.

## Package surfaces

- `@playrunner/gcp` exports the GCP integration, cloud provider, and settings UI.
- `@playrunner/gcp/api` exports OAuth API routes.
- `@playrunner/gcp/api-runtime` exports the GCP runtime contribution and backend implementations.
- `@playrunner/gcp/assets/gcp.svg` exports the package-owned icon.

```ts
import gcpIntegration, { gcpCloudProvider } from '@playrunner/gcp';
import gcpApiContribution from '@playrunner/gcp/api';
import { createGcpApiRuntimeContribution } from '@playrunner/gcp/api-runtime';
```

## Documentation

See the [GCP integration documentation](https://playrunner.dev/docs/integration-packages/gcp/) for authentication, settings, exports, and runtime wiring.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
