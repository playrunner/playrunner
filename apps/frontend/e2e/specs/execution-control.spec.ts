import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '../fixtures';
import { executionFixture } from '../support/executionFixture';

test('checks and stops a real workflow, then closes an inactive run @execution-control', async ({
  page,
  request,
}) => {
  await page.goto('/projects');
  const session = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('playrunner.localAuthSession')!),
  );
  const headers = { Authorization: `Bearer ${session.token}` };
  const started = await request.post(
    'http://127.0.0.1:3999/api/workflows/start',
    {
      headers,
      data: {
        workflowId: 'current',
        cloudProvider: 'LOCAL_RUNNER',
        nodes: [
          {
            id: 'slow',
            nodeType: 'code',
            label: 'Long running test',
            config: {
              code: 'const end = Date.now() + 50000; while (Date.now() < end) {} return {};',
              timeoutMs: 60000,
            },
          },
          {
            id: 'next',
            nodeType: 'code',
            label: 'Must not start',
            config: { code: 'return { unexpected: true };' },
          },
        ],
        connections: [
          { sourceId: 'slow', targetId: 'next', type: 'sequential' },
        ],
      },
    },
  );
  expect(started.ok(), await started.text()).toBe(true);
  const { testId } = await started.json();
  const fixture = await executionFixture(session.user.uid);
  const foreign = await executionFixture('unrelated-owner');
  try {
    await fixture.quiet();
    await page.goto('/executions');
    const run = page.getByRole('region', {
      name: `Execution ${testId}`,
      exact: true,
    });
    await expect(run).toBeVisible();
    await run
      .getByRole('button', { name: 'Check activity', exact: true })
      .click();
    await expect(run).toContainText('Orchestrator is tracking this run.');
    await run.getByRole('button', { name: 'Stop run', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(
      'Remaining workflow steps will not start.',
    );
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(run).toContainText('Stop run');
    await run.getByRole('button', { name: 'Stop run', exact: true }).click();
    await dialog.getByRole('button', { name: 'Stop run', exact: true }).click();
    await expect(
      run.getByRole('button', { name: 'Stop run', exact: true }),
    ).toHaveCount(0, { timeout: 30000 });
    await expect(
      page
        .getByRole('region', { name: 'Recent runs', exact: true })
        .getByRole('region', { name: `Execution ${testId}`, exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await run.getByRole('button', { name: /^Expand execution / }).click();
    await expect(run).toContainText('cancelled');
    const snapshot = await request.get(
      'http://127.0.0.1:3999/api/executions/live',
      { headers },
    );
    const execution = (await snapshot.json()).executions.find(
      (item: { id: string }) => item.id === testId,
    );
    expect(execution.status).toBe('cancelled');
    expect(
      execution.nodes.find((node: { id: string }) => node.id === 'next')
        .updatedAt,
    ).toBeNull();
    expect(
      execution.nodes.find((node: { id: string }) => node.id === 'next').status,
    ).toBe('cancelled');

    const stale = page.getByRole('region', {
      name: `Execution ${fixture.id}`,
      exact: true,
    });
    // These controls remain available while the card is collapsed.
    await expect(stale).toContainText('Last event');
    await stale
      .getByRole('button', { name: 'Check activity', exact: true })
      .click();
    await expect(stale).toContainText(
      'No active workflow or runner containers found.',
    );
    await page.screenshot({
      path: 'test-results/execution-control-desktop.png',
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Collapse Sidebar', exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: 'test-results/execution-control-mobile.png',
      fullPage: true,
    });
    await stale.getByRole('button', { name: 'Stop run', exact: true }).click();
    await dialog.getByRole('button', { name: 'Stop run', exact: true }).click();
    await expect(
      stale.getByRole('button', { name: 'Stop run', exact: true }),
    ).toHaveCount(0);
    await expect(stale).toContainText('cancelled');
    for (const action of ['check', 'stop']) {
      const denied = await request.post(
        `http://127.0.0.1:3999/api/executions/${foreign.id}/${action}`,
        { headers },
      );
      expect(denied.status()).toBe(404);
    }
    const missing = await request.post(
      'http://127.0.0.1:3999/api/executions/not-owned/stop',
      { headers },
    );
    expect(missing.status()).toBe(404);
    const unauthorized = await request.post(
      `http://127.0.0.1:3999/api/executions/${fixture.id}/stop`,
    );
    expect(unauthorized.status()).toBe(401);
  } finally {
    await request.post(`http://127.0.0.1:3999/api/executions/${testId}/stop`, {
      headers,
    });
    await fixture.dispose();
    await foreign.dispose();
  }
});

test('kills only the orphaned run containers @execution-control', async ({
  page,
}) => {
  const docker = promisify(execFile);
  await page.goto('/projects');
  const session = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('playrunner.localAuthSession')!),
  );
  const fixture = await executionFixture(session.user.uid);
  const ids: string[] = [];
  try {
    for (const executionId of [fixture.id, `unrelated-${fixture.id}`]) {
      const result = await docker('docker', [
        'run',
        '--rm',
        '-d',
        '--label',
        `playrunner.execution-id=${executionId}`,
        '--label',
        'playrunner.node-id=orphan-test',
        '--entrypoint',
        'sleep',
        'playrunner-orchestrator-e2e',
        '120',
      ]);
      ids.push(result.stdout.trim());
    }
    await page.goto('/executions');
    const run = page.getByRole('region', {
      name: `Execution ${fixture.id}`,
      exact: true,
    });
    await run
      .getByRole('button', { name: 'Check activity', exact: true })
      .click();
    await expect(run).toContainText(
      'Runner containers remain, but the orchestrator no longer tracks this run.',
    );
    await run.getByRole('button', { name: 'Stop run', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Stop run', exact: true })
      .click();
    await expect(run).toContainText('cancelled', { timeout: 30000 });
    const active = await docker('docker', ['ps', '--format', '{{.ID}}']);
    expect(active.stdout).not.toContain(ids[0].slice(0, 12));
    expect(active.stdout).toContain(ids[1].slice(0, 12));
  } finally {
    await Promise.allSettled(
      ids.map((id) => docker('docker', ['rm', '-f', id])),
    );
    await fixture.dispose();
  }
});
