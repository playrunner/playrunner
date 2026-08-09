import type {
  NodeExecutionContext,
  NodeExecutionResult,
  OrchestratorIntegrationContribution,
} from '@playrunner/integration-sdk/orchestrator';

const GITHUB_API_VERSION = '2026-03-10';

interface GithubResourceResponse {
  body?: unknown;
  html_url?: unknown;
  id?: unknown;
  issue_url?: unknown;
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

function renderOptionalString(
  context: NodeExecutionContext,
  value: unknown,
): string | undefined {
  const template = optionalString(value);
  if (!template) return undefined;
  return optionalString(context.renderTemplate(template));
}

function renderCommaSeparated(
  context: NodeExecutionContext,
  value: unknown,
): string[] | undefined {
  const rendered = renderOptionalString(context, value);
  if (!rendered) return undefined;
  const values = rendered
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
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

function githubApiBaseUrl(context: NodeExecutionContext): string {
  const configured = optionalString(context.settings.apiBaseUrl);
  if (!configured) return 'https://api.github.com';
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new GithubExecutionError('GitHub API base URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new GithubExecutionError(
      'GitHub API base URL must use HTTP or HTTPS.',
    );
  }
  return configured.replace(/\/+$/, '');
}

function repositoryApiUrl(
  context: NodeExecutionContext,
  repository: string,
  path: string,
): string {
  const [owner, repo] = repository.split('/');
  return `${githubApiBaseUrl(context)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${path}`;
}

function issueApiUrl(
  context: NodeExecutionContext,
  repository: string,
  issueNumber?: string,
): string {
  const path = issueNumber
    ? `issues/${encodeURIComponent(issueNumber)}`
    : 'issues';
  return repositoryApiUrl(context, repository, path);
}

function getIssueNumber(context: NodeExecutionContext): string {
  const issueNumber = context.renderTemplate(
    optionalString(context.node.config.issueNumber) ?? '',
  );
  if (!/^\d+$/.test(issueNumber)) {
    throw new GithubExecutionError('A numeric issue number is required.');
  }
  return issueNumber;
}

function requestHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
}

async function githubRequest(
  context: NodeExecutionContext,
  url: string,
  init: RequestInit,
  permission: string,
): Promise<GithubResourceResponse> {
  const response = await fetch(url, { ...init, signal: context.signal });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const permissionHint =
      response.status === 403
        ? ` Ensure the GitHub App has ${permission} permission for this repository.`
        : '';
    const detail =
      typeof data.message === 'string'
        ? ` ${data.message}`
        : ' Request failed.';
    throw new GithubExecutionError(
      `GitHub API returned ${response.status}:${detail}${permissionHint}`,
    );
  }
  return data;
}

function issueOutput(issue: GithubResourceResponse) {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    url: issue.html_url,
    apiUrl: issue.url,
  };
}

function commentOutput(comment: GithubResourceResponse) {
  return {
    id: comment.id,
    body: comment.body,
    url: comment.html_url,
    apiUrl: comment.url,
    issueApiUrl: comment.issue_url,
  };
}

function actionFailure(context: NodeExecutionContext, error: unknown): Error {
  const message =
    error instanceof GithubExecutionError
      ? error.message
      : context.signal.aborted
        ? 'GitHub request was cancelled.'
        : 'GitHub request failed.';
  return new Error(`GitHub action failed: ${message}`);
}

async function executeGithubCreate(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const accessToken = getAccessToken(context);
    const repository = getRepository(context);
    const title = renderOptionalString(context, context.node.config.title);
    const body = renderOptionalString(context, context.node.config.body);
    const labels = renderCommaSeparated(context, context.node.config.labels);
    const assignees = renderCommaSeparated(
      context,
      context.node.config.assignees,
    );
    if (!title) {
      throw new GithubExecutionError('An issue title is required.');
    }

    await context.log(`Creating GitHub issue in ${repository}...`, 'info');
    const issue = await githubRequest(
      context,
      issueApiUrl(context, repository),
      {
        method: 'POST',
        headers: requestHeaders(accessToken),
        body: JSON.stringify({
          title,
          ...(body ? { body } : {}),
          ...(labels ? { labels } : {}),
          ...(assignees ? { assignees } : {}),
        }),
      },
      'Issues',
    );
    await context.log(
      `Successfully created GitHub issue #${String(issue.number)}.`,
      'info',
    );
    return { outcome: 'success', output: issueOutput(issue) };
  } catch (error) {
    throw actionFailure(context, error);
  }
}

