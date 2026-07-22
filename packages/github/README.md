# @playrunner/github

GitHub authentication and repository access for Playrunner workflows.

[![npm version](https://img.shields.io/npm/v/@playrunner/github.svg)](https://www.npmjs.com/package/@playrunner/github)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/github)

## Install

```bash
npm install @playrunner/github
```

Add the package as a direct production dependency of the Playrunner frontend and API. Playwright installations also use this package for repository authentication.

## Package surfaces

- `@playrunner/github` exports the GitHub integration, icon, and settings UI.
- `@playrunner/github/api` exports token exchange and refresh API routes.
- `@playrunner/github/e2e` exports the package-owned E2E contribution.
- `@playrunner/github/assets/github.svg` exports the package-owned icon.

```ts
import githubIntegration, { GithubSettingsModal } from '@playrunner/github';
import githubApiContribution from '@playrunner/github/api';
```

## Testing

Run the package checks from the repository root:

```bash
npm run format:check --prefix packages/github
npm run lint --prefix packages/github
npm run typecheck --prefix packages/github
npm run test:e2e:mock -- --grep @github
```

The E2E scenario validates the GitHub OAuth setup form. It runs in deterministic
mock mode through the shared Playrunner browser harness, which uses the real
frontend, API, authentication, and dedicated E2E database. No GitHub
credentials or live provider requests are required.

## Documentation

See the [GitHub integration documentation](https://playrunner.dev/docs/integration-packages/github/) for GitHub App setup, exports, and Playrunner build integration.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
