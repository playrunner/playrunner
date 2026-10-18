import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  buildRegressionPlan,
  type RegressionPlan,
} from '../../shared/regression';
import { prepareRegressionPlan } from './regression-repository';
import { readPlaywrightReportData } from './report-data';
import {
  readRegressionDiscovery,
  regressionFileSelectors,
  validateRegressionRun,
  writeRegressionArtifacts,
} from './regression-runtime';

const source = {
  repository: 'fixture/ui',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
};
function plan(): RegressionPlan {
  return buildRegressionPlan({
    request: { version: 1, mode: 'affected', sources: [source] },
    policy: {
      version: 1,
      repositories: [{ repository: source.repository }],
      dependencies: [],
      journeys: [
        {
          id: 'account',
          title: 'Account',
          sources: [{ repository: source.repository, path: 'input.ts' }],
          tests: [{ file: 'tests/input.spec.ts' }],
        },
      ],
    },
    snapshots: [source.baseSha, source.headSha].map((revision) => ({
      repository: source.repository,
      revision,
      files: { 'input.ts': 'export const input = true;' },
    })),
    changes: [
      { repository: source.repository, path: 'input.ts', status: 'modified' },
    ],
  });
}

test('exact file selectors escape regex punctuation and cannot match a sibling filename', () => {
  const selectors = regressionFileSelectors(plan(), '/workspace');
  assert.equal(
    new RegExp(selectors[0]).test('/workspace/tests/input.spec.ts'),
    true,
  );
  assert.equal(
    new RegExp(selectors[0]).test('/workspace/tests/inputXspecXts'),
    false,
  );
  assert.equal(
    new RegExp(selectors[0]).test('/workspace/tests/input.spec.ts.extra'),
    false,
  );
});

test('missing mapped discovery widens once; zero full discovery stays blocked', async () => {
  const selectors: string[][] = [];
  const result = await validateRegressionRun({
    plan: plan(),
    workingDir: '/workspace',
    discover: async (args) => {
      selectors.push(args);
      return {
        status: 'blocked',
        testCount: 0,
        files: [],
        blockReason: 'No regression tests were discovered.',
      };
    },
  });
  assert.equal(result.plan.mode, 'full');
  assert.notEqual(result.plan.hash, plan().hash);
  assert.equal(result.discovery.status, 'blocked');
  assert.equal(selectors.length, 2);
  assert.deepEqual(selectors[1], []);
});

test('discovery requires every mapped project, but safely runs all browser projects for selected files', async () => {
  const input = plan();
  input.tests[0].project = 'firefox';
  const seen: string[][] = [];
  const result = await validateRegressionRun({
    plan: input,
    workingDir: '/workspace',
    discover: async (selectors) => {
      seen.push(selectors);
      return {
        status: 'ready',
        testCount: 1,
        files: [{ file: 'tests/input.spec.ts', project: 'chromium' }],
      };
    },
  });
  assert.equal(result.plan.mode, 'full');
  assert.deepEqual(seen[1], []);
});

