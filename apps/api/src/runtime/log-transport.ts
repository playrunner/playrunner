import { PUBSUB_SUBSCRIPTION, PUBSUB_TOPIC } from '../config';
import { pubsub } from '../services/pubsub';
import { state } from '../state';
import type { LogTransport } from './contracts';

export class PubSubLogTransport implements LogTransport {
  async publish(payload: string): Promise<void> {
    const topic = pubsub.topic(PUBSUB_TOPIC);
    await topic.publishMessage({ data: Buffer.from(payload) });
  }

  async setup(): Promise<void> {
    try {
      const [topic] = await pubsub.topic(PUBSUB_TOPIC).get({ autoCreate: true });
      const [subscription] = await topic.subscription(PUBSUB_SUBSCRIPTION).get({ autoCreate: true });

      console.log('Listening to Pub/Sub topic:', PUBSUB_TOPIC);

      subscription.on('message', (message) => {
        const data = message.data.toString();
        console.log('Received via Pub/Sub:', data);

        state.sseClients.forEach(client => {
          client.write(`data: ${data}\n\n`);
        });

        message.ack();
      });

      subscription.on('error', (error) => {
        console.error('Pub/Sub Subscription Error:', error);
      });
    } catch {
      console.warn('Could not connect to Pub/Sub (Check GCP credentials). Falling back to local logging.');
    }
  }
}
