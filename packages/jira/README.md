# @playrunner/jira

Jira OAuth, issue actions, and workflow execution for Playrunner.

[![npm version](https://img.shields.io/npm/v/@playrunner/jira.svg)](https://www.npmjs.com/package/@playrunner/jira)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/jira)

## Install

```bash
npm install @playrunner/jira
```

Add the package as a direct production dependency of the Playrunner frontend, API, and orchestrator. Each build discovers the contribution declared for its surface.

## Package surfaces

- `@playrunner/jira` exports the Jira integration, configuration panel, and settings UI.
- `@playrunner/jira/api` exports OAuth, token refresh, and project API routes.
- `@playrunner/jira/orchestrator` exports Jira create and update executors.
- `@playrunner/jira/e2e` exports the package-owned E2E contribution.
- `@playrunner/jira/assets/jira.svg` exports the package-owned icon.

```ts
import jiraIntegration, { JiraSettingsModal } from '@playrunner/jira';
import jiraApiContribution from '@playrunner/jira/api';
import jiraOrchestratorContribution from '@playrunner/jira/orchestrator';
```

## Testing

Run the package checks from the repository root:

```bash
npm run format:check --prefix packages/jira
npm run lint --prefix packages/jira
npm run typecheck --prefix packages/jira
npm run test:e2e:mock -- --grep @jira
```

The E2E scenario validates the Jira OAuth setup form. It runs in deterministic
mock mode through the shared Playrunner browser harness, which uses the real
frontend, API, authentication, and dedicated E2E database. No Atlassian
credentials or live provider requests are required.

## Documentation

See the [Jira integration documentation](https://playrunner.dev/docs/integration-packages/jira/) for Atlassian OAuth setup, actions, exports, and build integration.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
