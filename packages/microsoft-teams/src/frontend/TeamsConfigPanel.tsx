import { useEffect, useState } from 'react';
import {
  IntegrationConfigField,
  useIntegrationHost,
  type IntegrationConfigPanelProps,
} from '@playrunner/integration-sdk';

type Resource = { id: string; name: string };

export function TeamsConfigPanel({
  config,
  onChange,
  nodeId,
  isConnected,
}: IntegrationConfigPanelProps) {
  const { auth, ui } = useIntegrationHost();
  const [teams, setTeams] = useState<Resource[]>([]);
  const [channels, setChannels] = useState<Resource[]>([]);
  const [teamError, setTeamError] = useState('');
  const [channelError, setChannelError] = useState('');
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const { Select, Textarea } = ui;
  const teamId = typeof config.teamId === 'string' ? config.teamId : '';
  const channelId =
    typeof config.channelId === 'string' ? config.channelId : '';

  useEffect(() => {
    const controller = new AbortController();
    setTeams([]);
    setTeamError('');
    if (!isConnected) return;
    setLoadingTeams(true);
    void (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch('/api/microsoft-teams/teams', {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.teams)) throw new Error();
        if (!controller.signal.aborted) setTeams(data.teams);
      } catch {
        if (!controller.signal.aborted)
          setTeamError(
            'Unable to load teams. Check your connection and reopen this panel.',
          );
      } finally {
        if (!controller.signal.aborted) setLoadingTeams(false);
      }
    })();
    return () => controller.abort();
  }, [auth, isConnected]);

  useEffect(() => {
    const controller = new AbortController();
    setChannels([]);
    setChannelError('');
    setLoadingChannels(false);
    if (!isConnected || !teamId) return;
    setLoadingChannels(true);
    void (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch(
          `/api/microsoft-teams/teams/${encodeURIComponent(teamId)}/channels`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.channels)) throw new Error();
        if (!controller.signal.aborted) setChannels(data.channels);
      } catch {
        if (!controller.signal.aborted)
          setChannelError(
            'Unable to load channels. Check team membership and permissions.',
          );
      } finally {
        if (!controller.signal.aborted) setLoadingChannels(false);
      }
    })();
    return () => controller.abort();
  }, [auth, isConnected, teamId]);

  return (
    <div className="space-y-4">
      <IntegrationConfigField label="Team">
        <Select
          aria-label="Team"
          value={teamId}
          disabled={!isConnected || loadingTeams}
          onChange={(e) =>
            onChange(nodeId, {
              ...config,
              teamId: e.target.value,
              channelId: '',
            })
          }
        >
          <option value="">
            {loadingTeams ? 'Loading teams...' : 'Select a team'}
          </option>
          {teamId && !teams.some((t) => t.id === teamId) && (
            <option value={teamId}>{teamId} (saved)</option>
          )}
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </IntegrationConfigField>
      <IntegrationConfigField label="Channel">
        <Select
          aria-label="Channel"
          value={channelId}
          disabled={!isConnected || !teamId || loadingChannels}
          onChange={(e) =>
            onChange(nodeId, { ...config, channelId: e.target.value })
          }
        >
          <option value="">
            {loadingChannels ? 'Loading channels...' : 'Select a channel'}
          </option>
          {channelId && !channels.some((c) => c.id === channelId) && (
            <option value={channelId}>{channelId} (saved)</option>
          )}
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </IntegrationConfigField>
      {(teamError || channelError) && (
        <p role="alert" className="text-sm text-muted">
          {teamError || channelError}
        </p>
      )}
      {isConnected && !loadingTeams && !teamError && teams.length === 0 && (
        <p className="text-xs text-muted">
          No joined teams found for this account.
        </p>
      )}
      {teamId && !loadingChannels && !channelError && channels.length === 0 && (
        <p className="text-xs text-muted">
          No accessible channels found in this team.
        </p>
      )}
      <IntegrationConfigField
        label="Message"
        hint="Use shared variables such as {{workflow.definition.name}} and {{workflow.run.status}}."
      >
        <Textarea
          aria-label="Message"
          value={config.message || ''}
          onChange={(e) =>
            onChange(nodeId, { ...config, message: e.target.value })
          }
          placeholder="Workflow {{workflow.definition.name}} finished with {{workflow.run.status}}"
          className="min-h-[120px]"
        />
      </IntegrationConfigField>
    </div>
  );
}
