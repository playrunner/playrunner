import type { Express, Router } from 'express';
import { discoveredIntegrationContributions } from './generated-package-contributions';

interface IntegrationCredentialStore {
  resolve(kind: 'cloud' | 'integration', provider: string): Promise<unknown>;
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

interface IntegrationApiContribution {
  id: string;
  mountPath: string;
  router: Router;
  prepareCredentials?: (
    store: IntegrationCredentialStore,
    kind: 'cloud' | 'integration',
  ) => Promise<void>;
}

function readApiContribution(entry: {
  packageName: string;
  integrationId: string;
  contribution: unknown;
}): IntegrationApiContribution {
  if (
    typeof entry.contribution !== 'object' ||
    entry.contribution === null ||
    Array.isArray(entry.contribution)
  ) {
    throw new Error(
      `Integration package "${entry.packageName}" did not default-export an API contribution object.`,
    );
  }

  const contribution =
    entry.contribution as Partial<IntegrationApiContribution>;
  if (contribution.id !== entry.integrationId) {
    throw new Error(
      `Integration package "${entry.packageName}" declares id "${entry.integrationId}" but its API contribution has id "${String(contribution.id)}".`,
    );
  }
  if (
    typeof contribution.mountPath !== 'string' ||
    !contribution.mountPath.startsWith('/')
  ) {
    throw new Error(
      `Integration package "${entry.packageName}" has an invalid API mount path.`,
    );
  }
  if (typeof contribution.router !== 'function') {
    throw new Error(
      `Integration package "${entry.packageName}" has an invalid API router.`,
    );
  }

  return contribution as IntegrationApiContribution;
}

const integrationIds = new Set<string>();
const mountPaths = new Set<string>();

export const packageApiContributions = discoveredIntegrationContributions.map(
  (entry) => {
    const contribution = readApiContribution(entry);
    if (integrationIds.has(contribution.id)) {
      throw new Error(`Duplicate API integration id "${contribution.id}".`);
    }
    if (mountPaths.has(contribution.mountPath)) {
      throw new Error(
        `Duplicate integration API mount path "${contribution.mountPath}".`,
      );
    }

    integrationIds.add(contribution.id);
    mountPaths.add(contribution.mountPath);
    return contribution;
  },
);

export function registerIntegrationApiRoutes(app: Express): void {
  for (const contribution of packageApiContributions) {
    app.use(contribution.mountPath, contribution.router);
  }
}

export async function preparePackageCredentials(
  provider: string,
  store: IntegrationCredentialStore,
  kind: 'cloud' | 'integration',
) {
  const contribution = packageApiContributions.find(
    (candidate) => candidate.id === provider,
  );
  await contribution?.prepareCredentials?.(store, kind);
}
