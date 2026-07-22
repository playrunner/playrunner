# @playrunner/environment

Environment-variable configuration for Playrunner workflows.

[![npm version](https://img.shields.io/npm/v/@playrunner/environment.svg)](https://www.npmjs.com/package/@playrunner/environment)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/environment)

## Install

```bash
npm install @playrunner/environment
```

Add the package as a direct production dependency of the Playrunner frontend and API. Their build steps discover the package's `playrunner.integration` metadata and bundle its frontend and API contributions.

## Package surfaces

- `@playrunner/environment` exports the Environment integration, configuration panel, variables table, and environment types.
- `@playrunner/environment/api` exports the API contribution mounted at `/api/environment`.
- `@playrunner/environment/e2e` exports the package-owned E2E contribution.
- The integration id is `environment`.

```ts
import environmentIntegration, {
  EnvironmentConfigPanel,
  VariablesTable,
} from '@playrunner/environment';
import environmentApiContribution from '@playrunner/environment/api';
```

## Testing

Run the package checks from the repository root:

```bash
npm run format:check --prefix packages/environment
npm run lint --prefix packages/environment
npm run typecheck --prefix packages/environment
npm run test:e2e:mock -- --grep @environment
```

The E2E scenario composes Environment as a configuration-only integration. It
runs in deterministic mock mode through the shared Playrunner browser harness,
which uses the real frontend, API, authentication, and dedicated E2E database.
No provider credentials are required.

## Documentation

See the [Environment integration documentation](https://playrunner.dev/docs/integration-packages/environment/) for exports, behavior, and Playrunner build integration.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
