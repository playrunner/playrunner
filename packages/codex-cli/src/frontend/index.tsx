import React from 'react';
import { Bot } from 'lucide-react';
import {
  IntegrationConfigField,
  type Integration,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

const CODEX_MODEL_OPTIONS = [
  {
    value: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol — Highest capability',
  },
  {
    value: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra — Balanced',
  },
  {
    value: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna — Fastest and lowest cost',
  },
  {
    value: 'gpt-5.5',
    label: 'GPT-5.5 — Previous frontier',
  },
  {
    value: 'gpt-5.4',
    label: 'GPT-5.4 — Cost-effective coding',
  },
  {
    value: 'gpt-5.3-codex',
    label: 'GPT-5.3 Codex — Coding optimized',
  },
] as const;

export const CodexCliConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  config,
  nodeId,
  onChange,
}) => {
  const { ui } = useIntegrationHost();
  const Input = ui.Input;
  const Select = ui.Select;
  const Textarea = ui.Textarea;
  const update = (field: string, value: unknown) =>
    onChange(nodeId, { ...config, [field]: value });

  const hasSavedCustomModel =
    Boolean(config.model) &&
    !CODEX_MODEL_OPTIONS.some((option) => option.value === config.model);

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs text-muted">
        Codex CLI runs non-interactively in the AI Container. Authentication is
        supplied by a Playrunner Environment secret and mapped to CODEX_API_KEY
        only inside the Codex process.
      </p>
      <IntegrationConfigField
        label="API key"
        hint="Drag an Environment secret into this field. The saved value must be a template such as {{env.OPENAI_API_KEY}}; the secret itself is never stored in this node."
      >
        <Input
          data-testid="codex-cli-api-key"
          placeholder="Drag an Environment secret here"
          value={config.apiKey || ''}
          onChange={(event) => update('apiKey', event.target.value)}
        />
      </IntegrationConfigField>
      <IntegrationConfigField
        label="Model"
        hint="Choose the OpenAI model used by Codex CLI for this agent."
      >
        <Select
          data-testid="codex-cli-model"
          value={config.model || ''}
          onChange={(event) => update('model', event.target.value)}
        >
          <option value="">Codex CLI default</option>
          {hasSavedCustomModel ? (
            <option value={config.model}>{config.model} — Saved model</option>
          ) : null}
          {CODEX_MODEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </IntegrationConfigField>
      <IntegrationConfigField label="Reasoning effort">
        <Select
          data-testid="codex-cli-reasoning-effort"
          value={config.reasoningEffort || 'high'}
          onChange={(event) => update('reasoningEffort', event.target.value)}
        >
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">Extra high</option>
        </Select>
      </IntegrationConfigField>
      <IntegrationConfigField label="Additional instructions">
        <Textarea
          data-testid="codex-cli-instructions"
          rows={4}
          placeholder="Project-specific conventions for the coding agent."
          value={config.instructions || ''}
          onChange={(event) => update('instructions', event.target.value)}
        />
      </IntegrationConfigField>
    </div>
  );
};

export const codexCliIntegration: Integration = {
  id: 'codex-cli',
  name: 'Codex CLI',
  category: 'AI & ML',
  description: 'Coding-agent capability for an AI Container',
  icon: Bot,
  color: 'text-emerald-400',
  nodeType: 'config',
  nodeSelectorOrder: 13,
  showAuthenticationPanel: false,
  showInIntegrationsPage: false,
  showInputPanel: true,
  executionRole: 'attachment',
  attachmentKind: 'agent',
  ConfigPanel: CodexCliConfigPanel,
};

export default codexCliIntegration;
