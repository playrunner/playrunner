export interface IntegrationApiContribution<TRouter = unknown> {
  id: string;
  mountPath: string;
  router: TRouter;
  prepareCredentials?: (
    store: IntegrationCredentialStore,
    kind: IntegrationConnectionKind,
  ) => Promise<void>;
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
