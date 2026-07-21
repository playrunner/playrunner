import React from 'react';
import {
  IntegrationConfigField,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

const DEFAULT_MODEL = 'gpt-5.6';
const DEFAULT_PROMPT = 'Summarize {{workflow.definition.name}}.';

export const OpenAIConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  config,
  onChange,
  nodeId,
}) => {
  const { ui } = useIntegrationHost();
  const Input = ui.Input;
  const Select = ui.Select;
  const Textarea = ui.Textarea;
  const responseFormat = config.responseFormat || 'text';

  const updateConfig = (next: Record<string, unknown>) => {
    onChange(nodeId, { ...config, ...next });
  };

  return (
    <div className="space-y-4">
      <IntegrationConfigField
        label="Model"
        hint="The gpt-5.6 alias tracks OpenAI's flagship GPT-5.6 Sol model."
      >
        <Select
          value={config.model || DEFAULT_MODEL}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            updateConfig({ model: event.target.value });
          }}
        >
          <option value="gpt-5.6">GPT-5.6 (flagship alias)</option>
          <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
          <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
        </Select>
      </IntegrationConfigField>

      <IntegrationConfigField
        label="Prompt"
        hint="Drag workflow or upstream-node variables from the Input panel."
      >
        <Textarea
          value={config.prompt ?? DEFAULT_PROMPT}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            updateConfig({ prompt: event.target.value });
          }}
          placeholder="Summarize why {{workflow.definition.name}} failed."
          className="min-h-[160px]"
        />
      </IntegrationConfigField>

      <IntegrationConfigField label="Response format">
        <Select
          value={responseFormat}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            updateConfig({ responseFormat: event.target.value });
          }}
        >
          <option value="text">Text</option>
          <option value="json_schema">Structured JSON</option>
        </Select>
      </IntegrationConfigField>

      {responseFormat === 'json_schema' ? (
        <IntegrationConfigField
          label="JSON Schema"
          hint="Enter a JSON Schema object. Strict structured output is enabled."
        >
          <Textarea
            value={config.jsonSchema || ''}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
              updateConfig({ jsonSchema: event.target.value });
            }}
            placeholder={
              '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}'
            }
            className="min-h-[180px] font-mono text-xs"
          />
        </IntegrationConfigField>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <IntegrationConfigField
          label="Reasoning effort"
          hint="Use low for latency or higher levels for harder analysis."
        >
          <Select
            value={config.reasoningEffort || 'medium'}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              updateConfig({ reasoningEffort: event.target.value });
            }}
          >
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">Extra high</option>
            <option value="max">Maximum</option>
          </Select>
        </IntegrationConfigField>

        <IntegrationConfigField label="Verbosity">
          <Select
            value={config.verbosity || 'medium'}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              updateConfig({ verbosity: event.target.value });
            }}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </IntegrationConfigField>
      </div>

      <IntegrationConfigField
        label="Maximum output tokens"
        hint="Optional. Leave blank to use the model default."
      >
        <Input
          type="number"
          min={1}
          max={128000}
          value={config.maxOutputTokens || ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            updateConfig({ maxOutputTokens: event.target.value });
          }}
          placeholder="4096"
        />
      </IntegrationConfigField>
    </div>
  );
};
