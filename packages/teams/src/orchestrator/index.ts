import type {
  NodeExecutionContext,
  NodeExecutionResult,
  OrchestratorIntegrationContribution,
} from '@playrunner/integration-sdk/orchestrator';

class TeamsExecutionError extends Error {}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TeamsExecutionError(`Microsoft Teams ${label} is required.`);
  }
  return value;
}

export async function executeTeams(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  try {
    const accessToken = required(context.settings.accessToken, 'connection');
    const teamId = required(
      context.renderTemplate(required(context.node.config.teamId, 'team')),
      'team',
    ).trim();
    const channelId = required(
      context.renderTemplate(
        required(context.node.config.channelId, 'channel'),
      ),
      'channel',
    ).trim();
    const message = required(
      context.renderTemplate(required(context.node.config.message, 'message')),
      'message',
    );
    context.signal.throwIfAborted();
    await context.log('Sending Microsoft Teams channel message...', 'info');
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          body: { contentType: 'text', content: message },
        }),
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]),
        redirect: 'error',
      },
    );
    if (!response.ok) {
      const hint =
        response.status === 401
          ? 'Reconnect your account.'
          : response.status === 403
            ? 'Check channel membership and ChannelMessage.Send permission.'
            : response.status === 429
              ? 'Microsoft Graph rate limit reached. Try again later.'
              : 'Check the selected team and channel.';
      throw new TeamsExecutionError(
        `Microsoft Teams returned HTTP ${response.status}. ${hint}`,
      );
    }
    const data = await response.json();
    if (typeof data?.id !== 'string' || !data.id)
      throw new TeamsExecutionError(
        'Microsoft Teams returned an invalid message response.',
      );
    await context.log('Microsoft Teams message sent.', 'info');
    return { outcome: 'success', output: { messageId: data.id } };
  } catch (error) {
    throw new Error(
      error instanceof TeamsExecutionError
        ? error.message
        : context.signal.aborted
          ? 'Microsoft Teams request was cancelled.'
          : 'Microsoft Teams request failed.',
    );
  }
}

export const teamsOrchestratorContribution = {
  contractVersion: 1,
  id: 'teams',
  executors: [{ nodeType: 'teams', default: true, execute: executeTeams }],
} satisfies OrchestratorIntegrationContribution;

export default teamsOrchestratorContribution;
