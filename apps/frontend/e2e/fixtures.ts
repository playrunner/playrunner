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

      await context.addInitScript((session) => {
        window.localStorage.setItem(
          'playrunner.localAuthSession',
          JSON.stringify(session),
        );
        window.localStorage.setItem('hasCompletedOnboarding', 'true');
      }, authSession);

      await use();

      await clearIntegrationConnections(request, authSession.token);
    },
    { auto: true },
  ],

  host: async ({ page }, use) => {
    await use(new PlayrunnerHostPom(page));
  },
});

export { expect };
