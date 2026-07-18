# @playrunner/environment

Environment-variable configuration for Playrunner workflows.

## Install

```bash
npm install @playrunner/environment
```

Add the package as a direct production dependency of the Playrunner frontend and API. Their build steps discover the package's `playrunner.integration` metadata and bundle its frontend and API contributions.

## Package surfaces

- `@playrunner/environment` exports the Environment integration, configuration panel, variables table, and environment types.
- `@playrunner/environment/api` exports the API contribution mounted at `/api/environment`.
- The integration id is `environment`.

```ts
import environmentIntegration, {
  EnvironmentConfigPanel,
  VariablesTable,
} from '@playrunner/environment';
import environmentApiContribution from '@playrunner/environment/api';
```

## Documentation

See the [Environment integration documentation](https://playrunner.dev/docs/integration-packages/environment/) for exports, behavior, and Playrunner build integration.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
