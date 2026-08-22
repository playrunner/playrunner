import React, { useEffect } from 'react';
import { Database } from 'lucide-react';
import {
  IntegrationConfigField,
  type Integration,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

const DEFAULT_CONFIG = {
  namespace: 'project',
  scope: 'project',
};

export const ProjectMemoryConfigPanel: React.FC<
  IntegrationConfigPanelProps
> = ({ config, nodeId, onChange }) => {
  const { ui } = useIntegrationHost();
  const Select = ui.Select;
  const Input = ui.Input;

  useEffect(() => {
    const normalized = {
      namespace:
        typeof config.namespace === 'string' && config.namespace.trim()
          ? config.namespace.trim()
          : DEFAULT_CONFIG.namespace,
      scope: config.scope === 'workflow' ? 'workflow' : 'project',
    };
    if (JSON.stringify(normalized) !== JSON.stringify(config)) {
      onChange(nodeId, normalized);
    }
  }, [config, nodeId, onChange]);

  const update = (field: string, value: string) =>
    onChange(nodeId, { ...config, [field]: value });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-subtle bg-[var(--background)] p-4">
        <p className="text-sm font-medium text-[var(--foreground)]">
          Playrunner Postgres
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Playrunner loads a bounded memory snapshot before execution and saves
          the validated outcome afterwards. Database credentials are never
          exposed to the AI Container.
        </p>
      </div>
      <IntegrationConfigField
        label="Scope"
        htmlFor="project-memory-scope"
        hint="Project memory is shared by workflows in this project for the same repository."
      >
        <Select
          id="project-memory-scope"
          data-testid="project-memory-scope"
          value={config.scope === 'workflow' ? 'workflow' : 'project'}
          onChange={(event) => update('scope', event.target.value)}
        >
          <option value="project">Project + repository</option>
          <option value="workflow">Workflow + repository</option>
        </Select>
      </IntegrationConfigField>
      <IntegrationConfigField
        label="Namespace"
        htmlFor="project-memory-namespace"
        hint="Use separate namespaces when the same project needs independent memory contexts."
      >
        <Input
          id="project-memory-namespace"
          data-testid="project-memory-namespace"
          maxLength={64}
          value={typeof config.namespace === 'string' ? config.namespace : ''}
          onChange={(event) => update('namespace', event.target.value)}
        />
      </IntegrationConfigField>
    </div>
  );
};

export const projectMemoryIntegration: Integration = {
  id: 'project-memory',
  name: 'Project Memory',
  category: 'AI & ML',
  description:
    'Durable project knowledge stored securely in Playrunner Postgres',
  icon: Database,
  color: 'text-emerald-400',
  nodeType: 'config',
  nodeSelectorOrder: 13,
  showAuthenticationPanel: false,
  showInIntegrationsPage: false,
  showInputPanel: false,
  executionRole: 'attachment',
  attachmentKind: 'memory',
  ConfigPanel: ProjectMemoryConfigPanel,
};

export default projectMemoryIntegration;
