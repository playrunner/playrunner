import { expect, test } from '../fixtures';
import type { Page } from '@playwright/test';

async function authenticatedApi(
  page: Page,
  path: string,
  init: { method: string; body: unknown },
) {
  return page.evaluate(
    async ({ path, init }) => {
      const session = JSON.parse(
        localStorage.getItem('playrunner.localAuthSession') || '{}',
      );
      const response = await fetch(path, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(init.body),
      });
      return { status: response.status, payload: await response.json() };
    },
    { path, init },
  );
}

test('discovers real external runs, resumes mid-run and recovers after disconnect @executions', async ({
  page,
  context,
}) => {
  const start = async (name: string, fail: boolean) => {
    const result = await authenticatedApi(page, '/api/workflows/start', {
      method: 'POST',
      body: {
        workflow: { definition: { name } },
        cloudProvider: 'LOCAL_RUNNER',
        nodes: [
          {
            id: 'first',
            label: 'First check',
            nodeType: 'code',
            config: {
              timeoutMs: 30000,
              code: 'const end = Date.now() + 6000; while (Date.now() < end) {} return { ok: true };',
            },
          },
          {
            id: 'second',
            label: 'Second check',
            nodeType: 'code',
            config: {
              code: fail
                ? 'throw new Error("Expected dashboard failure");'
                : 'return { ok: true };',
            },
          },
        ],
        connections: [
          { sourceId: 'first', targetId: 'second', type: 'sequential' },
        ],
      },
    });
    expect(result.status, JSON.stringify(result.payload)).toBe(200);
    return result.payload.testId as string;
  };
  await page.goto('/projects');
  const first = await start('Dashboard passing run', false);
  await page.goto('/executions');
  const passing = page.getByRole('region', {
    name: `Execution ${first}`,
    exact: true,
  });
  await expect(passing).toContainText('First check');
  await expect(passing).toContainText('running');
  const second = await start('Dashboard failing run', true);
  const failing = page.getByRole('region', {
    name: `Execution ${second}`,
    exact: true,
  });
  await expect(failing).toBeVisible();
  await page.reload();
  await expect(passing).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await context.setOffline(false);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(passing).toContainText('completed', { timeout: 90000 });
  await expect(failing).toContainText('failed', { timeout: 90000 });
  await expect(
    passing.getByRole('listitem').filter({ hasText: 'Second check' }),
  ).toContainText('succeeded');
});
