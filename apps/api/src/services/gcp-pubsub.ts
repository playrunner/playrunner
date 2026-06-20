import { PubSub } from '@google-cloud/pubsub';
import { OAuth2Client } from 'google-auth-library';
import { state } from '../state';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set for GCP Pub/Sub integration.`);
  }
  return value;
}

const activeGcpSubscriptions: Record<string, boolean> = {};

export async function ensureGcpPubSubSubscription(projectId: string, accessToken: string) {
  if (activeGcpSubscriptions[projectId]) return;

  try {
    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });

    const originalEmulatorHost = process.env.PUBSUB_EMULATOR_HOST;
    delete process.env.PUBSUB_EMULATOR_HOST;

    const pubsub = new PubSub({
      projectId,
      authClient: oauth2Client,
    });

    if (originalEmulatorHost) {
      process.env.PUBSUB_EMULATOR_HOST = originalEmulatorHost;
    }

    const topicName = requireEnv('PUBSUB_TOPIC');
    const subName = `${topicName}-local-sub-${Date.now()}`;

    console.log(`[GCP PubSub] Ensuring topic ${topicName} exists in ${projectId}...`);
    const topic = pubsub.topic(topicName);
    const [topicExists] = await topic.exists();
    if (!topicExists) {
      await topic.create();
      console.log(`[GCP PubSub] Created topic ${topicName}`);
    }

    console.log(`[GCP PubSub] Creating temporary subscription ${subName}...`);
    const [subscription] = await topic.createSubscription(subName, {
      messageRetentionDuration: { seconds: 600 }
    });

    activeGcpSubscriptions[projectId] = true;

    subscription.on('message', (message) => {
      const data = message.data.toString();
      console.log(`[GCP PubSub ${projectId}] Received:`, data);

      state.sseClients.forEach(client => {
        client.write(`data: ${data}\n\n`);
      });

      message.ack();
    });

    subscription.on('error', (error) => {
      console.error(`[GCP PubSub ${projectId}] Subscription error:`, error);
    });

    console.log(`[GCP PubSub] Listening to ${subName} in ${projectId}`);
  } catch (err: any) {
    console.error(`[GCP PubSub] Failed to setup GCP PubSub subscription:`, err.message);
  }
}