function git(directory: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Regression fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Regression fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function write(directory: string, name: string, contents: string) {
  fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
  fs.writeFileSync(path.join(directory, name), contents);
}

// Real Git commits, actual Playwright discovery, and real Chromium page checks.
// No remote service, provider mutation, or generated evidence enters Git.
test(
  'shared dropdown change selects Admin plus explicitly mapped Portal, skips unrelated test, and catches the Portal failure',
  { timeout: 120000 },
  async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'playrunner-regression-fixture-'),
    );
    const library = path.join(root, 'library');
    const portal = path.join(root, 'portal');
    fs.mkdirSync(library);
    fs.mkdirSync(portal);
    const runnerModules = path.resolve(__dirname, '../node_modules');
    // Source execution uses ts-node; compiled execution lives under dist/playwright/src.
    const modules = fs.existsSync(runnerModules)
      ? runnerModules
      : path.resolve(__dirname, '../../../node_modules');
    const actualModules = fs.existsSync(modules)
      ? modules
      : path.resolve(process.cwd(), 'node_modules');
    const playwrightCli = path.join(actualModules, 'playwright', 'cli.js');
    try {
      write(
        library,
        'package.json',
        JSON.stringify({
          name: '@fixture/ui',
          exports: './src/dropdown.ts',
          dependencies: {
            '@playwright/test': '1.62.1',
            '@fixture/portal': '1.0.0',
          },
        }),
      );
      write(
        portal,
        'package.json',
        JSON.stringify({
          name: '@fixture/portal',
          exports: './src/account.ts',
          dependencies: { '@fixture/ui': '1.0.0' },
        }),
      );
      const dropdown = (broken: boolean) =>
        `export function dropdown(context: string) { const selected = ${broken ? "context === 'admin'" : 'true'}; return '<label>Country<select aria-label="Country"><option value="">Choose</option><option value="AU" ' + (selected ? 'selected' : '') + '>Australia</option></select></label>'; }`;
      write(library, 'src/dropdown.ts', dropdown(false));
      write(
        library,
        'src/admin.ts',
        "import { dropdown } from './dropdown'; export const renderAdmin = () => dropdown('admin');",
      );
      write(
        portal,
        'src/account.ts',
        "import { dropdown } from '@fixture/ui'; export const renderAccount = () => dropdown('portal');",
      );
      write(
        library,
        'playwright.config.ts',
        "export default { testDir: './tests', workers: 1, use: { headless: true } };",
      );
      write(
        library,
        'tests/admin.spec.ts',
        "import { test, expect } from '@playwright/test'; import { renderAdmin } from '../src/admin'; test('Admin retains country', async ({ page }) => { await page.setContent(renderAdmin()); await expect(page.getByRole('combobox', { name: 'Country' })).toHaveValue('AU'); });",
      );
      write(
        library,
        'tests/portal.spec.ts',
        "import { test, expect } from '@playwright/test'; import { renderAccount } from '@fixture/portal'; test('Portal retains country', async ({ page }) => { await page.setContent(renderAccount()); await expect(page.getByRole('combobox', { name: 'Country' })).toHaveValue('AU', { timeout: 100 }); });",
      );
      write(
        library,
        'tests/unrelated.spec.ts',
        "import { test, expect } from '@playwright/test'; test('unrelated invoice', () => { expect(1).toBe(1); });",
      );
      for (const directory of [library, portal]) {
        git(directory, 'init', '-q');
        git(directory, 'add', '.');
        git(directory, 'commit', '-qm', 'Fixture baseline');
      }
      const baseSha = git(library, 'rev-parse', 'HEAD');
      const portalRevision = git(portal, 'rev-parse', 'HEAD');
      fs.mkdirSync(path.join(library, 'node_modules/@fixture'), {
        recursive: true,
      });
      fs.symlinkSync(
        path.join(actualModules, '@playwright'),
        path.join(library, 'node_modules/@playwright'),
        'dir',
      );
      fs.symlinkSync(
        library,
        path.join(library, 'node_modules/@fixture/ui'),
        'dir',
      );
      fs.symlinkSync(
        portal,
        path.join(library, 'node_modules/@fixture/portal'),
        'dir',
      );
      fs.symlinkSync(
        path.join(library, 'node_modules'),
        path.join(portal, 'node_modules'),
        'dir',
      );
      const execute = (
        selectors: string[],
        list = false,
        telemetry = false,
      ) => {
        const reportPath = path.join(
          root,
          list ? 'discovery.json' : 'report.json',
        );
        const result = spawnSync(
          process.execPath,
          [
            playwrightCli,
            'test',
            ...selectors,
            ...(list ? ['--list'] : []),
            `--reporter=json${telemetry ? ',' + path.join(__dirname, fs.existsSync(path.join(__dirname, 'progress-reporter.ts')) ? 'progress-reporter.ts' : 'progress-reporter.js') : ''}`,
          ],
          {
            cwd: library,
            stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
            encoding: 'utf8',
            env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath },
            timeout: 60000,
          },
        );
        assert.equal(result.error, undefined);
        return { result, reportPath };
      };
      assert.equal(execute([]).result.status, 0, 'all baseline journeys pass');
      write(library, 'src/dropdown.ts', dropdown(true));
      git(library, 'add', 'src/dropdown.ts');
      git(library, 'commit', '-qm', 'Break the portal dropdown');
      const headSha = git(library, 'rev-parse', 'HEAD');
      const prepared = await prepareRegressionPlan({
        request: {
          version: 1,
          mode: 'affected',
          sources: [{ repository: 'fixture/ui', baseSha, headSha }],
        },
        policy: {
          version: 1,
          repositories: [
            { repository: 'fixture/ui' },
            { repository: 'fixture/portal', revision: portalRevision },
          ],
          dependencies: [
            {
              source: { repository: 'fixture/ui', path: 'src/dropdown.ts' },
              consumer: {
                repository: 'fixture/portal',
                path: 'src/account.ts',
              },
            },
          ],
          journeys: [
            {
              id: 'admin',
              title: 'Admin',
              sources: [{ repository: 'fixture/ui', path: 'src/admin.ts' }],
              tests: [{ file: 'tests/admin.spec.ts' }],
            },
            {
              id: 'portal',
              title: 'Portal',
              sources: [
                { repository: 'fixture/portal', path: 'src/account.ts' },
              ],
              tests: [{ file: 'tests/portal.spec.ts' }],
            },
          ],
        },
        workspaceDirectory: path.join(root, 'snapshots'),
        testRepository: 'fixture/ui',
        repositoryDirectories: {
          'fixture/ui': library,
          'fixture/portal': portal,
        },
      });
      assert.equal(
        prepared.mode,
        'affected',
        JSON.stringify(prepared.fallbackReasons),
      );
      assert.deepEqual(
        prepared.journeys.map((item) => item.id),
        ['admin', 'portal'],
      );
      const run = await validateRegressionRun({
        plan: prepared,
        workingDir: library,
        discover: async (selectors) => {
          const listed = execute(selectors, true);
          assert.equal(listed.result.status, 0, listed.result.stderr);
          return readRegressionDiscovery(listed.reportPath, library);
        },
      });
      assert.equal(run.discovery.testCount, 2);
      assert.deepEqual(
        run.discovery.files.map((item) => item.file),
        ['tests/admin.spec.ts', 'tests/portal.spec.ts'],
      );
      const executed = execute(run.selectors, false, true);
      const events = String(executed.result.output[3])
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((event) => event.type === 'test_result');
      assert.deepEqual(
        events.map((event) => [event.test.file, event.test.status]),
        [
          ['tests/admin.spec.ts', 'passed'],
          ['tests/portal.spec.ts', 'failed'],
        ],
      );
      assert.equal(
        executed.result.status,
        1,
        'the selected Portal journey exposes the regression',
      );
      const report = readPlaywrightReportData({
        reportPath: executed.reportPath,
        workingDir: library,
        testId: 'fixture-run',
        nodeId: 'fixture-node',
      });
      assert.deepEqual(
        report?.planTests?.map((item) => [item.title, item.status]),
        [
          ['Admin retains country', 'PASS'],
          ['Portal retains country', 'FAIL'],
        ],
      );
      assert.equal(
        report?.failures[0].evidenceId,
        report?.planTests?.[1].evidenceId,
      );
      assert.equal(
        (report?.failures[0].location as { file: string }).file,
        'tests/portal.spec.ts',
      );
      writeRegressionArtifacts(library, run);
      assert.equal(
        JSON.parse(
          fs.readFileSync(
            path.join(library, 'playwright-report/regression-plan.json'),
            'utf8',
          ),
        ).plan.hash,
        prepared.hash,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
