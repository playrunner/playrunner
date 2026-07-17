import type {
  NodeExecutionContext,
  NodeExecutionResult,
  OrchestratorIntegrationContribution,
} from '@playrunner/integration-sdk/orchestrator';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

class SlackExecutionError extends Error {}

function providerErrorCode(value: unknown): string {
  const code = optionalString(value);
  return code && /^[a-z0-9_.-]{1,100}$/i.test(code) ? code : 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function executeSlack(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  const accessToken = optionalString(context.settings.accessToken);
  const webhookUrl = optionalString(context.settings.webhookUrl);

  if (!accessToken && !webhookUrl) {
    throw new Error('Slack credentials missing. Cannot send message.');
  }

  try {
    const config = context.node.config;
    const message = context.renderTemplate(
      optionalString(config.message) ?? 'Workflow completed.',
    );
    const username = optionalString(config.username);

    if (webhookUrl) {
      await context.log(
        'Sending Slack message via incoming webhook...',
        'info',
      );

      const webhookBody: Record<string, string> = { text: message };
      if (username) {
        webhookBody.username = context.renderTemplate(username);
      }

      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookBody),
        signal: context.signal,
      });

      if (!webhookResponse.ok) {
        throw new SlackExecutionError(
          `Slack webhook returned ${webhookResponse.status}: request failed`,
        );
      }

      await context.log('Slack message sent successfully via webhook.', 'info');
    } else {
      await context.log('Sending Slack message via Bot API...', 'info');

      const channel = optionalString(config.channel);
      if (!channel) {
        throw new SlackExecutionError(
          'No Slack channel configured. Please select a channel in the node settings.',
        );
      }

      const postBody: Record<string, string> = {
        channel,
        text: message,
      };
      if (username) {
        postBody.username = context.renderTemplate(username);
      }

      const postResponse = await fetch(
        'https://slack.com/api/chat.postMessage',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(postBody),
          signal: context.signal,
        },
      );

      const postData: unknown = await postResponse.json();
      if (!isRecord(postData) || postData.ok !== true) {
        const apiError = isRecord(postData)
          ? providerErrorCode(postData.error)
          : 'unknown';
        throw new SlackExecutionError(`Slack API error: ${apiError}`);
      }

      await context.log('Slack message sent successfully to channel.', 'info');
    }

    return { outcome: 'success' };
  } catch (error) {
    const message =
      error instanceof SlackExecutionError
        ? error.message
        : context.signal.aborted
          ? 'Slack request was cancelled.'
          : 'Slack request failed.';
    throw new Error(`Slack action failed: ${message}`);
  }
}

export const slackOrchestratorContribution = {
  contractVersion: 1,
  id: 'slack',
  executors: [
    {
      nodeType: 'slack',
      default: true,
      execute: executeSlack,
    },
  ],
} satisfies OrchestratorIntegrationContribution;

export default slackOrchestratorContribution;
