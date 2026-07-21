# @playrunner/huggingface

Hugging Face Inference Providers execution for Playrunner workflows.

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

## Documentation

See the
[Hugging Face integration documentation](https://playrunner.dev/docs/integration-packages/huggingface/)
for token setup, task configuration, outputs, exports, and Playrunner build
integration.

## License

Licensed under the
[Playrunner Sustainable Use License](https://github.com/playrunner/playrunner/blob/main/LICENSE).