async function executeGithubRead(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const accessToken = getAccessToken(context);
    const repository = getRepository(context);
    const issueNumber = getIssueNumber(context);

    await context.log(
      `Reading GitHub issue #${issueNumber} from ${repository}...`,
      'info',
    );
    const issue = await githubRequest(
      context,
      issueApiUrl(context, repository, issueNumber),
      { method: 'GET', headers: requestHeaders(accessToken) },
      'Issues',
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
    throw actionFailure(context, error);
  }
}

async function executeGithubUpdate(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const accessToken = getAccessToken(context);
    const repository = getRepository(context);
    const issueNumber = getIssueNumber(context);
    const title = renderOptionalString(context, context.node.config.title);
    const body = renderOptionalString(context, context.node.config.body);
    const stateValue = optionalString(context.node.config.state);
    const state = stateValue === 'not_planned' ? 'closed' : stateValue;
    const stateReason =
      stateValue === 'not_planned'
        ? 'not_planned'
        : stateValue === 'closed'
          ? 'completed'
          : stateValue === 'open'
            ? 'reopened'
            : undefined;
    const patch = {
      ...(title ? { title } : {}),
      ...(body ? { body } : {}),
      ...(state ? { state } : {}),
      ...(stateReason ? { state_reason: stateReason } : {}),
    };
    if (Object.keys(patch).length === 0) {
      throw new GithubExecutionError(
        'Provide a title, body, or state to update.',
      );
    }

    await context.log(
      `Updating GitHub issue #${issueNumber} in ${repository}...`,
      'info',
    );
    const issue = await githubRequest(
      context,
      issueApiUrl(context, repository, issueNumber),
      {
        method: 'PATCH',
        headers: requestHeaders(accessToken),
        body: JSON.stringify(patch),
      },
      'Issues',
    );
    if (issue.pull_request) {
      throw new GithubExecutionError(
        `#${issueNumber} is a pull request, not an issue.`,
      );
    }
    await context.log(
      `Successfully updated GitHub issue #${issueNumber}.`,
      'info',
    );
    return { outcome: 'success', output: issueOutput(issue) };
  } catch (error) {
    throw actionFailure(context, error);
  }
}

async function executeGithubComment(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const accessToken = getAccessToken(context);
    const repository = getRepository(context);
    const issueNumber = getIssueNumber(context);
    const body = renderOptionalString(context, context.node.config.body);
    if (!body) {
      throw new GithubExecutionError('A comment is required.');
    }

    await context.log(
      `Adding a GitHub comment to #${issueNumber} in ${repository}...`,
      'info',
    );
    const comment = await githubRequest(
      context,
      repositoryApiUrl(
        context,
        repository,
        `issues/${encodeURIComponent(issueNumber)}/comments`,
      ),
      {
        method: 'POST',
        headers: requestHeaders(accessToken),
        body: JSON.stringify({ body }),
      },
      'Issues or Pull requests',
    );
    await context.log(
      `Successfully added a GitHub comment to #${issueNumber}.`,
      'info',
    );
    return { outcome: 'success', output: commentOutput(comment) };
  } catch (error) {
    throw actionFailure(context, error);
  }
}

async function executeGithubCreatePullRequest(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const accessToken = getAccessToken(context);
    const repository = getRepository(context);
    const title = renderOptionalString(context, context.node.config.title);
    const body = renderOptionalString(context, context.node.config.body);
    const head = renderOptionalString(context, context.node.config.head);
    const base = renderOptionalString(context, context.node.config.base);
    if (!title || !head || !base) {
      throw new GithubExecutionError(
        'A pull request title, head branch, and base branch are required.',
      );
    }

    await context.log(
      `Creating GitHub pull request from ${head} to ${base} in ${repository}...`,
      'info',
    );
    const pullRequest = await githubRequest(
      context,
      repositoryApiUrl(context, repository, 'pulls'),
      {
        method: 'POST',
        headers: requestHeaders(accessToken),
        body: JSON.stringify({
          title,
          head,
          base,
          ...(body ? { body } : {}),
          draft: context.node.config.draft === true,
        }),
      },
      'Pull requests',
    );
    await context.log(
      `Successfully created GitHub pull request #${String(pullRequest.number)}.`,
      'info',
    );
    return { outcome: 'success', output: issueOutput(pullRequest) };
  } catch (error) {
    throw actionFailure(context, error);
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
    {
      nodeType: 'github',
      action: 'update',
      execute: executeGithubUpdate,
    },
    {
      nodeType: 'github',
      action: 'comment',
      execute: executeGithubComment,
    },
    {
      nodeType: 'github',
      action: 'createPullRequest',
      execute: executeGithubCreatePullRequest,
    },
  ],
} satisfies OrchestratorIntegrationContribution;

export default githubOrchestratorContribution;
