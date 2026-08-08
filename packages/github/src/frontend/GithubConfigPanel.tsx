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

export const GithubConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  config,
  onChange,
  nodeId,
  isConnected,
  integrationData,
}) => {
  const { auth, ui } = useIntegrationHost();
  const [repositories, setRepositories] = useState<GithubRepository[]>([]);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const Input = ui.Input;
  const Select = ui.Select;
  const Textarea = ui.Textarea;
  const action = config.action || 'create';

  useEffect(() => {
    async function fetchRepositories() {
      if (!integrationData?.credentialStatus?.configured) return;

      setIsLoadingRepositories(true);
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
      } finally {
        setIsLoadingRepositories(false);
      }
    }

    void fetchRepositories();
  }, [auth, integrationData?.credentialStatus?.configured]);

  return (
    <div className="space-y-4">
      <IntegrationConfigField label="Action">
        <Select
          value={action}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            onChange(nodeId, { ...config, action: event.target.value });
          }}
        >
          <option value="create">Create Issue</option>
          <option value="read">Read Issue</option>
        </Select>
      </IntegrationConfigField>

      <IntegrationConfigField label="Repository">
        <Select
          value={config.repository || ''}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            onChange(nodeId, { ...config, repository: event.target.value });
          }}
          disabled={isLoadingRepositories || !isConnected}
        >
          <option value="">
            {isLoadingRepositories
              ? 'Loading repositories...'
              : 'Select Repository'}
          </option>
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.full_name}>
              {repository.full_name}
            </option>
          ))}
        </Select>
      </IntegrationConfigField>

      {action === 'read' ? (
        <IntegrationConfigField
          label="Issue Number"
          hint="You can use {{variables}} here."
        >
          <Input
            value={config.issueNumber || ''}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              onChange(nodeId, { ...config, issueNumber: event.target.value });
            }}
            placeholder="123 or {{trigger.issueNumber}}"
          />
        </IntegrationConfigField>
      ) : (
        <>
          <IntegrationConfigField
            label="Title"
            hint="You can use {{variables}} here."
          >
            <Input
              value={config.title || ''}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                onChange(nodeId, { ...config, title: event.target.value });
              }}
              placeholder="Issue title..."
            />
          </IntegrationConfigField>

          <IntegrationConfigField
            label="Body"
            hint="GitHub Markdown and {{variables}} are supported."
          >
            <Textarea
              value={config.body || ''}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                onChange(nodeId, { ...config, body: event.target.value });
              }}
              placeholder="Describe the issue..."
              className="min-h-[120px]"
            />
          </IntegrationConfigField>
        </>
      )}
    </div>
  );
};
