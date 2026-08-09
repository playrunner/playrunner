import React, { useEffect, useState } from 'react';
import {
  IntegrationConfigField,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

interface GithubRepository {
  id: string;
  full_name: string;
}

interface GithubBranch {
  name: string;
}

type GithubAction =
  | 'create'
  | 'read'
  | 'update'
  | 'comment'
  | 'createPullRequest';

function isGithubAction(value: unknown): value is GithubAction {
  return ['create', 'read', 'update', 'comment', 'createPullRequest'].includes(
    String(value),
  );
}

export const GithubConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  config,
  onChange,
  nodeId,
  isConnected,
}) => {
  const { auth, ui } = useIntegrationHost();
  const [repositories, setRepositories] = useState<GithubRepository[]>([]);
  const [branches, setBranches] = useState<GithubBranch[]>([]);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [repositoryError, setRepositoryError] = useState('');
  const [branchError, setBranchError] = useState('');
  const Input = ui.Input;
  const Select = ui.Select;
  const Textarea = ui.Textarea;
  const action: GithubAction = isGithubAction(config.action)
    ? config.action
    : 'create';

  const updateConfig = (patch: Record<string, unknown>) => {
    onChange(nodeId, { ...config, ...patch });
  };

  useEffect(() => {
    async function fetchRepositories() {
      if (!isConnected) {
        setRepositories([]);
        return;
      }

      setIsLoadingRepositories(true);
      setRepositoryError('');
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        const response = await fetch('/api/github/repositories', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(`GitHub repositories returned ${response.status}.`);
        }

        const data = (await response.json()) as {
          repositories?: GithubRepository[];
        };
        setRepositories(data.repositories ?? []);
      } catch (error) {
        console.error('Failed to fetch GitHub repositories:', error);
        setRepositoryError(
          'Repositories could not be loaded. Check the GitHub connection and app installation.',
        );
      } finally {
        setIsLoadingRepositories(false);
      }
    }

    void fetchRepositories();
  }, [auth, isConnected]);

  useEffect(() => {
    async function fetchBranches() {
      const repository = String(config.repository ?? '');
      if (action !== 'createPullRequest' || !isConnected || !repository) {
        setBranches([]);
        setBranchError('');
        return;
      }

      setIsLoadingBranches(true);
      setBranchError('');
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        const response = await fetch(
          `/api/github/branches?repository=${encodeURIComponent(repository)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) {
          throw new Error(`GitHub branches returned ${response.status}.`);
        }

        const data = (await response.json()) as { branches?: GithubBranch[] };
        setBranches(data.branches ?? []);
      } catch (error) {
        console.error('Failed to fetch GitHub branches:', error);
        setBranchError(
          'Branches could not be loaded. You can still enter branch names manually.',
        );
      } finally {
        setIsLoadingBranches(false);
      }
    }

    void fetchBranches();
  }, [action, auth, config.repository, isConnected]);

  const issueNumberField = (label = 'Issue Number') => (
    <IntegrationConfigField
      label={label}
      hint="Use a number or a {{variable}} from an earlier node."
    >
      <Input
        value={config.issueNumber || ''}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          updateConfig({ issueNumber: event.target.value });
        }}
        placeholder="123 or {{trigger.issueNumber}}"
      />
    </IntegrationConfigField>
  );

  return (
    <div className="space-y-4">
      <IntegrationConfigField label="Action">
        <Select
          aria-label="Action"
          value={action}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            updateConfig({ action: event.target.value });
          }}
        >
          <option value="create">Create an Issue</option>
          <option value="read">Get an Issue</option>
          <option value="update">Update an Issue</option>
          <option value="comment">Add a Comment</option>
          <option value="createPullRequest">Create a Pull Request</option>
        </Select>
      </IntegrationConfigField>

      <IntegrationConfigField
        label="Repository"
        hint={
          repositoryError ||
          (!isConnected
            ? 'Connect GitHub to load repositories available to the app.'
            : undefined)
        }
      >
        <Select
          aria-label="Repository"
          value={config.repository || ''}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            updateConfig({ repository: event.target.value });
          }}
          disabled={isLoadingRepositories || !isConnected}
        >
          <option value="">
            {isLoadingRepositories
              ? 'Loading repositories...'
              : repositories.length === 0 && isConnected
                ? 'No repositories available'
                : 'Select a repository'}
          </option>
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.full_name}>
              {repository.full_name}
            </option>
          ))}
        </Select>
      </IntegrationConfigField>

      {action === 'create' && (
        <>
          <IntegrationConfigField
            label="Title"
            hint="You can use {{variables}} here."
          >
            <Input
              aria-label="Title"
              value={config.title || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                updateConfig({ title: event.target.value });
              }}
              placeholder="Issue title..."
            />
          </IntegrationConfigField>

          <IntegrationConfigField
            label="Body"
            hint="GitHub Markdown and {{variables}} are supported."
          >
            <Textarea
              aria-label="Body"
              value={config.body || ''}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                updateConfig({ body: event.target.value });
              }}
              placeholder="Describe the issue..."
              className="min-h-[120px]"
            />
          </IntegrationConfigField>

          <IntegrationConfigField
            label="Labels"
            hint="Optional. Separate label names with commas."
          >
            <Input
              aria-label="Labels"
              value={config.labels || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                updateConfig({ labels: event.target.value });
              }}
              placeholder="bug, automation"
            />
          </IntegrationConfigField>

          <IntegrationConfigField
            label="Assignees"
            hint="Optional. Separate GitHub usernames with commas."
          >
            <Input
              aria-label="Assignees"
              value={config.assignees || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                updateConfig({ assignees: event.target.value });
              }}
              placeholder="octocat, monalisa"
            />
          </IntegrationConfigField>
        </>
      )}

      {action === 'read' && issueNumberField()}

      {action === 'update' && (
        <>
          {issueNumberField()}
          <IntegrationConfigField
            label="Title"
            hint="Optional. Leave blank to keep the current title."
          >
            <Input
              value={config.title || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                updateConfig({ title: event.target.value });
              }}
              placeholder="Updated issue title..."
            />
          </IntegrationConfigField>
          <IntegrationConfigField
            label="Body"
            hint="Optional. Leave blank to keep the current body."
          >
            <Textarea
              value={config.body || ''}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                updateConfig({ body: event.target.value });
              }}
              placeholder="Updated issue body..."
              className="min-h-[120px]"
            />
          </IntegrationConfigField>
          <IntegrationConfigField label="State">
            <Select
              value={config.state || ''}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                updateConfig({ state: event.target.value });
              }}
            >
              <option value="">Do not change</option>
              <option value="open">Open</option>
              <option value="closed">Closed — completed</option>
              <option value="not_planned">Closed — not planned</option>
            </Select>
          </IntegrationConfigField>
        </>
      )}

      {action === 'comment' && (
        <>
          {issueNumberField('Issue or Pull Request Number')}
          <IntegrationConfigField
            label="Comment"
            hint="Adds a timeline comment. GitHub Markdown and {{variables}} are supported."
          >
            <Textarea
              value={config.body || ''}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                updateConfig({ body: event.target.value });
              }}
              placeholder="Write a comment..."
              className="min-h-[120px]"
            />
          </IntegrationConfigField>
        </>
      )}

      {action === 'createPullRequest' && (
        <>
          <datalist id={`github-branches-${nodeId}`}>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name} />
            ))}
          </datalist>
          <IntegrationConfigField
            label="Base Branch"
            hint={
              branchError ||
              (isLoadingBranches
                ? 'Loading branches...'
                : 'The branch that should receive the changes.')
            }
          >
            <Input
              list={`github-branches-${nodeId}`}
              value={config.base || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                updateConfig({ base: event.target.value });
              }}
              placeholder="main"
            />
          </IntegrationConfigField>
          <IntegrationConfigField
            label="Head Branch"
            hint="The branch containing the changes. {{variables}} are supported."
          >
            <Input
              list={`github-branches-${nodeId}`}
              value={config.head || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                updateConfig({ head: event.target.value });
              }}
              placeholder="feature/my-change"
            />
          </IntegrationConfigField>
          <IntegrationConfigField
            label="Title"
            hint="You can use {{variables}} here."
          >
            <Input
              value={config.title || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                updateConfig({ title: event.target.value });
              }}
              placeholder="Pull request title..."
            />
          </IntegrationConfigField>
          <IntegrationConfigField
            label="Body"
            hint="Optional. GitHub Markdown and {{variables}} are supported."
          >
            <Textarea
              value={config.body || ''}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                updateConfig({ body: event.target.value });
              }}
              placeholder="Describe the changes..."
              className="min-h-[120px]"
            />
          </IntegrationConfigField>
          <IntegrationConfigField label="Status">
            <Select
              value={config.draft === true ? 'draft' : 'ready'}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                updateConfig({ draft: event.target.value === 'draft' });
              }}
            >
              <option value="ready">Ready for review</option>
              <option value="draft">Draft</option>
            </Select>
          </IntegrationConfigField>
        </>
      )}
    </div>
  );
};
