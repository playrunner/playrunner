import React, { useEffect } from 'react';
import { Bot, Container, Plus, Trash2 } from 'lucide-react';
import { GithubSettingsModal } from '@playrunner/github';
import {
  IntegrationConfigField,
  type Integration,
  type IntegrationConfigPanelProps,
  type IntegrationOutputVariable,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

const DEFAULT_CONFIG = {
  branch: 'main',
  cpu: 4,
  folder: '.',
  maxDurationMinutes: 30,
  maxValidationAttempts: 3,
  memory: 8,
  skillSources: [] as AgentSkillSourceConfig[],
  supportingRepositories: [] as SupportingRepositoryConfig[],
};

const MAX_DURATION_MINUTES = 45;
const MAX_SKILL_SOURCES = 10;
const CPU_OPTIONS = [1, 2, 4, 8] as const;
const MEMORY_OPTIONS = [2, 4, 8, 16, 32] as const;

type AgentSkillSourceConfig =
  | {
      id: string;
      path: string;
      type: 'project';
    }
  | {
      id: string;
      path: string;
      ref: string;
      type: 'github';
      url: string;
    };

type AgentSkillSourcePatch = {
  id?: string;
  path?: string;
  ref?: string;
  type?: AgentSkillSourceConfig['type'];
  url?: string;
};

type SupportingRepositoryConfig = {
  branch: string;
  folder: string;
  repository: string;
};

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

function normalizedSupportingRepositories(
  value: unknown,
): SupportingRepositoryConfig[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((candidate) => {
    const entry =
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : {};
    return {
      branch:
        typeof entry.branch === 'string' && entry.branch.trim()
          ? entry.branch
          : 'main',
      folder:
        typeof entry.folder === 'string' && entry.folder.trim()
          ? entry.folder
          : '.',
      repository: typeof entry.repository === 'string' ? entry.repository : '',
    };
  });
}

function normalizedSkillSources(value: unknown): AgentSkillSourceConfig[] {
  if (!Array.isArray(value)) {
    return DEFAULT_CONFIG.skillSources.map((source) => ({ ...source }));
  }

  const usedIds = new Set<string>();
  return value.slice(0, MAX_SKILL_SOURCES).map((candidate, index) => {
    const entry =
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : {};
    const configuredId = typeof entry.id === 'string' ? entry.id : '';
    const preferredId =
      index === 0 ? 'project-skills' : `skill-source-${index + 1}`;
    let id = configuredId || preferredId;
    let suffix = 2;
    while (!configuredId && usedIds.has(id)) {
      id = `${preferredId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    const path = typeof entry.path === 'string' ? entry.path : '.agents/skills';

    if (entry.type === 'github') {
      const url =
        typeof entry.url === 'string'
          ? entry.url
          : typeof entry.repository === 'string' && entry.repository
            ? `https://github.com/${entry.repository}`
            : '';
      return {
        id,
        path,
        ref: typeof entry.ref === 'string' ? entry.ref : 'main',
        type: 'github',
        url,
      };
    }

    return { id, path, type: 'project' };
  });
}

function nextSkillSourceId(
  type: AgentSkillSourceConfig['type'],
  sources: AgentSkillSourceConfig[],
) {
  const base = type === 'github' ? 'github-skills' : 'project-skills';
  const usedIds = new Set(sources.map((source) => source.id));
  if (!usedIds.has(base)) return base;
  for (let suffix = 2; suffix <= MAX_SKILL_SOURCES + 1; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!usedIds.has(candidate)) return candidate;
  }
  return `skill-source-${sources.length + 1}`;
}

function isSafeRelativePath(value: string) {
  const path = value.trim();
  const hasControlCharacter = Array.from(path).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (
    !path ||
    new TextEncoder().encode(path).length > 1_024 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    hasControlCharacter
  ) {
    return false;
  }
  if (path === '.') return true;
  return !path
    .split('/')
    .some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment === '.git',
    );
}

