# @playrunner/jira

Jira OAuth, issue actions, and workflow execution for Playrunner.

[View package on npm](https://www.npmjs.com/package/@playrunner/jira)

## Install

```bash
npm install @playrunner/jira
```

Add the package as a direct production dependency of the Playrunner frontend, API, and orchestrator. Each build discovers the contribution declared for its surface.

## Package surfaces

- `@playrunner/jira` exports the Jira integration, configuration panel, and settings UI.
- `@playrunner/jira/api` exports OAuth, token refresh, and project API routes.
- `@playrunner/jira/orchestrator` exports Jira create and update executors.
- `@playrunner/jira/assets/jira.svg` exports the package-owned icon.

```ts
import jiraIntegration, { JiraSettingsModal } from '@playrunner/jira';
import jiraApiContribution from '@playrunner/jira/api';
import jiraOrchestratorContribution from '@playrunner/jira/orchestrator';
```

## Documentation

See the [Jira integration documentation](https://playrunner.dev/docs/integration-packages/jira/) for Atlassian OAuth setup, actions, exports, and build integration.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
