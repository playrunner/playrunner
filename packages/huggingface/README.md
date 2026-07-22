# @playrunner/huggingface

Hugging Face Inference Providers execution for Playrunner workflows.

[![npm version](https://img.shields.io/npm/v/@playrunner/huggingface.svg)](https://www.npmjs.com/package/@playrunner/huggingface)

[View source on GitHub](https://github.com/playrunner/playrunner/tree/main/packages/huggingface)

## Install

```bash
npm install @playrunner/huggingface
```

Add the package as a direct production dependency of the Playrunner frontend
and orchestrator. Each build discovers the contribution declared for its
surface.

## Package surfaces

- `@playrunner/huggingface` exports the Hugging Face integration,
  configuration panel, settings UI, and icon URL.
- `@playrunner/huggingface/orchestrator` exports the Inference Providers
  executor.
- `@playrunner/huggingface/e2e` exports the package-owned E2E contribution.
- `@playrunner/huggingface/assets/huggingface.svg` exports the package-owned
  icon asset.

```ts
import huggingFaceIntegration, {
  HuggingFaceConfigPanel,
  HuggingFaceSettingsModal,
  huggingFaceIconUrl,
} from '@playrunner/huggingface';
import huggingFaceOrchestratorContribution from '@playrunner/huggingface/orchestrator';
```

## Testing

Run the package checks and unit tests from the repository root:

```bash
npm run format:check --prefix packages/huggingface
npm run lint --prefix packages/huggingface
npm run typecheck --prefix packages/huggingface
npm test --prefix packages/huggingface
npm run test:e2e:mock -- --grep @huggingface
```

The E2E scenario persists and removes a Hugging Face access token. It runs in
deterministic mock mode through the shared Playrunner browser harness, which
uses the real frontend, API, authentication, and dedicated E2E database. No
Hugging Face credentials or live inference requests are required.

## Documentation

See the
[Hugging Face integration documentation](https://playrunner.dev/docs/integration-packages/huggingface/)
for token setup, task configuration, outputs, exports, and Playrunner build
integration.

## License

Licensed under the
[Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
