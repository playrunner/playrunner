# @playrunner/github

GitHub authentication and repository access for Playrunner workflows.

[View package on npm](https://www.npmjs.com/package/@playrunner/github)

## Install

```bash
npm install @playrunner/github
```

Add the package as a direct production dependency of the Playrunner frontend and API. Playwright installations also use this package for repository authentication.

## Package surfaces

- `@playrunner/github` exports the GitHub integration, icon, and settings UI.
- `@playrunner/github/api` exports token exchange and refresh API routes.
- `@playrunner/github/assets/github.svg` exports the package-owned icon.

```ts
import githubIntegration, { GithubSettingsModal } from '@playrunner/github';
import githubApiContribution from '@playrunner/github/api';
```

## Documentation

See the [GitHub integration documentation](https://playrunner.dev/docs/integration-packages/github/) for GitHub App setup, exports, and Playrunner build integration.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
