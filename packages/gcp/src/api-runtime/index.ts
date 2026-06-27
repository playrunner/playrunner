import { GcpOutputProxyBackend } from './gcp-output-proxy';
import { GcpOutputSyncBackend } from './gcp-output-sync';
import { GcpWorkflowExecutionBackend } from './gcp-workflow-execution';
import type { GcpPubSubEventStreamManager } from './gcp-pubsub-events';
import type {
  ApiRuntimeContribution,
  GcpExecutionEvents,
  GcpRuntimeState,
  LogTransport,
} from './contracts';

export type CreateGcpApiRuntimeContributionOptions = {
  executionEvents: GcpExecutionEvents;
  logTransport: LogTransport;
  pubSubEventStreamManager: GcpPubSubEventStreamManager;
  state: GcpRuntimeState;
};

export function createGcpApiRuntimeContribution({
  executionEvents,
  logTransport,
  pubSubEventStreamManager,
  state,
}: CreateGcpApiRuntimeContributionOptions): ApiRuntimeContribution {
  return {
    cloudProviders: [{ id: 'GCP', label: 'GCP Runner' }],
    outputProxyBackends: [new GcpOutputProxyBackend(state)],
    outputSyncBackends: [new GcpOutputSyncBackend(state)],
    workflowExecutionBackends: [
      new GcpWorkflowExecutionBackend({
        executionEvents,
        logTransport,
        pubSubEventStreamManager,
        state,
      }),
    ],
  };
}

export { GcpOutputProxyBackend } from './gcp-output-proxy';
export { GcpOutputSyncBackend } from './gcp-output-sync';
export { GcpWorkflowExecutionBackend } from './gcp-workflow-execution';
export {
  createGcpPubSubEventStreamManager,
  type GcpPubSubEventStreamManager,
  type GcpPubSubEventTransport,
} from './gcp-pubsub-events';
export type {
  ApiRuntimeContribution,
  GcpExecutionEvents,
  GcpRuntimeState,
  LogTransport,
} from './contracts';
