import type {
  NodeExecutionContext,
  NodeExecutionResult,
  OrchestratorIntegrationContribution,
} from '@playrunner/integration-sdk/orchestrator';

const GITHUB_API_VERSION = '2022-11-28';

interface GithubIssueResponse {
  body?: unknown;
  html_url?: unknown;
  number?: unknown;
  pull_request?: unknown;
  state?: unknown;
  title?: unknown;
  url?: unknown;
}

class GithubExecutionError extends Error {}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function getAccessToken(context: NodeExecutionContext): string {
  const accessToken = optionalString(context.settings.accessToken);
  if (!accessToken) {
    throw new GithubExecutionError(
      'GitHub credentials missing. Connect GitHub before running this node.',
    );
  }
  return accessToken;
}

function getRepository(context: NodeExecutionContext): string {
  const repository = optionalString(context.node.config.repository);
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new GithubExecutionError(
      'Select a GitHub repository in the node configuration.',
    );
  }
  return repository;
}

function issueApiUrl(repository: string, issueNumber?: string): string {
  const [owner, repo] = repository.split('/');
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
  return issueNumber ? `${base}/${encodeURIComponent(issueNumber)}` : base;
}

function requestHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

async function githubIssueRequest(
  context: NodeExecutionContext,
  url: string,
  init: RequestInit,
): Promise<GithubIssueResponse> {
  const response = await fetch(url, { ...init, signal: context.signal });
  if (!response.ok) {
    const permissionHint =
      response.status === 403
        ? ' Ensure the GitHub App has Issues permission for this repository.'
        : '';
    throw new GithubExecutionError(
      `GitHub API returned ${response.status}: request failed.${permissionHint}`,
    );
  }
  return (await response.json()) as GithubIssueResponse;
}

function issueOutput(issue: GithubIssueResponse) {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    url: issue.html_url,
    apiUrl: issue.url,
  };
}

async function executeGithubCreate(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const accessToken = getAccessToken(context);
    const repository = getRepository(context);
    const title = context.renderTemplate(
      optionalString(context.node.config.title) ?? '',
    );
    const body = context.renderTemplate(
      optionalString(context.node.config.body) ?? '',
    );
    if (!title.trim()) {
      throw new GithubExecutionError('An issue title is required.');
    }

    await context.log(`Creating GitHub issue in ${repository}...`, 'info');
    const issue = await githubIssueRequest(context, issueApiUrl(repository), {
      method: 'POST',
      headers: requestHeaders(accessToken),
      body: JSON.stringify({ title, ...(body ? { body } : {}) }),
    });
    await context.log(
      `Successfully created GitHub issue #${String(issue.number)}.`,
      'info',
    );
    return { outcome: 'success', output: issueOutput(issue) };
  } catch (error) {
    const message =
      error instanceof GithubExecutionError
        ? error.message
        : context.signal.aborted
          ? 'GitHub request was cancelled.'
          : 'GitHub request failed.';
    throw new Error(`GitHub action failed: ${message}`);
  }
}

async function executeGithubRead(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const accessToken = getAccessToken(context);
    const repository = getRepository(context);
    const issueNumber = context.renderTemplate(
      optionalString(context.node.config.issueNumber) ?? '',
    );
    if (!/^\d+$/.test(issueNumber)) {
      throw new GithubExecutionError('A numeric issue number is required.');
    }

    await context.log(
      `Reading GitHub issue #${issueNumber} from ${repository}...`,
      'info',
    );
    const issue = await githubIssueRequest(
      context,
      issueApiUrl(repository, issueNumber),
      { method: 'GET', headers: requestHeaders(accessToken) },
    );
    if (issue.pull_request) {
      throw new GithubExecutionError(
        `#${issueNumber} is a pull request, not an issue.`,
      );
    }
    await context.log(
      `Successfully read GitHub issue #${issueNumber}.`,
      'info',
    );
    return { outcome: 'success', output: issueOutput(issue) };
  } catch (error) {
    const message =
      error instanceof GithubExecutionError
        ? error.message
        : context.signal.aborted
          ? 'GitHub request was cancelled.'
          : 'GitHub request failed.';
    throw new Error(`GitHub action failed: ${message}`);
  }
}

export const githubOrchestratorContribution = {
  contractVersion: 1,
  id: 'github',
  executors: [
    {
      nodeType: 'github',
      action: 'create',
      default: true,
      execute: executeGithubCreate,
    },
    {
      nodeType: 'github',
      action: 'read',
      execute: executeGithubRead,
    },
  ],
} satisfies OrchestratorIntegrationContribution;

export default githubOrchestratorContribution;
