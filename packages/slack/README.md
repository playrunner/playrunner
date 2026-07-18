# @playrunner/slack

Slack OAuth, incoming webhooks, channel selection, and workflow notifications for Playrunner.

## Install

```bash
npm install @playrunner/slack
```

Add the package as a direct production dependency of the Playrunner frontend, API, and orchestrator. Each build discovers the contribution declared for its surface.

## Package surfaces

- `@playrunner/slack` exports the Slack integration, configuration panel, and settings UI.
- `@playrunner/slack/api` exports OAuth and channel API routes.
- `@playrunner/slack/orchestrator` exports webhook and Bot API executors.
- `@playrunner/slack/assets/slack.svg` exports the package-owned icon.

```ts
import slackIntegration, { SlackSettingsModal } from '@playrunner/slack';
import slackApiContribution from '@playrunner/slack/api';
import slackOrchestratorContribution from '@playrunner/slack/orchestrator';
```

## Documentation

See the [Slack integration documentation](https://playrunner.dev/docs/integration-packages/slack/) for OAuth and webhook setup, actions, exports, and build integration.

## License

Licensed under the [Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