function isGitHubRepositoryUrl(value: string) {
  const url = value.trim();
  const hasControlCharacter = Array.from(url).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });

  try {
    const parsed = new URL(url);
    const match =
      /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(
        url,
      );
    const segments = match?.slice(1) ?? [];
    return Boolean(
      url &&
      new TextEncoder().encode(url).length <= 300 &&
      !hasControlCharacter &&
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'github.com' &&
      parsed.host.toLowerCase() === 'github.com' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      match &&
      segments.every(
        (segment) =>
          segment.length <= 100 &&
          /^[A-Za-z0-9]/.test(segment) &&
          !segment.endsWith('-') &&
          !segment.endsWith('.'),
      ),
    );
  } catch {
    return false;
  }
}

function isSafeGitRef(value: string) {
  const ref = value.trim();
  if (/^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(ref)) return true;
  const components = ref.split('/');
  const hasForbiddenCharacter = Array.from(ref).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 32 ||
      codePoint === 127 ||
      ['~', '^', ':', '?', '*', '[', '\\'].includes(character)
    );
  });
  return Boolean(
    ref &&
    ref.length <= 255 &&
    !ref.startsWith('-') &&
    ref !== '@' &&
    ref !== 'HEAD' &&
    !ref.startsWith('/') &&
    !ref.startsWith('refs/') &&
    !ref.endsWith('.') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.lock') &&
    !ref.includes('..') &&
    !ref.includes('//') &&
    !ref.includes('@{') &&
    !components.some(
      (component) =>
        !component ||
        component.startsWith('.') ||
        component.endsWith('.') ||
        component.endsWith('.lock'),
    ) &&
    !hasForbiddenCharacter,
  );
}

