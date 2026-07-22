# @playrunner/openai

OpenAI model execution and structured output for Playrunner workflows.

[![npm version](https://img.shields.io/npm/v/@playrunner/openai.svg)](https://www.npmjs.com/package/@playrunner/openai)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/openai)

## Install

```bash
npm install @playrunner/openai
```

Add the package as a direct production dependency of the Playrunner frontend,
API, and orchestrator. Each build discovers the contribution declared for its
surface.

## Package surfaces

- `@playrunner/openai` exports the OpenAI integration, theme-adaptive icon,
  configuration panel, and settings UI.
- `@playrunner/openai/api` exports the API contribution mounted at
  `/api/openai`.
- `@playrunner/openai/orchestrator` exports the OpenAI Responses API executor.
- `@playrunner/openai/e2e` exports the package-owned E2E contribution.
- `@playrunner/openai/assets/openai.svg` exports the package-owned icon asset.

```ts
import openaiIntegration, {
  OpenAIConfigPanel,
  OpenAIIcon,
  OpenAISettingsModal,
} from '@playrunner/openai';
import openaiApiContribution from '@playrunner/openai/api';
import openaiOrchestratorContribution from '@playrunner/openai/orchestrator';
```

## Testing

Run the package checks and unit tests from the repository root:

```bash
npm run format:check --prefix packages/openai
npm run lint --prefix packages/openai
npm run typecheck --prefix packages/openai
npm test --prefix packages/openai
npm run test:e2e:mock -- --grep @openai
```

The E2E scenario connects, reloads, and disconnects an OpenAI API key. It runs
in deterministic mock mode through the shared Playrunner browser harness,
which uses the real frontend, API, authentication, and dedicated E2E database.
No OpenAI credentials or live API requests are required.

## Documentation

See the
[OpenAI integration documentation](https://playrunner.dev/docs/integration-packages/openai/)
for API-key setup, node configuration, outputs, exports, and Playrunner build
integration.

## License

Licensed under the
[Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
