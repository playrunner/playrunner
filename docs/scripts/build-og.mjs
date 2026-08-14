/**
 * Generates the 1200x630 Open Graph cards in static/img/og/.
 *
 * Run manually and commit the PNGs — this is deliberately NOT part of
 * `npm run build`, so a docs deploy never depends on a browser download.
 *
 *   node scripts/build-og.mjs
 *
 * Playwright is resolved from apps/runners/playwright, which already has it.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(here, '..');
const repoRoot = resolve(docsRoot, '..');
const outDir = resolve(docsRoot, 'static/img/og');

const require = createRequire(
  resolve(repoRoot, 'apps/runners/playwright/package.json'),
);
const { chromium } = require('playwright');

const CARDS = [
  {
    file: 'playrunner-og.png',
    eyebrow: 'For teams already using Playwright',
    title: 'Orchestrate your Playwright suite on a canvas, not in YAML.',
  },
  {
    file: 'og-docs.png',
    eyebrow: 'Documentation',
    title: 'Playwright test orchestration, end to end.',
  },
  {
    file: 'og-tutorials.png',
    eyebrow: 'Tutorials',
    title: 'Build your first Playwright workflow on the canvas.',
  },
  {
    file: 'og-integrations.png',
    eyebrow: 'Integrations',
    title: 'Wire Playwright runs into Slack, Jira, GitHub, and more.',
  },
  {
    file: 'og-pricing.png',
    eyebrow: 'Pricing',
    title: 'Free to self-host. Free on Playrunner Cloud, in open beta.',
  },
  {
    file: 'og-use-cases.png',
    eyebrow: 'Use cases',
    title: 'Alerts, tickets, triage, and schedules around every run.',
  },
];

const template = (mark, { eyebrow, title }) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face { font-family: 'ui'; src: local('Inter'), local('Helvetica Neue'); }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: 1200px;
        height: 630px;
        background: #0b0f14;
        background-image:
          radial-gradient(900px 420px at 88% -12%, rgba(94, 234, 212, 0.20), transparent 62%),
          radial-gradient(700px 380px at -8% 108%, rgba(15, 118, 110, 0.28), transparent 60%);
        color: #f8fafc;
        font-family: Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 76px 80px;
        position: relative;
        overflow: hidden;
      }
      /* teal accent bar down the left edge */
      body::before {
        content: '';
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 10px;
        background: linear-gradient(180deg, #5eead4 0%, #0f766e 100%);
      }
      /* faint canvas grid, echoing the product surface */
      body::after {
        content: '';
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(rgba(148, 163, 184, 0.055) 1px, transparent 1px),
          linear-gradient(90deg, rgba(148, 163, 184, 0.055) 1px, transparent 1px);
        background-size: 48px 48px;
        pointer-events: none;
      }
      .row { display: flex; align-items: center; gap: 20px; position: relative; z-index: 1; }
      .mark { width: 76px; height: 76px; display: block; }
      .wordmark { font-size: 40px; font-weight: 700; letter-spacing: -0.022em; }
      .body { position: relative; z-index: 1; }
      .eyebrow {
        font-size: 22px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #5eead4;
        margin-bottom: 26px;
      }
      h1 {
        font-size: 66px;
        line-height: 1.1;
        font-weight: 700;
        letter-spacing: -0.032em;
        max-width: 19ch;
        text-wrap: balance;
      }
      .foot {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 24px;
        color: #94a3b8;
        font-weight: 500;
      }
      .foot .dot { color: #334155; margin: 0 14px; }
    </style>
  </head>
  <body>
    <div class="row">
      ${mark}
      <div class="wordmark">Playrunner</div>
    </div>
    <div class="body">
      <div class="eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
    </div>
    <div class="foot">
      <span>playrunner.dev</span>
      <span>Visual orchestration<span class="dot">/</span>Playwright</span>
    </div>
  </body>
</html>`;

const main = async () => {
  await mkdir(outDir, { recursive: true });

  const rawMark = await readFile(
    resolve(docsRoot, 'static/img/playrunner-icon.svg'),
    'utf8',
  );
  const mark = rawMark.replace('<svg', '<svg class="mark"');

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });

  for (const card of CARDS) {
    await page.setContent(template(mark, card), { waitUntil: 'load' });
    await page.screenshot({ path: resolve(outDir, card.file), type: 'png' });
    console.log(`  wrote static/img/og/${card.file}`);
  }

  await browser.close();
};

await main();
