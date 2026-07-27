export interface IntegrationApiContribution<TRouter = unknown> {
  id: string;
  mountPath: string;
  router: TRouter;
  publicRouter?: TRouter;
  configure?: (host: IntegrationApiHost) => void;
  prepareCredentials?: (
    store: IntegrationCredentialStore,
    kind: IntegrationConnectionKind,
  ) => Promise<void>;
}

export interface InboundWebhookRequest {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  query: Record<string, unknown>;
}

export interface IntegrationApiHost {
  inboundWebhooks: {
    createOrRotateEndpoint(input: {
      enabled: boolean;
      nodeId: string;
      userId: string;
      workflowId: string;
    }): Promise<{
      enabled: boolean;
      endpointId: string;
      path: string;
      secret: string;
    }>;
    dispatch(
      endpointId: string,
      secret: string,
      request: InboundWebhookRequest,
    ): Promise<{ executionId: string; status: string } | null>;
    getEndpoint(input: {
      nodeId: string;
      userId: string;
      workflowId: string;
    }): Promise<{
      enabled: boolean;
      endpointId: string;
      path: string;
      secret: string;
    } | null>;
    setEnabled(input: {
      enabled: boolean;
      nodeId: string;
      userId: string;
      workflowId: string;
    }): Promise<void>;
  };
  tunnel: {
    getState(): {
      error: string;
      logs: string[];
      message: string;
      status: 'stopped' | 'starting' | 'running' | 'error';
      url: string;
    };
    start(): Promise<{ url: string }>;
    stop(): void;
  };
}

export type IntegrationConnectionKind = 'cloud' | 'integration';

export interface IntegrationCredentialStore {
  resolve(
    kind: IntegrationConnectionKind,
    provider: string,
  ): Promise<{
    provider: string;
    config: Record<string, unknown>;
    secrets: Record<string, unknown>;
  } | null>;
  save(
    kind: IntegrationConnectionKind,
    provider: string,
    envelope: {
      provider?: string;
      config?: Record<string, unknown>;
      secrets?: Record<string, unknown>;
    },
  ): Promise<unknown>;
  updateSecrets(
    kind: IntegrationConnectionKind,
    provider: string,
    patch: Record<string, unknown>,
  ): Promise<unknown>;
}

export function getIntegrationCredentialStore(
  request: unknown,
): IntegrationCredentialStore | undefined {
  if (!request || typeof request !== 'object') return undefined;
  return (request as { integrationCredentials?: IntegrationCredentialStore })
    .integrationCredentials;
}

export function createApiContribution<TRouter>(
  contribution: IntegrationApiContribution<TRouter>,
) {
  return contribution;
}
