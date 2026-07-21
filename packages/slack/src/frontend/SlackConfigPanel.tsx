import React, { useEffect, useRef, useState } from 'react';
import {
  IntegrationConfigField,
  type IntegrationConfigPanelProps,
  useIntegrationHost,
} from '@playrunner/integration-sdk';

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
}

export const SlackConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  config,
  onChange,
  nodeId,
  isConnected,
  integrationData,
}) => {
  const { auth, ui } = useIntegrationHost();
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const latestConfigRef = useRef(config);
  const Input = ui.Input;
  const Select = ui.Select;
  const Textarea = ui.Textarea;

  useEffect(() => {
    latestConfigRef.current = config;
  }, [config]);

  useEffect(() => {
    async function fetchChannels() {
      if (
        !integrationData?.accessToken ||
        integrationData?.authMode === 'webhook'
      )
        return;

      setIsLoadingChannels(true);

      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        const res = await fetch('/api/slack/channels', {
          headers: {
            'x-slack-auth': integrationData.accessToken,
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();

        if (data.channels) {
          setChannels(data.channels);
        }
      } catch (err) {
        console.error('Failed to fetch Slack channels:', err);
      } finally {
        setIsLoadingChannels(false);
      }
    }

    void fetchChannels();
  }, [auth, integrationData?.accessToken, integrationData?.authMode]);

  const isWebhookMode = integrationData?.authMode === 'webhook';

  return (
    <div className="space-y-4">
      {isWebhookMode ? (
        <div className="rounded-lg border border-subtle bg-[var(--background)] p-3">
          <p className="text-xs text-muted">
            Using incoming webhook. Messages will be sent to the channel
            configured in Slack.
          </p>
        </div>
      ) : (
        <IntegrationConfigField label="Channel">
          <Select
            value={config.channel || ''}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              onChange(nodeId, {
                ...config,
                channel: event.target.value,
              });
            }}
            disabled={isLoadingChannels || !isConnected}
          >
            <option value="">
              {isLoadingChannels ? 'Loading channels...' : 'Select Channel'}
            </option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.is_private ? '🔒 ' : '#'}
                {channel.name}
              </option>
            ))}
          </Select>
        </IntegrationConfigField>
      )}

      <IntegrationConfigField
        label="Message"
        hint="You can use {{workflow.definition.name}}, {{workflow.run.status}}, {{workflow.run.failedNode.name}} and other shared workflow variables."
      >
        <Textarea
          value={config.message || ''}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange(nodeId, { ...config, message: event.target.value });
          }}
          placeholder="Workflow {{workflow.definition.name}} finished with {{workflow.run.status}}"
          className="min-h-[120px]"
        />
      </IntegrationConfigField>

      <IntegrationConfigField
        label="Bot Username (optional)"
        hint="Override the default bot username for this message."
      >
        <Input
          value={config.username || ''}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange(nodeId, { ...config, username: event.target.value });
          }}
          placeholder="Playrunner"
        />
      </IntegrationConfigField>
    </div>
  );
};
