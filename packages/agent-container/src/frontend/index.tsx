import React, { useEffect } from 'react';
import { Bot, Container } from 'lucide-react';
import { GithubSettingsModal } from '@playrunner/github';
import {
  IntegrationConfigField,
  type Integration,
  type IntegrationConfigPanelProps,
  type IntegrationOutputVariable,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

const DEFAULT_CONFIG = {
  botPullRequestForkRepository: '',
  branch: 'main',
  cpu: 4,
  folder: '.',
  maxDurationMinutes: 30,
  maxValidationAttempts: 3,
  memory: 8,
};

const MAX_DURATION_MINUTES = 45;
const CPU_OPTIONS = [1, 2, 4, 8] as const;
const MEMORY_OPTIONS = [2, 4, 8, 16, 32] as const;

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function normalizedStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      )
    : [];
}

const OUTPUT_VARIABLES: readonly IntegrationOutputVariable[] = [
  {
    path: 'status',
    type: 'string',
    description: 'Final AI Container execution status',
  },
  {
    path: 'stopReason',
    type: 'string',
    description: 'Why the supervisor stopped the feedback loop',
  },
  {
    path: 'attempts',
    type: 'number',
    description: 'Agent and validator feedback attempts used',
  },
  {
    path: 'attemptHistory',
    type: 'array',
    description: 'Agent and validation details for every feedback-loop attempt',
  },
  {
    path: 'repositoryStatus',
    type: 'string',
    description: 'Final Git working-tree status',
  },
  {
    path: 'botPullRequest',
    type: 'object',
    description: 'Generated-test bot pull request, when changes were needed',
  },
  {
    path: 'botDelivery',
    type: 'object',
    description: 'Bot delivery status, including when no PR was necessary',
  },
  {
    path: 'botPullRequest.url',
    type: 'string',
    description: 'URL of the generated-test pull request',
  },
  {
    path: 'memory',
    type: 'object',
    description: 'Bounded durable outcome used by the next CI execution',
  },
  {
    path: 'validation',
    type: 'object',
    description: 'Authoritative structured validation report',
  },
  {
    path: 'validation.schemaVersion',
    type: 'string',
    description: 'Validation result schema version',
  },
  {
    path: 'validation.status',
    type: 'string',
    description: 'Passed or failed validation status',
  },
  {
    path: 'validation.passed',
    type: 'boolean',
    description: 'Whether every blocking validation rule passed',
  },
  {
    path: 'validation.attempt',
    type: 'number',
    description: 'Attempt that produced this validation result',
  },
  {
    path: 'validation.durationMs',
    type: 'number',
    description: 'Validation duration in milliseconds',
  },
  {
    path: 'validation.feedbackText',
    type: 'string',
    description: 'Prioritized feedback returned to the coding agent',
  },
  {
    path: 'validation.feedbackTextTruncated',
    type: 'boolean',
    description: 'Whether inline validator feedback text was shortened',
  },
  {
    path: 'validation.inlineTruncation',
    type: 'object',
    description: 'Sections compacted in the inline validation result',
  },
  {
    path: 'validation.dimensions',
    type: 'object',
    description: 'Coverage and assertion-quality threshold results',
  },
  {
    path: 'validation.dimensions.changedLineCoverage',
    type: 'object',
    description: 'Coverage threshold for executable lines changed by CI',
  },
  {
    path: 'validation.changedCoverage',
    type: 'object',
    description: 'Changed-line coverage gaps and instrumentation details',
  },
  {
    path: 'validation.requirements',
    type: 'object',
    description: 'Requirement coverage and supporting test evidence',
  },
  {
    path: 'validation.testRun',
    type: 'object',
    description: 'Clean test command result and failure details',
  },
  {
    path: 'validation.violations',
    type: 'array',
    description:
      'Reported validator findings; inspect truncation metadata for totals',
  },
  {
    path: 'validation.artifacts',
    type: 'object',
    description: 'Supervisor-owned validation artifact references',
  },
  {
    path: 'validation.artifacts.validationReport',
    type: 'string',
    description: 'Structured validation report path',
  },
  {
    path: 'validation.artifacts.coverage',
    type: 'string',
    description: 'Coverage artifact path',
  },
  {
    path: 'validation.artifacts.playwrightReport',
    type: 'string',
    description: 'Playwright HTML report path',
  },
  {
    path: 'validation.artifacts.testResults',
    type: 'string',
    description: 'Playwright test-results directory path',
  },
  {
    path: 'validation.artifacts.traces',
    type: 'array',
    description: 'Playwright trace artifact paths',
  },
  {
    path: 'artifacts',
    type: 'object',
    description: 'Final supervisor-owned artifact references',
  },
  {
    path: 'artifacts.validationHistory',
    type: 'string',
    description: 'Complete validation-attempt history report reference',
  },
  {
    path: 'artifacts.artifactsTruncated',
    type: 'boolean',
    description: 'Whether optional artifact files were omitted by bounds',
  },
  {
    path: 'artifacts.artifactTruncation',
    type: 'string',
    description: 'Artifact truncation manifest reference',
  },
  {
    path: 'artifacts.validationReport',
    type: 'string',
    description: 'Final structured validation report reference',
  },
  {
    path: 'artifacts.patch',
    type: 'string',
    description: 'Generated repository patch artifact reference',
  },
  {
    path: 'artifacts.coverage',
    type: 'string',
    description: 'Final coverage artifact reference',
  },
  {
    path: 'artifacts.playwrightReport',
    type: 'string',
    description: 'Final Playwright HTML report reference',
  },
  {
    path: 'artifacts.testResults',
    type: 'string',
    description: 'Final Playwright test-results reference',
  },
  {
    path: 'artifacts.repositoryStatus',
    type: 'string',
    description: 'Repository status artifact reference',
  },
  {
    path: 'artifacts.traces',
    type: 'array',
    description: 'Final Playwright trace artifact references',
  },
  {
    path: 'patch',
    type: 'string',
    description:
      'Inline Git patch; inspect patchTruncated and artifacts.patch for the complete result',
  },
  {
    path: 'patchBytes',
    type: 'number',
    description: 'Captured patch size in bytes',
  },
  {
    path: 'patchTruncated',
    type: 'boolean',
    description:
      'Whether the inline patch is truncated; use its artifact when true',
  },
  {
    path: 'artifactError',
    type: 'string',
    description:
      'Artifact upload error, when artifact publication did not complete',
  },
  {
    path: 'runnerError',
    type: 'string',
    description: 'Runner preparation or control error',
  },
  {
    path: 'repositoryError',
    type: 'string',
    description: 'Repository inspection or patch-capture error',
  },
  {
    path: 'deliveryError',
    type: 'string',
    description: 'Actionable bot branch or pull-request delivery error',
  },
  {
    path: 'validationTruncated',
    type: 'boolean',
    description: 'Whether the inline validation report was compacted',
  },
  {
    path: 'repositoryStatusTruncated',
    type: 'boolean',
    description: 'Whether inline repository status was shortened',
  },
];

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
  const configuredEnvVars = normalizedStringList(config.envVars);
  const configuredAuthProvider =
    typeof config.authProvider === 'string' ? config.authProvider : '';
  const configuredRepository =
    typeof config.repository === 'string' ? config.repository : '';
  const configuredForkRepository =
    typeof config.botPullRequestForkRepository === 'string'
      ? config.botPullRequestForkRepository
      : '';

  useEffect(() => {
    const normalized = {
      ...DEFAULT_CONFIG,
      ...config,
      cpu: CPU_OPTIONS.includes(
        Number(config.cpu) as (typeof CPU_OPTIONS)[number],
      )
        ? Number(config.cpu)
        : DEFAULT_CONFIG.cpu,
      maxDurationMinutes: boundedInteger(
        config.maxDurationMinutes,
        DEFAULT_CONFIG.maxDurationMinutes,
        1,
        MAX_DURATION_MINUTES,
      ),
      maxValidationAttempts: boundedInteger(
        config.maxValidationAttempts,
        DEFAULT_CONFIG.maxValidationAttempts,
        1,
        10,
      ),
      memory: MEMORY_OPTIONS.includes(
        Number(config.memory) as (typeof MEMORY_OPTIONS)[number],
      )
        ? Number(config.memory)
        : DEFAULT_CONFIG.memory,
      envVars: normalizedStringList(config.envVars),
    };
    if (JSON.stringify(normalized) !== JSON.stringify(config)) {
      onChange(nodeId, normalized);
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
              value={typeof config.task === 'string' ? config.task : ''}
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
                  ? `Connected (${configuredAuthProvider ? configuredAuthProvider.charAt(0).toUpperCase() + configuredAuthProvider.slice(1) : 'GitHub'})`
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
              value={configuredRepository}
              onChange={(event) => {
                const repository = event.target.value;
                onChange(nodeId, {
                  ...config,
                  repository,
                  branch: '',
                  ...(configuredForkRepository.toLowerCase() ===
                  repository.toLowerCase()
                    ? { botPullRequestForkRepository: '' }
                    : {}),
                });
              }}
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
          <IntegrationConfigField
            label="Bot PR public fork"
            hint="Required for CI-generated tests. Choose a dedicated public fork with GitHub Actions disabled. Install the GitHub App on both repositories with Contents and Pull requests read/write; Administration read/write lets Playrunner disable and verify fork Actions before every push. Private/internal forks, privileged workflow triggers, and self-hosted or indirect runners are rejected; use static standard GitHub-hosted runners."
          >
            <Select
              data-testid="agent-container-bot-pr-fork"
              value={configuredForkRepository}
              onChange={(event) =>
                update('botPullRequestForkRepository', event.target.value)
              }
              disabled={isLoadingRepos || !isConnected}
            >
              <option value="">
                {isLoadingRepos
                  ? 'Loading repositories...'
                  : 'Select Public Fork'}
              </option>
              {repositories
                .filter(
                  (repository) =>
                    repository.full_name.toLowerCase() !==
                    configuredRepository.toLowerCase(),
                )
                .map((repository) => (
                  <option key={repository.id} value={repository.full_name}>
                    {repository.full_name}
                  </option>
                ))}
            </Select>
          </IntegrationConfigField>
          <IntegrationConfigField label="Branch">
            <Select
              data-testid="agent-container-branch"
              value={typeof config.branch === 'string' ? config.branch : ''}
              onChange={(event) => update('branch', event.target.value)}
              disabled={isLoadingBranches || !configuredRepository}
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
              value={
                typeof config.folder === 'string' && config.folder
                  ? config.folder
                  : DEFAULT_CONFIG.folder
              }
              onChange={(event) => update('folder', event.target.value)}
              placeholder="."
              disabled={!configuredRepository}
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
                config.maxValidationAttempts ??
                DEFAULT_CONFIG.maxValidationAttempts
              }
              onChange={(event) =>
                update('maxValidationAttempts', Number(event.target.value))
              }
            />
          </IntegrationConfigField>
          <IntegrationConfigField
            label="Maximum duration (minutes)"
            hint="Hard wall-clock limit across all agent and validation attempts (up to 45 minutes)."
            htmlFor="agent-container-max-duration-minutes"
          >
            <Input
              id="agent-container-max-duration-minutes"
              data-testid="agent-container-max-duration-minutes"
              type="number"
              min={1}
              max={MAX_DURATION_MINUTES}
              step={1}
              value={
                config.maxDurationMinutes ?? DEFAULT_CONFIG.maxDurationMinutes
              }
              onChange={(event) =>
                update('maxDurationMinutes', Number(event.target.value))
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
            {!configuredEnvVars.length ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted">
                Drag variables from the Input panel here
              </div>
            ) : (
              <div className="relative z-10 flex flex-wrap gap-2">
                {configuredEnvVars.map((key) => (
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
                          configuredEnvVars.filter((value) => value !== key),
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
  getOutputVariables: () => OUTPUT_VARIABLES,
};

export default agentContainerIntegration;
export { Bot as AgentContainerIcon };
