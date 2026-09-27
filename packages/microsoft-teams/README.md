# @playrunner/microsoft-teams

Microsoft Teams OAuth, team and channel selection, and templated channel
notifications for Playrunner. Requires a work or school Teams account;
personal Teams Free accounts are not supported.

[![npm version](https://img.shields.io/npm/v/@playrunner/microsoft-teams.svg)](https://www.npmjs.com/package/@playrunner/microsoft-teams)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/microsoft-teams)

## Install

```bash
npm install @playrunner/microsoft-teams
```

Add the package as a direct production dependency of the Playrunner frontend,
API, and orchestrator. Each build discovers its declared contribution surface.
The host provides `@playrunner/integration-sdk`; frontend hosts also provide
React and Lucide, and the E2E harness provides `@playwright/test`.

## Package surfaces

- `@playrunner/microsoft-teams` and `@playrunner/microsoft-teams/frontend` export the integration,
  configuration panel, and settings UI.
- `@playrunner/microsoft-teams/api` exports OAuth, token refresh, and discovery routes
  mounted at `/api/microsoft-teams`.
- `@playrunner/microsoft-teams/orchestrator` exports the channel-message executor.
- `@playrunner/microsoft-teams/e2e` exports the package-owned E2E contribution.
- `@playrunner/microsoft-teams/assets/microsoft-teams.svg` exports the package-owned icon.

```ts
import teamsIntegration, {
  TeamsSettingsModal,
} from '@playrunner/microsoft-teams';
import teamsApiContribution from '@playrunner/microsoft-teams/api';
import teamsOrchestratorContribution from '@playrunner/microsoft-teams/orchestrator';
```

## Configuration

Connect through an Entra app registration with delegated permissions, then
select a team and channel in the node configuration. The required message
supports shared workflow and environment variables. Execution sends a plain-text
channel message as the connected user and returns its `messageId`.

## Development checks

From the repository root:

```bash
npm run format:check --prefix packages/microsoft-teams
npm run lint --prefix packages/microsoft-teams
npm run typecheck --prefix packages/microsoft-teams
npm test --prefix packages/microsoft-teams
```

## Documentation

See the [Microsoft Teams integration guide](https://playrunner.dev/docs/integration-packages/microsoft-teams/)
for account requirements, Entra setup, permissions, node configuration, and
troubleshooting.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
