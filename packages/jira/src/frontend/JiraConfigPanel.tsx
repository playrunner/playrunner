import React, { useEffect, useRef, useState } from 'react';
import {
  IntegrationConfigField,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

export const JiraConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  config,
  onChange,
  nodeId,
  isConnected,
  integrationData,
}) => {
  const { auth, ui } = useIntegrationHost();
  const [projects, setProjects] = useState<any[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const latestConfigRef = useRef(config);
  const Input = ui.Input;
  const Select = ui.Select;
  const Textarea = ui.Textarea;

  useEffect(() => {
    latestConfigRef.current = config;
  }, [config]);

  useEffect(() => {
    async function fetchProjects() {
      if (!integrationData?.accessToken) return;

      setIsLoadingProjects(true);

      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        const res = await fetch('/api/jira/projects', {
          headers: {
            'x-jira-auth': integrationData.accessToken,
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();

        if (data.cloudId && data.projects) {
          onChange(nodeId, {
            ...latestConfigRef.current,
            cloudId: data.cloudId,
          });
          setProjects(data.projects);
        }
      } catch (err) {
        console.error('Failed to fetch Jira projects:', err);
      } finally {
        setIsLoadingProjects(false);
      }
    }

    void fetchProjects();
  }, [auth, integrationData?.accessToken, nodeId, onChange]);

  const selectedProject = projects.find((project) => {
    return project.id === config.projectId;
  });
  const issueTypes = selectedProject?.issueTypes || [];

  return (
    <div className="space-y-4">
      <IntegrationConfigField label="Action">
        <Select
          value={config.action || 'create'}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            onChange(nodeId, { ...config, action: event.target.value });
          }}
        >
          <option value="create">Create Issue</option>
          <option value="update">Update Issue</option>
        </Select>
      </IntegrationConfigField>

      {config.action === 'update' ? (
        <IntegrationConfigField
          label="Issue Key"
          hint="The Jira issue key to update."
        >
          <Input
            value={config.issueKey || ''}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              onChange(nodeId, { ...config, issueKey: event.target.value });
            }}
            placeholder="PROJ-123 or {{trigger.issueKey}}"
          />
        </IntegrationConfigField>
      ) : (
        <>
          <IntegrationConfigField label="Project">
            <Select
              value={config.projectId || ''}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                onChange(nodeId, {
                  ...config,
                  projectId: event.target.value,
                });
              }}
              disabled={isLoadingProjects || !isConnected}
            >
              <option value="">
                {isLoadingProjects ? 'Loading projects...' : 'Select Project'}
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.key})
                </option>
              ))}
            </Select>
          </IntegrationConfigField>

          <IntegrationConfigField label="Issue Type">
            <Select
              value={config.issueType || ''}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                onChange(nodeId, {
                  ...config,
                  issueType: event.target.value,
                });
              }}
              disabled={!config.projectId || issueTypes.length === 0}
            >
              <option value="">
                {config.projectId
                  ? 'Select Issue Type'
                  : 'Select a project first'}
              </option>
              {issueTypes.map((issueType: any) => (
                <option key={issueType.id} value={issueType.name}>
                  {issueType.name}
                </option>
              ))}
            </Select>
          </IntegrationConfigField>
        </>
      )}

      <IntegrationConfigField
        label="Summary"
        hint="You can use {{variables}} here."
      >
        <Input
          value={config.summary || ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange(nodeId, { ...config, summary: event.target.value });
          }}
          placeholder="Summary of the issue..."
        />
      </IntegrationConfigField>

      <IntegrationConfigField
        label="Description"
        hint="You can use {{variables}} here."
      >
        <Textarea
          value={config.description || ''}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange(nodeId, { ...config, description: event.target.value });
          }}
          placeholder="Detailed description..."
          className="min-h-[120px]"
        />
      </IntegrationConfigField>
    </div>
  );
};
