import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { PlayrunnerHostPom } from './core/PlayrunnerHostPom';

type PlayrunnerFixtures = {
  host: PlayrunnerHostPom;
  realPlayrunnerApi: void;
};

async function clearIntegrationConnections(
  request: APIRequestContext,
  token: string,
) {
  const headers = { Authorization: `Bearer ${token}` };
  const response = await request.get(
    'http://127.0.0.1:3999/api/store/integrations',
    { headers },
  );
  if (!response.ok()) {
    throw new Error(`Failed to list E2E integrations: ${response.status()}`);
  }
  const payload = (await response.json()) as {
    integrations?: Record<string, unknown>;
  };

  await Promise.all(
    Object.keys(payload.integrations ?? {}).map(async (provider) => {
      const mode = process.env.PLAYRUNNER_E2E_MODE ?? 'mock';
      const preserveSeededProvider =
        (mode === 'mock' && ['github', 'jira'].includes(provider)) ||
        (provider === 'github' &&
          Boolean(process.env.PLAYRUNNER_E2E_GITHUB_TOKEN?.trim()));
      if (preserveSeededProvider) return;
      const deleteResponse = await request.delete(
        `http://127.0.0.1:3999/api/store/integrations/${encodeURIComponent(provider)}`,
        { headers },
      );
      if (!deleteResponse.ok()) {
        throw new Error(
          `Failed to clear E2E integration "${provider}": ${deleteResponse.status()}`,
        );
      }
    }),
  );
}

async function clearOwnedResources(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  for (const resource of ['workflows', 'projects', 'environments']) {
    const response = await request.get(
      `http://127.0.0.1:3999/api/store/${resource}`,
      { headers },
    );
    if (!response.ok()) {
      throw new Error(`Failed to list E2E ${resource}: ${response.status()}`);
    }
    const payload = (await response.json()) as Record<
      string,
      Array<{ id: string }> | undefined
    >;
    for (const item of payload[resource] ?? []) {
      const deleteResponse = await request.delete(
        `http://127.0.0.1:3999/api/store/${resource}/${encodeURIComponent(item.id)}`,
        { headers },
      );
      if (!deleteResponse.ok()) {
        throw new Error(
          `Failed to clear E2E ${resource} "${item.id}": ${deleteResponse.status()}`,
        );
      }
    }
  }
}

export const test = base.extend<PlayrunnerFixtures>({
  realPlayrunnerApi: [
    async ({ context, request }, use) => {
      const response = await request.post(
        'http://127.0.0.1:3999/api/auth/login',
        {
          data: {
            password: 'playrunner-e2e-password',
            username: 'e2e@playrunner.dev',
          },
        },
      );
      if (!response.ok()) {
        throw new Error(
          `Failed to authenticate with the E2E API: ${response.status()} ${await response.text()}`,
        );
      }
      const authSession = (await response.json()) as {
        token: string;
        user: { name?: string; uid: string; username: string };
      };

      await clearIntegrationConnections(request, authSession.token);
      await clearOwnedResources(request, authSession.token);

      await context.addInitScript((session) => {
        window.localStorage.setItem(
          'playrunner.localAuthSession',
          JSON.stringify(session),
        );
        window.localStorage.setItem('hasCompletedOnboarding', 'true');
      }, authSession);

      await use();

      await clearIntegrationConnections(request, authSession.token);
      await clearOwnedResources(request, authSession.token);
    },
    { auto: true },
  ],

  host: async ({ page }, use) => {
    await use(new PlayrunnerHostPom(page));
  },
});

export { expect };
