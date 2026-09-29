import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = root;

test('profile renewal controls save hourly polling and show completed checks on desktop and mobile', async (t) => {
  const server = await createServer({
    configFile: `${frontend}/vite.config.ts`,
    root: frontend,
    envDir: false,
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      fs: { allow: [root] },
    },
    plugins: [
      {
        name: 'renewal-component-test',
        resolveId(id) {
          if (id === 'virtual:renewal-test') return `\0${id}`;
        },
        load(id) {
          if (id !== '\0virtual:renewal-test') return;
          return `import { createElement } from 'react';
          import { createRoot } from 'react-dom/client';
          import { AuthenticationRenewal } from '${frontend}/src/components/AuthenticationRenewal.tsx';
          import '${frontend}/src/index.css';
          createRoot(document.getElementById('root')).render(createElement(AuthenticationRenewal, { profileId: 'fixture-profile', onChecked: () => document.body.dataset.checked = 'true' }));`;
        },
      },
    ],
  });
  t.after(() => server.close());
  await server.listen();
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install();
  await page.route('**/__renewal-test', async (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: await server.transformIndexHtml(
        '/__renewal-test',
        `<html class="dark"><body style="padding:24px;background:#09090b;color:white"><article style="max-width:540px;padding:24px;border:1px solid #27272a;border-radius:12px;background:#121212"><h1>Saved browser session</h1><div id="root"></div></article><script type="module" src="/@id/virtual:renewal-test"></script></body></html>`,
      ),
    }),
  );
  // UI component test with simulated responses; store and browser renewal have
  // separate real PostgreSQL and browser tests under apps/api/src/services/authentication-renewal.
  let renewal = {
    enabled: false,
    intervalMinutes: 60,
    lastCheckedAt: null as string | null,
    nextCheckAt: null as string | null,
    result: null as string | null,
  };
  await page.route(
    '**/api/authentication-profiles/fixture-profile/renewal**',
    async (route) => {
      const request = route.request();
      if (request.method() === 'PUT') {
        const input = request.postDataJSON();
        assert.equal(input.intervalMinutes, 60);
        renewal = {
          ...renewal,
          ...input,
          result: input.enabled ? 'queued' : renewal.result,
        };
      } else if (request.method() === 'POST')
        renewal = { ...renewal, result: 'queued' };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ renewal }),
      });
    },
  );
  await page.goto(`${server.resolvedUrls!.local[0]}__renewal-test`);
  const select = page.getByLabel('Keep session alive');
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue('off');
  await select.selectOption('60');
  await expect(select).toHaveValue('60');
  await expect(page.getByRole('status')).toHaveText('Session check queued…');
  renewal = {
    ...renewal,
    result: 'valid',
    lastCheckedAt: '2026-09-29T04:00:00Z',
    nextCheckAt: '2026-09-29T05:00:00Z',
  };
  await page.clock.runFor(3000);
  await expect(page.getByRole('status')).toHaveText(
    'Session verified and refreshed.',
  );
  assert.equal(await page.locator('body').getAttribute('data-checked'), 'true');
  await mkdir(`${root}test-results/renewal`, { recursive: true });
  await page.screenshot({
    path: `${root}test-results/renewal/desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(select).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: `${root}test-results/renewal/mobile.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('status')).toHaveText('Session check queued…');
  renewal = {
    ...renewal,
    result: 'needs_reauth',
    lastCheckedAt: '2026-09-29T04:05:00Z',
    nextCheckAt: null,
  };
  await page.clock.runFor(3000);
  await expect(page.getByRole('status')).toContainText('sign in again');
  await select.selectOption('off');
  await expect(select).toHaveValue('off');
  assert.deepEqual(errors, []);
});
