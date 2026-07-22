# @playrunner/playwright

Playwright workflow-node configuration and runner settings for Playrunner.

[![npm version](https://img.shields.io/npm/v/@playrunner/playwright.svg)](https://www.npmjs.com/package/@playrunner/playwright)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/playwright)

## Install

```bash
npm install @playrunner/playwright @playrunner/github
```

Add both packages as direct production dependencies of the Playrunner frontend and API. The Playwright UI uses `@playrunner/github` for repository authentication.

## Package surfaces

- `@playrunner/playwright` exports the Playwright integration and runner configuration panel.
- `@playrunner/playwright/api` exports the API contribution mounted at `/api/playwright`.
- `@playrunner/playwright/e2e` exports the package-owned E2E contribution.
- `@playrunner/playwright/assets/playwright.svg` exports the package-owned icon.
- Playwright execution remains host-managed by the Playrunner runner infrastructure.

```ts
import playwrightIntegration, {
  PlaywrightConfigPanel,
} from '@playrunner/playwright';
import playwrightApiContribution from '@playrunner/playwright/api';
```

## Testing

Run the package checks from the repository root:

```bash
npm run format:check --prefix packages/playwright
npm run lint --prefix packages/playwright
npm run typecheck --prefix packages/playwright
npm run test:e2e:mock -- --grep @playwright
```

The E2E scenario composes Playwright as a node-only integration. It runs in
deterministic mock mode through the shared Playrunner browser harness, which
uses the real frontend, API, authentication, and dedicated E2E database. It
does not execute a workflow or require a GitHub connection.

## Documentation

See the [Playwright integration documentation](https://playrunner.dev/docs/integration-packages/playwright/) for repository setup, runner configuration, exports, and execution behavior.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
