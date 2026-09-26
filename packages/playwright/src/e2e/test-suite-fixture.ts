// Stored ZIP entries keep this fixture deterministic and independent of system zip tools.
export function createTestSuiteZip() {
  const files: Record<string, string> = {
    'playwright.config.ts': `export default { testDir: './tests', retries: 0, projects: [{ name: 'desktop' }, { name: 'mobile' }] };`,
    'package.json': JSON.stringify({
      name: 'test-plan-fixture',
      private: true,
      devDependencies: { '@playwright/test': '1.62.1' },
    }),
    'tests/plan.spec.ts': `import { test, expect } from '@playwright/test';
      test('passes', () => expect(1).toBe(1));
      test('fails', () => expect(1).toBe(2));
      test.skip('skipped', () => {});`,
  };
  const locals: Buffer[] = [];
  const directories: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const data = Buffer.from(contents);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    directories.push(directory, filename);
    offset += local.length + filename.length + data.length;
  }
  const central = Buffer.concat(directories);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

export const testPlanMarkdown = `# Regression plan

| ID | Steps | Required result |
| --- | --- | --- |
| PASS-01 | Verify both variants | All checks pass |
| FAIL-01 | Check failed assertion | Assertion passes |
| SKIP-01 | Check skipped case | Case actually runs |
| MANUAL-01 | Verify business approval | Approval evidence available |

## Exit criteria
- All required business checks are verified.
`;

export const authenticationSmokeScript = `import { test, expect } from '@playwright/test';
import fs from 'node:fs';
test('restores Bunker and Steadfast sessions in separate contexts', async ({ browser, context }) => {
  const bunker = process.env.E2E_REGRESSION_STORAGE_STATE;
  const steadfast = process.env.E2E_STEADFAST_STORAGE_STATE;
  expect(bunker).toBeTruthy();
  expect(steadfast).toBeTruthy();
  expect(bunker).not.toBe(steadfast);
  expect(JSON.parse(fs.readFileSync(bunker, 'utf8')).origins.map(entry => entry.origin)).toContain('http://127.0.0.1:4013');
  expect((await context.storageState()).origins.map(entry => entry.origin)).toContain('http://127.0.0.1:4013');
  for (const [statePath, origin] of [[bunker, 'http://127.0.0.1:4013'], [steadfast, 'http://localhost:4013']]) {
    expect(fs.statSync(statePath).mode & 0o777).toBe(0o600);
    const isolated = await browser.newContext({ storageState: statePath });
    try {
      await isolated.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html>App</html>' }));
      const page = await isolated.newPage();
      await page.goto(origin);
      expect(await page.evaluate(() => localStorage.getItem('demo-auth'))).toBe('authenticated');
      const other = origin.includes('127.0.0.1') ? 'http://localhost:4013' : 'http://127.0.0.1:4013';
      await page.goto(other);
      expect(await page.evaluate(() => localStorage.getItem('demo-auth'))).toBeNull();
    } finally { await isolated.close(); }
  }
});`;
