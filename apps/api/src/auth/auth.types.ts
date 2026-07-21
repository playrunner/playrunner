export interface AuthUser {
  provider: 'local' | string;
  providerUserId: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  username?: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthUser>;
}

interface RequestIntegrationCredentialStore {
  resolve(
    kind: 'cloud' | 'integration',
    provider: string,
  ): Promise<{
    provider: string;
    config: Record<string, unknown>;
    secrets: Record<string, unknown>;
  } | null>;
  save(
    kind: 'cloud' | 'integration',
    provider: string,
    envelope: {
      provider?: string;
      config?: Record<string, unknown>;
      secrets?: Record<string, unknown>;
    },
  ): Promise<unknown>;
  updateSecrets(
    kind: 'cloud' | 'integration',
    provider: string,
    patch: Record<string, unknown>,
  ): Promise<unknown>;
}

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: AuthUser;
    integrationCredentials?: RequestIntegrationCredentialStore;
  }
}
