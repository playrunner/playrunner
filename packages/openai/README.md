# @playrunner/openai

OpenAI model execution and structured output for Playrunner workflows.

[View package on npm](https://www.npmjs.com/package/@playrunner/openai)

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

## Documentation

See the
[OpenAI integration documentation](https://playrunner.dev/docs/integration-packages/openai/)
for API-key setup, node configuration, outputs, exports, and Playrunner build
integration.

## License

Licensed under the
[Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
