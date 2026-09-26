import type { Page } from '@playwright/test';

export async function authenticatedApi(
  page: Page,
  path: string,
  init: { body?: unknown; method?: string } = {},
) {
  return page.evaluate(
    async ({ init, path }) => {
      const session = JSON.parse(
        window.localStorage.getItem('playrunner.localAuthSession') || '{}',
      ) as { token?: string };
      const response = await fetch(path, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${session.token || ''}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
      return {
        payload: await response.json().catch(() => null),
        status: response.status,
      };
    },
    { init, path },
  );
}
