# @playrunner/playwright

Playwright workflow-node configuration and runner settings for Playrunner.

## Install

```bash
npm install @playrunner/playwright @playrunner/github
```

Add both packages as direct production dependencies of the Playrunner frontend and API. The Playwright UI uses `@playrunner/github` for repository authentication.

## Package surfaces

- `@playrunner/playwright` exports the Playwright integration and runner configuration panel.
- `@playrunner/playwright/api` exports the API contribution mounted at `/api/playwright`.
- `@playrunner/playwright/assets/playwright.svg` exports the package-owned icon.
- Playwright execution remains host-managed by the Playrunner runner infrastructure.

```ts
import playwrightIntegration, {
  PlaywrightConfigPanel,
} from '@playrunner/playwright';
import playwrightApiContribution from '@playrunner/playwright/api';
```

## Documentation

See the [Playwright integration documentation](https://playrunner.dev/docs/integration-packages/playwright/) for repository setup, runner configuration, exports, and execution behavior.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
