import React from 'react';
import {
  IntegrationConfigField,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

const TASK_DEFAULTS = {
  'text-generation': {
    model: 'google/gemma-2-2b-it',
    parameters: '{\n  "max_new_tokens": 256,\n  "return_full_text": false\n}',
  },
  'text-classification': {
    model: 'distilbert/distilbert-base-uncased-finetuned-sst-2-english',
    parameters: '{\n  "top_k": 5\n}',
  },
  'feature-extraction': {
    model: 'thenlper/gte-large',
    parameters: '{\n  "normalize": true\n}',
  },
} as const;

type HuggingFaceTask = keyof typeof TASK_DEFAULTS;

function isTask(value: unknown): value is HuggingFaceTask {
  return typeof value === 'string' && value in TASK_DEFAULTS;
}

export const HuggingFaceConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  config,
  onChange,
  nodeId,
}) => {
  const { ui } = useIntegrationHost();
  const Input = ui.Input;
  const Select = ui.Select;
  const Textarea = ui.Textarea;
  const task = isTask(config.action) ? config.action : 'text-generation';
  const defaults = TASK_DEFAULTS[task];

  const updateConfig = (next: Record<string, unknown>) => {
    onChange(nodeId, { ...config, ...next });
  };

  return (
    <div className="space-y-4">
      <IntegrationConfigField label="Task">
        <Select
          value={task}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            const nextTask = event.target.value as HuggingFaceTask;
            updateConfig({
              action: nextTask,
              model: TASK_DEFAULTS[nextTask].model,
              parameters: TASK_DEFAULTS[nextTask].parameters,
            });
          }}
        >
          <option value="text-generation">Text generation</option>
          <option value="text-classification">Text classification</option>
          <option value="feature-extraction">Feature extraction</option>
        </Select>
      </IntegrationConfigField>

      <IntegrationConfigField
        label="Inference provider"
        hint="Auto follows the provider order configured in your Hugging Face account."
      >
        <Select
          value={config.provider || 'auto'}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            updateConfig({ provider: event.target.value });
          }}
        >
          <option value="auto">Auto</option>
          <option value="hf-inference">HF Inference</option>
          <option value="cerebras">Cerebras</option>
          <option value="deepinfra">DeepInfra</option>
          <option value="featherless-ai">Featherless AI</option>
          <option value="fireworks-ai">Fireworks AI</option>
          <option value="groq">Groq</option>
          <option value="together">Together</option>
        </Select>
      </IntegrationConfigField>

      <IntegrationConfigField
        label="Model"
        hint="Enter a model ID from the Hugging Face Hub."
      >
        <Input
          value={config.model || defaults.model}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            updateConfig({ model: event.target.value });
          }}
          placeholder={defaults.model}
        />
      </IntegrationConfigField>

      <IntegrationConfigField
        label="Input"
        hint="Drag workflow or upstream-node variables from the Input panel."
      >
        <Textarea
          value={config.input ?? ''}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            updateConfig({ input: event.target.value });
          }}
          placeholder="Analyze {{node_previous.result.data}}"
          className="min-h-[160px]"
        />
      </IntegrationConfigField>

      <IntegrationConfigField
        label="Parameters"
        hint="Optional JSON parameters supported by the selected task and model."
      >
        <Textarea
          value={config.parameters ?? defaults.parameters}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            updateConfig({ parameters: event.target.value });
          }}
          placeholder={defaults.parameters}
          className="min-h-[140px] font-mono text-xs"
        />
      </IntegrationConfigField>
    </div>
  );
};
