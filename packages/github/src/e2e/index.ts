import { definePlayrunnerE2EContribution } from '@playrunner/integration-sdk/e2e';
import { createGithubE2EData } from './data';
import { GithubE2EPom } from './GithubE2EPom';

async function findLiveIssue(repository: string, title: string) {
  const token = process.env.PLAYRUNNER_E2E_GITHUB_TOKEN?.trim();
  if (!token) return undefined;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/issues?state=all&per_page=100&sort=created&direction=desc`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub issue verification returned ${response.status}.`);
  }
  const issues = (await response.json()) as Array<{
    number?: number;
    pull_request?: unknown;
    title?: string;
  }>;
  return issues.find((issue) => !issue.pull_request && issue.title === title);
}

async function waitForLiveIssue(repository: string, title: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const issue = await findLiveIssue(repository, title);
    if (issue) return issue;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return undefined;
}

async function closeLiveIssue(repository: string, issueNumber: number) {
  const token = process.env.PLAYRUNNER_E2E_GITHUB_TOKEN?.trim();
  if (!token) return;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/issues/${issueNumber}`,
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub issue cleanup returned ${response.status}.`);
  }
}

export const githubE2EContribution = definePlayrunnerE2EContribution({
  id: 'github',
  createData: createGithubE2EData,
  createPom: ({ host, page }) => new GithubE2EPom(page, host),
  scenarios: [
    {
      id: 'connected-state',
      mode: 'mock',
      title: 'loads the encrypted GitHub test connection',
      tags: ['@github', '@integration'],
      async run({ expect, pom }) {
        await pom.open();
        await expect(pom.connectedHeading).toBeVisible();
        await pom.closeConnection();
      },
    },
    {
      id: 'create-issue-node-mock',
      mode: 'mock',
      title: 'creates an issue through a GitHub node and fake upstream',
      tags: ['@github', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createIssueNode();
        await pom.nodeActionSelect.selectOption('create');
        await expect(pom.nodeRepositorySelect).toContainText(data.repository);
        await pom.nodeRepositorySelect.selectOption(data.repository);
        await pom.nodeTitleInput.fill(data.issueTitle);
        await pom.nodeBodyInput.fill(data.issueBody);
        await pom.nodeField('labels').fill(data.labels);
        await pom.nodeField('assignees').fill(data.assignees);
        await pom.closeNode();
        await pom.saveWorkflow();
        await pom.reloadWorkflow();
        await pom.reopenNode();
        await expect(pom.nodeRepositorySelect).toHaveValue(data.repository);
        await expect(pom.nodeTitleInput).toHaveValue(data.issueTitle);
        await expect(pom.nodeBodyInput).toHaveValue(data.issueBody);
        await expect(pom.nodeField('labels')).toHaveValue(data.labels);
        await expect(pom.nodeField('assignees')).toHaveValue(data.assignees);
        await pom.closeNode();

        expect(await pom.runWorkflow()).toBe('success');
        const response = await fetch(
          `http://127.0.0.1:4010/__e2e/issues?title=${encodeURIComponent(data.issueTitle)}`,
        );
        expect(response.ok).toBe(true);
        const issues = (await response.json()) as Array<{ title?: string }>;
        expect(issues).toHaveLength(1);
        expect(issues[0]?.title).toBe(data.issueTitle);
      },
    },
    {
      id: 'read-issue-node-config',
      mode: 'mock',
      title: 'persists every GitHub read issue value',
      tags: ['@github', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createIssueNode();
        await pom.nodeField('action').selectOption('read');
        await pom.nodeField('repository').selectOption(data.repository);
        await pom.nodeField('issue-number').fill(data.issueNumber);
        await pom.closeNode();
        await pom.saveWorkflow();
        await pom.reloadWorkflow();
        await pom.reopenNode();
        await expect(pom.nodeField('action')).toHaveValue('read');
        await expect(pom.nodeField('repository')).toHaveValue(data.repository);
        await expect(pom.nodeField('issue-number')).toHaveValue(
          data.issueNumber,
        );
      },
    },
    {
      id: 'update-issue-node-config',
      mode: 'mock',
      title: 'persists every GitHub update issue value',
      tags: ['@github', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createIssueNode();
        await pom.nodeField('action').selectOption('update');
        await pom.nodeField('repository').selectOption(data.repository);
        await pom.nodeField('issue-number').fill(data.issueNumber);
        await pom.nodeField('update-title').fill(data.issueTitle);
        await pom.nodeField('update-body').fill(data.issueBody);
        await pom.nodeField('state').selectOption('not_planned');
        await pom.closeNode();
        await pom.saveWorkflow();
        await pom.reloadWorkflow();
        await pom.reopenNode();
        await expect(pom.nodeField('action')).toHaveValue('update');
        await expect(pom.nodeField('repository')).toHaveValue(data.repository);
        await expect(pom.nodeField('issue-number')).toHaveValue(
          data.issueNumber,
        );
        await expect(pom.nodeField('update-title')).toHaveValue(
          data.issueTitle,
        );
        await expect(pom.nodeField('update-body')).toHaveValue(data.issueBody);
        await expect(pom.nodeField('state')).toHaveValue('not_planned');
      },
    },
    {
      id: 'comment-node-config',
      mode: 'mock',
      title: 'persists every GitHub comment value',
      tags: ['@github', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createIssueNode();
        await pom.nodeField('action').selectOption('comment');
        await pom.nodeField('repository').selectOption(data.repository);
        await pom.nodeField('issue-number').fill(data.issueNumber);
        await pom.nodeField('comment').fill(data.issueBody);
        await pom.closeNode();
        await pom.saveWorkflow();
        await pom.reloadWorkflow();
        await pom.reopenNode();
        await expect(pom.nodeField('action')).toHaveValue('comment');
        await expect(pom.nodeField('repository')).toHaveValue(data.repository);
        await expect(pom.nodeField('issue-number')).toHaveValue(
          data.issueNumber,
        );
        await expect(pom.nodeField('comment')).toHaveValue(data.issueBody);
      },
    },
    {
      id: 'pull-request-node-config',
      mode: 'mock',
      title: 'persists every GitHub pull request value',
      tags: ['@github', '@integration', '@node'],
      async run({ data, expect, pom }) {
        await pom.createIssueNode();
        await pom.nodeField('action').selectOption('createPullRequest');
        await pom.nodeField('repository').selectOption(data.repository);
        await pom.nodeField('base').fill('main');
        await pom.nodeField('head').fill('e2e-branch');
        await pom.nodeField('pr-title').fill(data.issueTitle);
        await pom.nodeField('pr-body').fill(data.issueBody);
        await pom.nodeField('pr-status').selectOption('draft');
        await pom.closeNode();
        await pom.saveWorkflow();
        await pom.reloadWorkflow();
        await pom.reopenNode();
        await expect(pom.nodeField('action')).toHaveValue(
          'createPullRequest',
        );
        await expect(pom.nodeField('repository')).toHaveValue(data.repository);
        await expect(pom.nodeField('base')).toHaveValue('main');
        await expect(pom.nodeField('head')).toHaveValue('e2e-branch');
        await expect(pom.nodeField('pr-title')).toHaveValue(data.issueTitle);
        await expect(pom.nodeField('pr-body')).toHaveValue(data.issueBody);
        await expect(pom.nodeField('pr-status')).toHaveValue('draft');
      },
    },
    {
      id: 'create-issue-node-live',
      mode: 'live',
      requiredEnvironment: [
        'PLAYRUNNER_E2E_GITHUB_REPOSITORY',
        'PLAYRUNNER_E2E_GITHUB_TOKEN',
      ],
      title: 'creates and closes a real issue through a GitHub node',
      tags: ['@github', '@integration', '@node', '@live-provider'],
      async run({ data, expect, pom }) {
        let issueNumber: number | undefined;
        try {
          await pom.open();
          await expect(pom.connectedHeading).toBeVisible();
          await pom.closeConnection();
          await pom.createIssueNode();
          await pom.nodeActionSelect.selectOption('create');
          await expect(pom.nodeRepositorySelect).toContainText(data.repository);
          await pom.nodeRepositorySelect.selectOption(data.repository);
          await pom.nodeTitleInput.fill(data.issueTitle);
          await pom.nodeBodyInput.fill(data.issueBody);
          await pom.closeNode();
          await pom.saveWorkflow();
          expect(await pom.runWorkflow()).toBe('success');

          const issue = await waitForLiveIssue(
            data.repository,
            data.issueTitle,
          );
          expect(issue).toBeTruthy();
          issueNumber = issue?.number;
        } finally {
          if (!issueNumber) {
            issueNumber = (
              await findLiveIssue(data.repository, data.issueTitle)
            )?.number;
          }
          if (issueNumber) {
            await closeLiveIssue(data.repository, issueNumber);
          }
        }
      },
    },
  ],
});

export default githubE2EContribution;

export { createGithubE2EData } from './data';
export type { GithubE2EData } from './data';
export { GithubE2EPom } from './GithubE2EPom';