function skillSourceError(
  source: AgentSkillSourceConfig,
  index: number,
  sources: AgentSkillSourceConfig[],
) {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(source.id)) {
    return 'Source ID must start with a letter and contain only lowercase letters, numbers, and hyphens.';
  }
  if (sources.findIndex((candidate) => candidate.id === source.id) !== index) {
    return 'Source IDs must be unique.';
  }
  if (!isSafeRelativePath(source.path)) {
    return 'Enter a safe path relative to the repository root (for example, .agents/skills).';
  }
  if (source.type === 'github' && !isGitHubRepositoryUrl(source.url)) {
    return 'Enter a full GitHub repository URL, for example https://github.com/agentmantis/test-skills.';
  }
  if (source.type === 'github' && !isSafeGitRef(source.ref)) {
    return 'Enter a branch, tag, or commit SHA without spaces or Git ref metacharacters.';
  }

  const identity =
    source.type === 'project'
      ? `project:${source.path}`
      : `github:${source.url.toLowerCase()}:${source.ref}:${source.path}`;
  const firstMatchingIndex = sources.findIndex((candidate) => {
    const candidateIdentity =
      candidate.type === 'project'
        ? `project:${candidate.path}`
        : `github:${candidate.url.toLowerCase()}:${candidate.ref}:${candidate.path}`;
    return candidateIdentity === identity;
  });

  return firstMatchingIndex !== index
    ? 'This skills source is already configured.'
    : '';
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
    path: 'failure',
    type: 'object',
    description: 'Bounded actionable terminal failure, when the run failed',
  },
  {
    path: 'failure.kind',
    type: 'string',
    description: 'Failure stage or stop reason',
  },
  {
    path: 'failure.message',
    type: 'string',
    description: 'Credential-safe actionable failure message',
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
    path: 'reportUrl',
    type: 'string',
    description: 'Authenticated Playwright HTML report alias',
  },
  {
    path: 'memory',
    type: 'object',
    description: 'Bounded durable outcome used by the next CI execution',
  },
  {
    path: 'repositories',
    type: 'array',
    description: 'Primary and supporting repository revisions used by the run',
  },
  {
    path: 'skills',
    type: 'object',
    description:
      'Bounded inventory of repository-discovered and installed Agent Skills',
  },
  {
    path: 'skills.schemaVersion',
    type: 'string',
    description: 'Agent Skills inventory schema version',
  },
  {
    path: 'skills.skills',
    type: 'array',
    description:
      'Skill names, scopes, source revisions, and container directories used by the run',
  },
  {
    path: 'requirementSources',
    type: 'array',
    description:
      'Connected-node and workflow acceptance criteria used by the run',
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
    path: 'validation.unitTestRun',
    type: 'object',
    description:
      'Independent Vitest execution, assertion reconciliation, and V8 coverage evidence',
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
    description:
      'Workspace-relative validation paths; use top-level artifacts for authenticated downloads',
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
    path: 'artifacts.artifactManifest',
    type: 'string',
    description: 'API-owned authenticated artifact index',
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
    description: 'Compatibility alias for final browser coverage',
  },
  {
    path: 'artifacts.browserCoverage',
    type: 'string',
    description: 'Final browser coverage JSON or LCOV reference',
  },
  {
    path: 'artifacts.playwrightReport',
    type: 'string',
    description: 'Final Playwright HTML report reference',
  },
  {
    path: 'artifacts.testResults',
    type: 'string',
    description: 'Legacy test-results directory reference',
  },
  {
    path: 'artifacts.vitestResults',
    type: 'string',
    description: 'Independent Vitest JSON results reference',
  },
  {
    path: 'artifacts.vitestCoverage',
    type: 'string',
    description: 'Independent Vitest detailed coverage JSON reference',
  },
  {
    path: 'artifacts.vitestLcov',
    type: 'string',
    description: 'Independent Vitest LCOV reference',
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
  const Button = ui.Button!;
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
    'config' | 'skills' | 'env' | 'resources'
  >('config');
  const configuredEnvVars = normalizedStringList(config.envVars);
  const configuredAuthProvider =
    typeof config.authProvider === 'string' ? config.authProvider : '';
  const configuredRepository =
    typeof config.repository === 'string' ? config.repository : '';
  const configuredSupportingRepositories = normalizedSupportingRepositories(
    config.supportingRepositories,
  );
  const configuredSkillSources = normalizedSkillSources(config.skillSources);

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
      skillSources: normalizedSkillSources(config.skillSources),
      supportingRepositories: normalizedSupportingRepositories(
        config.supportingRepositories,
      ),
    };
    delete (normalized as Record<string, unknown>).botPullRequestForkRepository;
    delete (normalized as Record<string, unknown>).githubIssue;
    delete (normalized as Record<string, unknown>).jiraIssue;
    delete (normalized as Record<string, unknown>).requirementSources;
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

  const updateSupportingRepository = (
    index: number,
    patch: Partial<SupportingRepositoryConfig>,
  ) => {
    const next = configuredSupportingRepositories.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, ...patch } : entry,
    );
    update('supportingRepositories', next);
  };

  const updateSkillSource = (index: number, patch: AgentSkillSourcePatch) => {
    const next = configuredSkillSources.map((entry, entryIndex) =>
      entryIndex === index
        ? ({ ...entry, ...patch } as AgentSkillSourceConfig)
        : entry,
    );
    update('skillSources', next);
  };

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

  const tabClass = (tab: 'config' | 'skills' | 'env' | 'resources') =>
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
          data-testid="agent-container-tab-skills"
          className={tabClass('skills')}
          onClick={() => setActiveTab('skills')}
        >
          Skills
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
            Connect one Agent and its tools to this node. A Test Validator is
            required; Jira and GitHub tools can load acceptance criteria before
            the agent starts.
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
                  supportingRepositories:
                    configuredSupportingRepositories.filter(
                      (candidate) => candidate.repository !== repository,
                    ),
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
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h4 className="text-sm font-medium text-[var(--foreground)]">
                  Supporting repositories
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Checkout related libraries alongside the primary repository.
                  Supporting repositories are read-only and provide context;
                  validation and patches remain scoped to the primary
                  repository.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="agent-container-add-supporting-repository"
                disabled={
                  !isConnected || configuredSupportingRepositories.length >= 10
                }
                onClick={() =>
                  update('supportingRepositories', [
                    ...configuredSupportingRepositories,
                    { branch: 'main', folder: '.', repository: '' },
                  ])
                }
                className="shrink-0 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add repository
              </Button>
            </div>
            {configuredSupportingRepositories.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-xs text-muted">
                No supporting repositories configured.
              </p>
            ) : null}
            {configuredSupportingRepositories.map((entry, index) => (
              <div
                key={`${index}-${entry.repository}`}
                className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
                data-testid={`agent-container-supporting-repository-${index}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Repository {index + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove supporting repository ${index + 1}`}
                    title={`Remove supporting repository ${index + 1}`}
                    data-testid={`agent-container-remove-supporting-repository-${index}`}
                    onClick={() =>
                      update(
                        'supportingRepositories',
                        configuredSupportingRepositories.filter(
                          (_, entryIndex) => entryIndex !== index,
                        ),
                      )
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <IntegrationConfigField label="Repository">
                  <Select
                    data-testid={`agent-container-supporting-repository-select-${index}`}
                    value={entry.repository}
                    disabled={isLoadingRepos || !isConnected}
                    onChange={(event) =>
                      updateSupportingRepository(index, {
                        branch: 'main',
                        repository: event.target.value,
                      })
                    }
                  >
                    <option value="">Select Repository</option>
                    {repositories
                      .filter(
                        (repository) =>
                          repository.full_name !== configuredRepository &&
                          !configuredSupportingRepositories.some(
                            (candidate, candidateIndex) =>
                              candidateIndex !== index &&
                              candidate.repository === repository.full_name,
                          ),
                      )
                      .map((repository) => (
                        <option
                          key={repository.id}
                          value={repository.full_name}
                        >
                          {repository.full_name}
                        </option>
                      ))}
                  </Select>
                </IntegrationConfigField>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <IntegrationConfigField label="Branch">
                    <Input
                      data-testid={`agent-container-supporting-branch-${index}`}
                      value={entry.branch}
                      onChange={(event) =>
                        updateSupportingRepository(index, {
                          branch: event.target.value,
                        })
                      }
                      placeholder="main"
                    />
                  </IntegrationConfigField>
                  <IntegrationConfigField
                    label="Folder"
                    hint="Optional working folder within this repository."
                  >
                    <Input
                      data-testid={`agent-container-supporting-folder-${index}`}
                      value={entry.folder}
                      onChange={(event) =>
                        updateSupportingRepository(index, {
                          folder: event.target.value,
                        })
                      }
                      placeholder="."
                    />
                  </IntegrationConfigField>
                </div>
              </div>
            ))}
          </div>
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

      {activeTab === 'skills' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--node-border)] bg-[var(--control-bg)] p-3 text-xs leading-relaxed text-muted">
            Playrunner automatically discovers{' '}
            <span className="font-mono text-[var(--foreground)]">
              .agents/skills
            </span>{' '}
            in the primary repository. Add explicit project paths or paste a
            full repository URL for reusable skills. Public skill repositories
            do not require a GitHub connection. Skill folders are installed into
            the isolated container before the agent starts, and each must
            contain a{' '}
            <span className="font-mono text-[var(--foreground)]">SKILL.md</span>{' '}
            file.
          </div>
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h4 className="text-sm font-medium text-[var(--foreground)]">
                  Agent skill sources
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Load up to {MAX_SKILL_SOURCES} project-owned or reusable
                  skills repositories for every run.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="agent-container-add-skill-source"
                disabled={configuredSkillSources.length >= MAX_SKILL_SOURCES}
                onClick={() =>
                  update('skillSources', [
                    ...configuredSkillSources,
                    {
                      id: nextSkillSourceId('project', configuredSkillSources),
                      path: 'skills',
                      type: 'project',
                    },
                  ])
                }
                className="shrink-0 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add source
              </Button>
            </div>
            {configuredSkillSources.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-xs text-muted">
                No additional sources configured. Skills under{' '}
                <span className="font-mono">.agents/skills</span> in the primary
                repository will still be discovered automatically.
              </p>
            ) : null}
            {configuredSkillSources.map((source, index) => {
              const validationError = skillSourceError(
                source,
                index,
                configuredSkillSources,
              );
              const fieldPrefix = `agent-container-skill-source-${index}`;
              return (
                <div
                  key={index}
                  className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
                  data-testid={`agent-container-skill-source-${index}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Skill source {index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove skill source ${index + 1}`}
                      title={`Remove skill source ${index + 1}`}
                      data-testid={`agent-container-remove-skill-source-${index}`}
                      onClick={() =>
                        update(
                          'skillSources',
                          configuredSkillSources.filter(
                            (_, sourceIndex) => sourceIndex !== index,
                          ),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <IntegrationConfigField
                      label="Source type"
                      htmlFor={`${fieldPrefix}-type`}
                    >
                      <Select
                        id={`${fieldPrefix}-type`}
                        data-testid={`agent-container-skill-source-type-${index}`}
                        value={source.type}
                        onChange={(event) => {
                          const type = event.target.value as
                            | 'project'
                            | 'github';
                          updateSkillSource(
                            index,
                            type === 'github'
                              ? {
                                  path: '.agents/skills',
                                  ref: 'main',
                                  type,
                                  url: '',
                                }
                              : { type },
                          );
                        }}
                      >
                        <option value="project">Primary repository</option>
                        <option value="github">GitHub repository</option>
                      </Select>
                    </IntegrationConfigField>
                    <IntegrationConfigField
                      label="Source ID"
                      hint="Stable install namespace; lowercase letters, numbers, and hyphens."
                      htmlFor={`${fieldPrefix}-id`}
                    >
                      <Input
                        id={`${fieldPrefix}-id`}
                        data-testid={`agent-container-skill-source-id-${index}`}
                        value={source.id}
                        maxLength={63}
                        onChange={(event) =>
                          updateSkillSource(index, { id: event.target.value })
                        }
                        placeholder="project-skills"
                        aria-invalid={Boolean(validationError)}
                      />
                    </IntegrationConfigField>
                  </div>
                  {source.type === 'github' ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <IntegrationConfigField
                        label="Skills repository URL"
                        hint="Paste the full HTTPS GitHub URL. Public repositories work without a GitHub connection."
                        htmlFor={`${fieldPrefix}-url`}
                      >
                        <Input
                          id={`${fieldPrefix}-url`}
                          data-testid={`agent-container-skill-source-url-${index}`}
                          value={source.url}
                          maxLength={300}
                          onChange={(event) =>
                            updateSkillSource(index, {
                              url: event.target.value,
                            })
                          }
                          placeholder="https://github.com/agentmantis/test-skills"
                          aria-invalid={Boolean(validationError)}
                        />
                      </IntegrationConfigField>
                      <IntegrationConfigField
                        label="Git ref"
                        hint="Branch, tag, or full commit SHA. Pin a commit SHA for reproducible runs."
                        htmlFor={`${fieldPrefix}-ref`}
                      >
                        <Input
                          id={`${fieldPrefix}-ref`}
                          data-testid={`agent-container-skill-source-ref-${index}`}
                          value={source.ref}
                          maxLength={255}
                          onChange={(event) =>
                            updateSkillSource(index, {
                              ref: event.target.value,
                            })
                          }
                          placeholder="main"
                          aria-invalid={Boolean(validationError)}
                        />
                      </IntegrationConfigField>
                    </div>
                  ) : null}
                  <IntegrationConfigField
                    label={
                      source.type === 'project'
                        ? 'Skills path in primary repository'
                        : 'Skills path in GitHub repository'
                    }
                    hint="Relative directory containing one or more skill folders. Use . when SKILL.md is at the repository root."
                    htmlFor={`${fieldPrefix}-path`}
                  >
                    <Input
                      id={`${fieldPrefix}-path`}
                      data-testid={`agent-container-skill-source-path-${index}`}
                      value={source.path}
                      maxLength={1_024}
                      onChange={(event) =>
                        updateSkillSource(index, { path: event.target.value })
                      }
                      placeholder=".agents/skills"
                      aria-invalid={Boolean(validationError)}
                    />
                  </IntegrationConfigField>
                  {validationError ? (
                    <p
                      role="alert"
                      data-testid={`agent-container-skill-source-error-${index}`}
                      className="text-xs leading-relaxed text-red-400"
                    >
                      {validationError}
                    </p>
                  ) : (
                    <p className="text-xs leading-relaxed text-muted">
                      {source.type === 'project'
                        ? 'Playrunner discovers SKILL.md files from this path after cloning the primary repository.'
                        : 'Playrunner checks out this exact ref and installs discovered SKILL.md folders without changing the primary repository.'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
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
    'Run an attached coding agent with project memory and tools in one isolated Playwright container',
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
  acceptsAttachments: ['agent', 'memory', 'tool'],
  ConfigPanel: AgentContainerConfigPanel,
  getOutputVariables: () => OUTPUT_VARIABLES,
};

export default agentContainerIntegration;
export { Bot as AgentContainerIcon };
