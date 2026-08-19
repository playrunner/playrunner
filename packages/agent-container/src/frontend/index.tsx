import React, { useEffect } from 'react';
import { Bot, Container } from 'lucide-react';
import { GithubSettingsModal } from '@playrunner/github';
import {
  IntegrationConfigField,
  type Integration,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

const DEFAULT_CONFIG = {
  branch: 'main',
  cpu: 4,
  folder: '.',
  maxValidationAttempts: 3,
  memory: 8,
};

export const AgentContainerConfigPanel: React.FC<
  IntegrationConfigPanelProps
> = ({
  config,
  nodeId,
  onChange,
  isConnected,
  integrationData,
  onConnectOAuth,
}) => {
  const { auth, ui } = useIntegrationHost();
  const Input = ui.Input;
  const Select = ui.Select;
  const Textarea = ui.Textarea;
  const [repositories, setRepositories] = React.useState<
    { id: string; full_name: string }[]
  >([]);
  const [branches, setBranches] = React.useState<
    { id: string; name: string }[]
  >([]);
  const [isLoadingRepos, setIsLoadingRepos] = React.useState(false);
  const [isLoadingBranches, setIsLoadingBranches] = React.useState(false);
  const [repositoryError, setRepositoryError] = React.useState('');
  const [branchError, setBranchError] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<
    'config' | 'env' | 'resources'
  >('config');

  useEffect(() => {
    const missing = Object.fromEntries(
      Object.entries(DEFAULT_CONFIG).filter(([key]) => config[key] == null),
    );
    if (Object.keys(missing).length) {
      onChange(nodeId, { ...DEFAULT_CONFIG, ...config });
    }
  }, [config, nodeId, onChange]);

  useEffect(() => {
    async function fetchRepositories() {
      if (!integrationData?.credentialStatus?.configured) {
        setRepositories([]);
        return;
      }
      setIsLoadingRepos(true);
      setRepositoryError('');
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Sign in again to load repositories.');
        const response = await fetch('/api/github/repositories', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load repositories.');
        }
        setRepositories(
          Array.isArray(data.repositories) ? data.repositories : [],
        );
      } catch (error) {
        console.error('Failed to fetch repositories:', error);
        setRepositories([]);
        setRepositoryError(
          error instanceof Error
            ? error.message
            : 'Failed to load repositories.',
        );
      } finally {
        setIsLoadingRepos(false);
      }
    }
    void fetchRepositories();
  }, [auth, integrationData?.credentialStatus?.configured]);

  useEffect(() => {
    async function fetchBranches() {
      if (
        !integrationData?.credentialStatus?.configured ||
        !config.repository
      ) {
        setBranches([]);
        return;
      }
      setIsLoadingBranches(true);
      setBranchError('');
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Sign in again to load branches.');
        const response = await fetch(
          `/api/github/branches?repository=${encodeURIComponent(config.repository)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load branches.');
        }
        setBranches(Array.isArray(data.branches) ? data.branches : []);
      } catch (error) {
        console.error('Failed to fetch branches:', error);
        setBranches([]);
        setBranchError(
          error instanceof Error ? error.message : 'Failed to load branches.',
        );
      } finally {
        setIsLoadingBranches(false);
      }
    }
    void fetchBranches();
  }, [auth, config.repository, integrationData?.credentialStatus?.configured]);

  const update = (field: string, value: unknown) =>
    onChange(nodeId, { ...config, [field]: value });

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const value = event.dataTransfer.getData('text/plain').trim();
    const key = value.startsWith('process.env.')
      ? value.slice('process.env.'.length)
      : value.startsWith('env.')
        ? value.slice('env.'.length)
        : '';
    if (!key) return;
    const envVars = Array.isArray(config.envVars) ? config.envVars : [];
    if (!envVars.includes(key)) {
      update('envVars', [...envVars, key]);
    }
  };

  const tabClass = (tab: 'config' | 'env' | 'resources') =>
    `px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors focus:outline-none select-none ${
      activeTab === tab
        ? 'bg-[var(--node-bg)] text-[var(--foreground)] border border-[var(--node-border)]'
        : 'bg-[var(--control-bg)] text-muted border border-transparent hover:text-[var(--foreground)]'
    }`;

  return (
    <>
      <div className="mt-6 mb-4 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button
          type="button"
          data-testid="agent-container-tab-config"
          className={tabClass('config')}
          onClick={() => setActiveTab('config')}
        >
          Configuration
        </button>
        <button
          type="button"
          data-testid="agent-container-tab-env"
          className={tabClass('env')}
          onClick={() => setActiveTab('env')}
        >
          Environment
        </button>
        <button
          type="button"
          data-testid="agent-container-tab-resources"
          className={tabClass('resources')}
          onClick={() => setActiveTab('resources')}
        >
          Resources
        </button>
      </div>

      {activeTab === 'config' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--node-border)] bg-[var(--control-bg)] p-3 text-xs text-muted">
            Connect one Agent and at least one Validator to this node. They run
            as capabilities inside the same isolated container.
          </div>
          <IntegrationConfigField label="Task" htmlFor="agent-container-task">
            <Textarea
              id="agent-container-task"
              data-testid="agent-container-task"
              rows={5}
              placeholder="Write and improve end-to-end tests for the checkout flow."
              value={config.task || ''}
              onChange={(event) => update('task', event.target.value)}
            />
          </IntegrationConfigField>
          <div className="space-y-4 rounded-lg border border-subtle bg-[var(--background)] p-4">
            <div className="flex items-center justify-between border-b border-subtle pb-2">
              <h4 className="text-sm font-medium text-[var(--foreground)]">
                Authentication
              </h4>
              {isConnected ? (
                <button
                  type="button"
                  onClick={() => onConnectOAuth?.()}
                  className="rounded-md border border-[var(--border)] bg-[var(--control-bg)] px-3 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  Configure Connection
                </button>
              ) : (
                <select
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) {
                      onChange(nodeId, {
                        ...config,
                        authProvider: event.target.value,
                      });
                      onConnectOAuth?.(event.target.value);
                    }
                    event.target.value = '';
                  }}
                  className="appearance-none rounded-md border border-[var(--border)] bg-[var(--control-bg)] px-2 py-1 pr-4 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-hover)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-1 focus:ring-[var(--border-strong)]"
                >
                  <option value="" disabled>
                    Connect Provider...
                  </option>
                  <option value="github">GitHub</option>
                  <option value="bitbucket" disabled>
                    Bitbucket (coming soon)
                  </option>
                </select>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div
                className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}
              />
              <span className="text-sm text-[var(--foreground)]">
                {isConnected
                  ? `Connected (${config.authProvider ? config.authProvider.charAt(0).toUpperCase() + config.authProvider.slice(1) : 'GitHub'})`
                  : 'Not Connected'}
              </span>
            </div>
            <p className="text-xs text-muted">
              Connect your account so the AI Container can clone the selected
              repository.
            </p>
          </div>
          <IntegrationConfigField label="Repository">
            <Select
              data-testid="agent-container-repository"
              value={config.repository || ''}
              onChange={(event) =>
                onChange(nodeId, {
                  ...config,
                  repository: event.target.value,
                  branch: '',
                })
              }
              disabled={isLoadingRepos || !isConnected}
            >
              <option value="">
                {isLoadingRepos
                  ? 'Loading repositories...'
                  : 'Select Repository'}
              </option>
              {repositories.map((repository) => (
                <option key={repository.id} value={repository.full_name}>
                  {repository.full_name}
                </option>
              ))}
            </Select>
            {repositoryError ? (
              <p className="text-[10px] text-red-400">{repositoryError}</p>
            ) : null}
          </IntegrationConfigField>
          <IntegrationConfigField label="Branch">
            <Select
              data-testid="agent-container-branch"
              value={config.branch || ''}
              onChange={(event) => update('branch', event.target.value)}
              disabled={isLoadingBranches || !config.repository}
            >
              <option value="">
                {isLoadingBranches ? 'Loading branches...' : 'Select Branch'}
              </option>
              {branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))}
            </Select>
            {branchError ? (
              <p className="text-[10px] text-red-400">{branchError}</p>
            ) : null}
          </IntegrationConfigField>
          <IntegrationConfigField
            label="Folder"
            hint="Specific directory within the repository where the agent should work."
          >
            <Input
              data-testid="agent-container-folder"
              value={config.folder || DEFAULT_CONFIG.folder}
              onChange={(event) => update('folder', event.target.value)}
              placeholder="."
              disabled={!config.repository}
            />
          </IntegrationConfigField>
          <IntegrationConfigField
            label="Maximum validation attempts"
            hint="The supervisor resumes the same agent session with validator feedback."
            htmlFor="agent-container-attempts"
          >
            <Input
              id="agent-container-attempts"
              data-testid="agent-container-attempts"
              type="number"
              min={1}
              max={10}
              value={
                config.maxValidationAttempts ||
                DEFAULT_CONFIG.maxValidationAttempts
              }
              onChange={(event) =>
                update('maxValidationAttempts', Number(event.target.value))
              }
            />
          </IntegrationConfigField>
        </div>
      )}

      {activeTab === 'env' && (
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted">
            Injected Environment Variables
          </label>
          <div
            data-testid="agent-container-node-env-vars"
            className="relative flex min-h-[80px] flex-col gap-2 rounded-xl border-2 border-dashed border-subtle bg-surface/30 p-4 transition-colors hover:bg-surface/50"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            {!config.envVars?.length ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted">
                Drag variables from the Input panel here
              </div>
            ) : (
              <div className="relative z-10 flex flex-wrap gap-2">
                {config.envVars.map((key: string) => (
                  <div
                    key={key}
                    className="group/tag flex cursor-default items-center gap-2 rounded border border-subtle bg-surface-hover px-2 py-1"
                  >
                    <span className="font-mono text-[10px] text-muted">
                      env.{key}
                    </span>
                    <button
                      type="button"
                      className="text-muted opacity-0 transition-opacity hover:text-red-400 group-hover/tag:opacity-100"
                      title={`Remove ${key}`}
                      aria-label={`Remove ${key}`}
                      onClick={() =>
                        update(
                          'envVars',
                          config.envVars.filter(
                            (value: string) => value !== key,
                          ),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-[10px] leading-relaxed text-muted">
            These variables are injected directly into the isolated AI Container
            when the agent runs.
          </p>
        </div>
      )}

      {activeTab === 'resources' && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted">
              CPU
            </label>
            <Select
              data-testid="agent-container-cpu"
              value={config.cpu || DEFAULT_CONFIG.cpu}
              className="border-subtle bg-[var(--background)] text-sm"
              onChange={(event) => update('cpu', Number(event.target.value))}
            >
              <option value={1}>1 CPU</option>
              <option value={2}>2 CPUs</option>
              <option value={4}>4 CPUs</option>
              <option value={8}>8 CPUs</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted">
              Memory
            </label>
            <Select
              data-testid="agent-container-memory"
              value={config.memory || DEFAULT_CONFIG.memory}
              className="border-subtle bg-[var(--background)] text-sm"
              onChange={(event) => update('memory', Number(event.target.value))}
            >
              <option value={2}>2 GB</option>
              <option value={4}>4 GB</option>
              <option value={8}>8 GB</option>
              <option value={16}>16 GB</option>
              <option value={32}>32 GB</option>
            </Select>
          </div>
        </div>
      )}
    </>
  );
};

export const agentContainerIntegration: Integration = {
  id: 'agent-container',
  name: 'AI Container',
  category: 'AI & ML',
  description:
    'Run an attached coding agent and validators in one isolated Playwright container',
  icon: Container,
  color: 'text-violet-400',
  nodeType: 'action',
  nodeSelectorOrder: 12,
  showAuthenticationPanel: false,
  showInIntegrationsPage: false,
  authProviders: [{ id: 'github', label: 'GitHub' }],
  getAuthPath: (uid) => `users/${uid}/integrations/github`,
  SettingsModal: GithubSettingsModal,
  executionRole: 'workflow',
  acceptsAttachments: ['agent', 'tool'],
  ConfigPanel: AgentContainerConfigPanel,
  getOutputVariables: () => [
    { path: 'status', type: 'string', description: 'Final validation status' },
    { path: 'attempts', type: 'number', description: 'Agent attempts used' },
    { path: 'validation', type: 'object', description: 'Validator result' },
    {
      path: 'patch',
      type: 'string',
      description: 'Generated repository patch',
    },
  ],
};

export default agentContainerIntegration;
export { Bot as AgentContainerIcon };
