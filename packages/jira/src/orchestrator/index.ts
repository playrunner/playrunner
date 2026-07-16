import type {
  NodeExecutionContext,
  NodeExecutionResult,
  OrchestratorIntegrationContribution,
} from '@playrunner/integration-sdk/orchestrator';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

class JiraExecutionError extends Error {}

function createDescription(value: string) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: value }],
      },
    ],
  };
}

function getJiraExecutionValues(context: NodeExecutionContext) {
  const config = context.node.config;
  const cloudId = optionalString(config.cloudId);
  if (!cloudId) {
    throw new JiraExecutionError(
      'Missing cloudId in Jira node config. Please reselect project.',
    );
  }

  return {
    cloudId,
    config,
    summary: context.renderTemplate(optionalString(config.summary) ?? ''),
    description: context.renderTemplate(
      optionalString(config.description) ?? '',
    ),
  };
}

async function executeJiraCreate(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  const accessToken = optionalString(context.settings.accessToken);
  if (!accessToken) {
    throw new Error('Jira credentials missing. Cannot execute Jira action.');
  }

  try {
    const { cloudId, config, summary, description } =
      getJiraExecutionValues(context);

    await context.log('Creating Jira issue...', 'info');

    const fields: Record<string, unknown> = {
      project: { id: config.projectId },
      summary: summary || 'Untitled Issue',
      issuetype: { name: config.issueType },
    };

    if (description) {
      fields.description = createDescription(description);
    }

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
        signal: context.signal,
      },
    );

    if (!response.ok) {
      throw new JiraExecutionError(
        `Jira API returned ${response.status}: request failed`,
      );
    }

    const data = (await response.json()) as { key?: unknown };
    await context.log(
      `Successfully created Jira issue: ${String(data.key)}`,
      'info',
    );

    return { outcome: 'success' };
  } catch (error) {
    const message =
      error instanceof JiraExecutionError
        ? error.message
        : context.signal.aborted
          ? 'Jira request was cancelled.'
          : 'Jira request failed.';
    throw new Error(`Jira Action failed: ${message}`);
  }
}

async function executeJiraUpdate(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  const accessToken = optionalString(context.settings.accessToken);
  if (!accessToken) {
    throw new Error('Jira credentials missing. Cannot execute Jira action.');
  }

  try {
    const { cloudId, config, summary, description } =
      getJiraExecutionValues(context);

    await context.log('Updating Jira issue...', 'info');

    const issueKey = context.renderTemplate(
      optionalString(config.issueKey) ?? '',
    );
    if (!issueKey) {
      throw new JiraExecutionError('Issue key is required for update action.');
    }

    const fields: Record<string, unknown> = {};
    if (summary) {
      fields.summary = summary;
    }
    if (description) {
      fields.description = createDescription(description);
    }

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
        signal: context.signal,
      },
    );

    if (!response.ok) {
      throw new JiraExecutionError(
        `Jira API returned ${response.status}: request failed`,
      );
    }

    await context.log(`Successfully updated Jira issue: ${issueKey}`, 'info');

    return { outcome: 'success' };
  } catch (error) {
    const message =
      error instanceof JiraExecutionError
        ? error.message
        : context.signal.aborted
          ? 'Jira request was cancelled.'
          : 'Jira request failed.';
    throw new Error(`Jira Action failed: ${message}`);
  }
}

export const jiraOrchestratorContribution = {
  contractVersion: 1,
  id: 'jira',
  executors: [
    {
      nodeType: 'jira',
      action: 'create',
      default: true,
      execute: executeJiraCreate,
    },
    {
      nodeType: 'jira',
      action: 'update',
      execute: executeJiraUpdate,
    },
  ],
} satisfies OrchestratorIntegrationContribution;
