# @playrunner/slack

Slack OAuth, incoming webhooks, channel selection, and workflow notifications for Playrunner.

[![npm version](https://img.shields.io/npm/v/@playrunner/slack.svg)](https://www.npmjs.com/package/@playrunner/slack)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/slack)

## Install

```bash
npm install @playrunner/slack
```

Add the package as a direct production dependency of the Playrunner frontend, API, and orchestrator. Each build discovers the contribution declared for its surface.

## Package surfaces

- `@playrunner/slack` exports the Slack integration, configuration panel, and settings UI.
- `@playrunner/slack/api` exports OAuth and channel API routes.
- `@playrunner/slack/orchestrator` exports webhook and Bot API executors.
- `@playrunner/slack/e2e` exports the package-owned E2E contribution.
- `@playrunner/slack/assets/slack.svg` exports the package-owned icon.

```ts
import slackIntegration, { SlackSettingsModal } from '@playrunner/slack';
import slackApiContribution from '@playrunner/slack/api';
import slackOrchestratorContribution from '@playrunner/slack/orchestrator';
```

## Testing

Run the package checks from the repository root:

```bash
npm run format:check --prefix packages/slack
npm run lint --prefix packages/slack
npm run typecheck --prefix packages/slack
npm run test:e2e:mock -- --grep @slack
```

The E2E scenario persists and removes a Slack webhook connection. It runs in
deterministic mock mode through the shared Playrunner browser harness, which
uses the real frontend, API, authentication, and dedicated E2E database. No
Slack credentials or live provider requests are required.

## Documentation

See the [Slack integration documentation](https://playrunner.dev/docs/integration-packages/slack/) for OAuth and webhook setup, actions, exports, and build integration.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
