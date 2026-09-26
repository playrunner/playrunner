import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { PlayrunnerHostPom } from './core/PlayrunnerHostPom';
import { NavigationPom } from './core/NavigationPom';
import { ProjectsPom } from './core/ProjectsPom';
import { EnvironmentsPom } from './core/EnvironmentsPom';
import { AuthenticationProfilesPom } from './core/AuthenticationProfilesPom';
import { TeamsPom } from './core/TeamsPom';
import { SettingsPom } from './core/SettingsPom';
import { createWorkspaceData } from './data';

type PlayrunnerFixtures = {
  host: PlayrunnerHostPom;
  realPlayrunnerApi: void;
  navigation: NavigationPom;
  projects: ProjectsPom;
  environments: EnvironmentsPom;
  profiles: AuthenticationProfilesPom;
  teams: TeamsPom;
  settings: SettingsPom;
  data: ReturnType<typeof createWorkspaceData>;
  guestPage: Page;
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
  const teamsResponse = await request.get('http://127.0.0.1:3999/api/teams', {
    headers,
  });
  if (!teamsResponse.ok())
    throw new Error(`Failed to list E2E teams: ${teamsResponse.status()}`);
  for (const team of (await teamsResponse.json()).teams ?? []) {
    const result = await request.delete(
      `http://127.0.0.1:3999/api/teams/${encodeURIComponent(team.id)}`,
      { headers },
    );
    if (!result.ok())
      throw new Error(`Failed to clear E2E team: ${result.status()}`);
  }
  const tokensResponse = await request.get('http://127.0.0.1:3999/api/tokens', {
    headers,
  });
  if (!tokensResponse.ok())
    throw new Error(`Failed to list E2E tokens: ${tokensResponse.status()}`);
  for (const apiToken of (await tokensResponse.json()).tokens ?? []) {
    if (apiToken.revokedAt) continue;
    const result = await request.post(
      `http://127.0.0.1:3999/api/tokens/${encodeURIComponent(apiToken.id)}/revoke`,
      { headers },
    );
    if (!result.ok())
      throw new Error(`Failed to revoke E2E token: ${result.status()}`);
  }
  const profilesResponse = await request.get(
    'http://127.0.0.1:3999/api/authentication-profiles',
    { headers },
  );
  if (!profilesResponse.ok()) {
    throw new Error(
      `Failed to list E2E Authentication Profiles: ${profilesResponse.status()}`,
    );
  }
  const profilesPayload = (await profilesResponse.json()) as {
    profiles?: Array<{ id: string }>;
  };
  for (const profile of profilesPayload.profiles ?? []) {
    const deleteResponse = await request.delete(
      `http://127.0.0.1:3999/api/authentication-profiles/${encodeURIComponent(profile.id)}`,
      { headers },
    );
    if (!deleteResponse.ok()) {
      throw new Error(
        `Failed to clear E2E Authentication Profile "${profile.id}": ${deleteResponse.status()}`,
      );
    }
  }
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
  guestPage: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ baseURL });
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
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

      try {
        await use();
      } finally {
        await clearIntegrationConnections(request, authSession.token);
        await clearOwnedResources(request, authSession.token);
      }
    },
    { auto: true },
  ],

  host: async ({ page }, use) => {
    await use(new PlayrunnerHostPom(page));
  },
  navigation: async ({ page }, use) => {
    await use(new NavigationPom(page));
  },
  projects: async ({ page }, use) => {
    await use(new ProjectsPom(page));
  },
  environments: async ({ page }, use) => {
    await use(new EnvironmentsPom(page));
  },
  profiles: async ({ page }, use) => {
    await use(new AuthenticationProfilesPom(page));
  },
  teams: async ({ page }, use) => {
    await use(new TeamsPom(page));
  },
  settings: async ({ page }, use) => {
    await use(new SettingsPom(page));
  },
  data: async ({}, use, info) => {
    await use(createWorkspaceData(info));
  },
});

export { expect };
