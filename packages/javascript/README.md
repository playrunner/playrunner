# @playrunner/javascript

JavaScript workflow-node configuration for Playrunner.

[![npm version](https://img.shields.io/npm/v/@playrunner/javascript.svg)](https://www.npmjs.com/package/@playrunner/javascript)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/javascript)

## Install

```bash
npm install @playrunner/javascript
```

Add the package as a direct production dependency of the Playrunner frontend and API. This release provides the configuration UI and API contribution; JavaScript execution is not yet implemented in the orchestrator.

## Package surfaces

- `@playrunner/javascript` exports the JavaScript integration and configuration panel.
- `@playrunner/javascript/api` exports the API contribution mounted at `/api/javascript`.
- `@playrunner/javascript/e2e` exports the package-owned E2E contribution.
- The integration id is `code`.

```ts
import javascriptIntegration, {
  JavascriptConfigPanel,
} from '@playrunner/javascript';
import javascriptApiContribution from '@playrunner/javascript/api';
```

## Testing

Run the package checks from the repository root:

```bash
npm run format:check --prefix packages/javascript
npm run lint --prefix packages/javascript
npm run typecheck --prefix packages/javascript
npm run test:e2e:mock -- --grep @code
```

The E2E scenario composes JavaScript Code as a configuration-only integration.
It runs in deterministic mock mode through the shared Playrunner browser
harness, which uses the real frontend, API, authentication, and dedicated E2E
database. No provider credentials are required.

## Documentation

See the [JavaScript integration documentation](https://playrunner.dev/docs/integration-packages/javascript/) for current execution status, exports, and build integration.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
