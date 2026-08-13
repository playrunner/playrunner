export const ENVIRONMENT_SECRET_MASK = '********';

const ENCODED_SECRET_PREFIX = 'playrunner-environment-secret-v1:';

export interface EnvironmentSecretValues {
  initialValue: string;
  currentValue: string;
}

export function encodeEnvironmentSecret(
  values: EnvironmentSecretValues,
): string {
  return `${ENCODED_SECRET_PREFIX}${JSON.stringify(values)}`;
}

export function decodeEnvironmentSecret(
  value: string,
): EnvironmentSecretValues {
  if (value.startsWith(ENCODED_SECRET_PREFIX)) {
    try {
      const decoded = JSON.parse(value.slice(ENCODED_SECRET_PREFIX.length)) as {
        initialValue?: unknown;
        currentValue?: unknown;
      };
      if (
        typeof decoded.initialValue === 'string' &&
        typeof decoded.currentValue === 'string'
      ) {
        return decoded as EnvironmentSecretValues;
      }
    } catch {
      // Fall through for legacy/plain values that happen to use the prefix.
    }
  }

  return { initialValue: value, currentValue: value };
}

export function getEnvironmentSecretKeys(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];

  const keys = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const variables = (node as Record<string, any>).config?.variables;
    if (!Array.isArray(variables)) continue;
    for (const variable of variables) {
      if (
        variable?.type === 'secret' &&
        typeof variable.key === 'string' &&
        variable.key
      ) {
        keys.add(variable.key);
      }
    }
  }

  return [...keys];
}

export function hydrateEnvironmentSecretVariables(
  nodes: unknown,
  secrets: ReadonlyMap<string, string>,
): unknown {
  if (!Array.isArray(nodes)) return nodes;

  return nodes.map((node) => {
    if (!node || typeof node !== 'object') return node;
    const candidate = node as Record<string, any>;
    const variables = candidate.config?.variables;
    if (!Array.isArray(variables)) return node;

    let changed = false;
    const hydratedVariables = variables.map((variable: unknown) => {
      if (!variable || typeof variable !== 'object') return variable;
      const envVar = variable as Record<string, unknown>;
      if (envVar.type !== 'secret' || typeof envVar.key !== 'string') {
        return variable;
      }

      const encodedSecret = secrets.get(envVar.key);
      if (encodedSecret === undefined) return variable;
      changed = true;
      return { ...envVar, ...decodeEnvironmentSecret(encodedSecret) };
    });

    if (!changed) return node;
    return {
      ...candidate,
      config: { ...candidate.config, variables: hydratedVariables },
    };
  });
}
