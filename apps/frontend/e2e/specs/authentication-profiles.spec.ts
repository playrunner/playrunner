import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function authenticatedApi(
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

async function waitForSessionStatus(
  page: Page,
  sessionId: string,
  status: string,
) {
  await expect
    .poll(
      async () => {
        const response = await authenticatedApi(
          page,
          `/api/authentication-profiles/sessions/${sessionId}`,
        );
        const session = (
          response.payload as {
            session?: { capturePhase?: string; status?: string };
          }
        ).session;
        return `${session?.status}:${session?.capturePhase || 'none'}`;
      },
      { timeout: 30_000 },
    )
    .toBe(`${status}:none`);
}

test('captures and reuses an Authentication Profile with the local agent', async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
  const environmentId = `auth-environment-${suffix}`;
  await page.goto('/projects');

  expect(
    (
      await authenticatedApi(page, `/api/store/environments/${environmentId}`, {
        method: 'PUT',
        body: { name: 'Authentication E2E', variables: [] },
      })
    ).status,
  ).toBe(201);

  const created = await authenticatedApi(page, '/api/authentication-profiles', {
    method: 'POST',
    body: {
      environmentId,
      name: `Demo Admin ${suffix}`,
      roleLabel: 'Admin',
      startUrl: `http://127.0.0.1:4013/login?ticket=${suffix}`,
      successCondition: {
        type: 'element_visible',
        value: '[data-testid="authenticated-app"]',
      },
    },
  });
  expect(created.status).toBe(201);
  const profileId = (created.payload as { profile: { id: string } }).profile.id;

  await page.goto('/authentication-profiles');
  const card = page
    .getByRole('article')
    .filter({ hasText: `Demo Admin ${suffix}` });
  const authenticationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/authentication-profiles/${profileId}/authenticate`,
  );
  await card.getByRole('button', { name: 'Authenticate' }).click();
  const authentication = await authenticationResponse;
  expect(authentication.status()).toBe(202);
  const authenticationSessionId = (
    (await authentication.json()) as { session: { id: string } }
  ).session.id;
  await waitForSessionStatus(page, authenticationSessionId, 'browser_launched');
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `http://127.0.0.1:4013/ready?ticket=${encodeURIComponent(suffix)}`,
      );
      return ((await response.json()) as { ready: boolean }).ready;
    })
    .toBe(true);
  const handoffResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/authentication-profiles/sessions/${authenticationSessionId}/complete`,
  );
  await card.getByRole('button', { name: 'I’ve finished signing in' }).click();
  expect((await handoffResponse).status()).toBe(200);
  await waitForSessionStatus(page, authenticationSessionId, 'completed');
  await expect(card).toContainText('Authenticated');

  const testResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/authentication-profiles/${profileId}/test`,
  );
  await card.getByRole('button', { name: 'Test session' }).click();
  const testSession = await testResponse;
  expect(testSession.status()).toBe(202);
  await waitForSessionStatus(
    page,
    ((await testSession.json()) as { session: { id: string } }).session.id,
    'completed',
  );

  await expect(card).toContainText('Authenticated');
  await expect(card).toContainText('Admin');
  await expect(
    card.getByRole('button', { name: 'Test session' }),
  ).toBeEnabled();
});
