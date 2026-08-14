/**
 * Generates the favicon / app-icon set in static/img/icons/ from
 * static/img/playrunner-icon.svg.
 *
 * Run manually and commit the PNGs:
 *
 *   node scripts/build-icons.mjs
 *
 * Rendered through Chromium rather than ImageMagick: the mark inherits
 * `stroke-width` from the root <svg> and uses nested transforms, which
 * ImageMagick's internal SVG renderer drops entirely (it emits blank PNGs).
 */

import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(here, '..');
const repoRoot = resolve(docsRoot, '..');
const outDir = resolve(docsRoot, 'static/img/icons');

const require = createRequire(
  resolve(repoRoot, 'apps/runners/playwright/package.json'),
);
const { chromium } = require('playwright');

const DARK = '#0b0f14';

/**
 * `inset` is the share of the canvas left as padding around the mark.
 * Maskable icons need ~20% safe-zone padding; touch icons look better with
 * a little breathing room; bare favicons want the mark as large as possible.
 */
const ICONS = [
  { file: 'favicon-16.png', size: 16, inset: 0, background: 'transparent' },
  { file: 'favicon-32.png', size: 32, inset: 0, background: 'transparent' },
  { file: 'icon-192.png', size: 192, inset: 0, background: 'transparent' },
  { file: 'icon-512.png', size: 512, inset: 0, background: 'transparent' },
  // Opaque: iOS composites transparency to black, so set it deliberately.
  { file: 'apple-touch-icon.png', size: 180, inset: 0.14, background: DARK },
  { file: 'icon-512-maskable.png', size: 512, inset: 0.2, background: DARK },
];

const template = (mark, { size, inset, background }) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${size}px;
        height: ${size}px;
        background: ${background};
        display: flex;
        align-items: center;
        justify-content: center;
      }
      svg {
        width: ${Math.round(size * (1 - inset * 2))}px;
        height: ${Math.round(size * (1 - inset * 2))}px;
        display: block;
      }
    </style>
  </head>
  <body>${mark}</body>
</html>`;

const main = async () => {
  await mkdir(outDir, { recursive: true });

  const mark = await readFile(
    resolve(docsRoot, 'static/img/playrunner-icon.svg'),
    'utf8',
  );

  const browser = await chromium.launch();

  for (const icon of ICONS) {
    const page = await browser.newPage({
      viewport: { width: icon.size, height: icon.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(template(mark, icon), { waitUntil: 'load' });
    await page.screenshot({
      path: resolve(outDir, icon.file),
      type: 'png',
      omitBackground: icon.background === 'transparent',
    });
    await page.close();
    console.log(`  wrote static/img/icons/${icon.file}`);
  }

  await browser.close();
};

await main();
