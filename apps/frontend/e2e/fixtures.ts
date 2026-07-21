import { test as base, expect } from '@playwright/test';
import { IntegrationStoreDriver } from './core/IntegrationStoreDriver';
import { PlayrunnerHostPom } from './core/PlayrunnerHostPom';

const authSession = {
  token: 'playrunner-e2e-token',
  user: {
    uid: 'e2e-user',
    username: 'e2e@playrunner.dev',
    name: 'Playrunner E2E',
  },
};

type PlayrunnerFixtures = {
  host: PlayrunnerHostPom;
  integrationStore: IntegrationStoreDriver;
  mockPlayrunnerApi: void;
};

export const test = base.extend<PlayrunnerFixtures>({
  integrationStore: async ({}, use) => {
    await use(new IntegrationStoreDriver());
  },

  mockPlayrunnerApi: [
    async ({ context, integrationStore }, use) => {
      await context.addInitScript((session) => {
        window.localStorage.setItem(
          'playrunner.localAuthSession',
          JSON.stringify(session),
        );
        window.localStorage.setItem('hasCompletedOnboarding', 'true');
      }, authSession);
      await context.route('**/api/**', (route) =>
        integrationStore.handle(route),
      );

      await use();

      await context.unrouteAll({ behavior: 'wait' });
    },
    { auto: true },
  ],

  host: async ({ page }, use) => {
    await use(new PlayrunnerHostPom(page));
  },
});

export { expect };
