import type { IntegrationAuthClient } from '@playrunner/integration-sdk';

export async function webhookApi<T>(
  auth: IntegrationAuthClient,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(`/api/webhooks${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(
      payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}.`,
    );
  }
  return payload as T;
}
