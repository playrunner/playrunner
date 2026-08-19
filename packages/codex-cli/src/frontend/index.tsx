import React from 'react';
import { Bot, X } from 'lucide-react';
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

  const selectApiKeyEnvironmentVariable = (value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      update('apiKeyEnvVar', '');
      return;
    }
    const key = normalized.startsWith('process.env.')
      ? normalized.slice('process.env.'.length)
      : normalized.startsWith('env.')
        ? normalized.slice('env.'.length)
        : normalized;
    if (key) update('apiKeyEnvVar', key);
  };

  const handleApiKeyDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    selectApiKeyEnvironmentVariable(event.dataTransfer.getData('text/plain'));
  };
  const hasSavedCustomModel =
    Boolean(config.model) &&
    !CODEX_MODEL_OPTIONS.some((option) => option.value === config.model);

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs text-muted">
        Codex CLI runs non-interactively in the AI Container. Authentication is
        supplied by a Playrunner Environment value and mapped to CODEX_API_KEY
        for the Codex process.
      </p>
      <IntegrationConfigField
        label="API key environment variable"
        hint="Connect an Environment node to the AI Container, then drag its secret here. The secret value is never stored in this node."
      >
        <div
          data-testid="codex-cli-api-key-env-var-dropzone"
          className="min-h-20 rounded-lg border border-dashed border-subtle bg-[var(--background)] p-3"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleApiKeyDrop}
        >
          {config.apiKeyEnvVar ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-subtle bg-[var(--node-bg)] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-xs text-blue-400">
                  env.{config.apiKeyEnvVar}
                </div>
                <div className="mt-1 text-[10px] text-muted">
                  Mapped for Codex as CODEX_API_KEY
                </div>
              </div>
              <button
                type="button"
                data-testid="codex-cli-api-key-env-var-clear"
                className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-red-400"
                title="Remove API key environment variable"
                onClick={() => update('apiKeyEnvVar', '')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex min-h-14 items-center justify-center text-center text-xs text-muted">
              Drag an Environment secret from the Input panel here
            </div>
          )}
        </div>
        <Input
          data-testid="codex-cli-api-key-env-var"
          className="mt-2"
          placeholder="Or enter the variable name, e.g. OPENAI_API_KEY"
          value={config.apiKeyEnvVar || ''}
          onChange={(event) =>
            selectApiKeyEnvironmentVariable(event.target.value)
          }
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
