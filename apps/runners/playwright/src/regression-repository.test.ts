import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseRegressionPolicy } from '../../shared/regression';
import {
  prepareRegressionPlan,
  regressionGitEnvironment,
  runRegressionGit,
  type RegressionGitRunner,
} from './regression-repository';

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-regression-git-'),
  );
  const repository = path.join(root, 'forms');
  fs.mkdirSync(repository);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.email=regression@example.invalid',
        '-c',
        'user.name=Regression Fixture',
        ...args,
      ],
      { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  git('init', '-b', 'main');
  const write = (name: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repository, name)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(repository, name), text);
  };
  write('src/Dropdown.ts', 'export const selected = true;\n');
  write('src/Checkout.ts', "export { selected } from './Dropdown';\n");
  write(
    'src/Invoice.ts',
    "import { selected } from './Dropdown'; export const value = selected;\n",
  );
  write('src/Profile.ts', 'export const name = "profile";\n');
  git('add', '.');
  git('commit', '-m', 'Fixture baseline');
  const baseSha = git('rev-parse', 'HEAD');
  write('src/Dropdown.ts', 'export const selected = false;\n');
  git('add', '.');
  git('commit', '-m', 'Fixture shared dropdown change');
  const headSha = git('rev-parse', 'HEAD');
  const policy = parseRegressionPolicy({
    version: 1,
    repositories: [{ repository: 'demo/forms' }],
    dependencies: [],
    journeys: [
      {
        id: 'checkout',
        title: 'Checkout selection',
        sources: [{ repository: 'demo/forms', path: 'src/Checkout.ts' }],
        tests: [{ file: 'tests/checkout.spec.ts' }],
      },
      {
        id: 'invoice',
        title: 'Invoice selection',
        sources: [{ repository: 'demo/forms', path: 'src/Invoice.ts' }],
        tests: [{ file: 'tests/invoice.spec.ts' }],
      },
      {
        id: 'profile',
        title: 'Profile',
        sources: [{ repository: 'demo/forms', path: 'src/Profile.ts' }],
        tests: [{ file: 'tests/profile.spec.ts' }],
      },
    ],
  });
  return {
    root,
    repository,
    git,
    write,
    baseSha,
    headSha,
    policy,
    request: {
      version: 1,
      mode: 'affected',
      sources: [{ repository: 'demo/forms', baseSha, headSha }],
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('real local Git snapshots find a shared change and select both forms', async () => {
  const f = fixture();
  try {
    const before = f.git('status', '--porcelain');
    const seen: string[][] = [];
    const git: RegressionGitRunner = (args, options) => {
      seen.push(args);
      return runRegressionGit(args, options);
    };
    const result = await prepareRegressionPlan({
      request: f.request,
      policy: f.policy,
      workspaceDirectory: path.join(f.root, 'cache'),
      repositoryDirectories: { 'demo/forms': f.repository },
      testRepository: 'demo/forms',
      githubToken: 'fixture-secret-never-in-argv',
      git,
    });
    assert.equal(result.mode, 'affected');
    assert.deepEqual(result.changedFiles, [
      { repository: 'demo/forms', path: 'src/Dropdown.ts', status: 'modified' },
    ]);
    assert.deepEqual(
      result.tests.map((item) => item.file),
      ['tests/checkout.spec.ts', 'tests/invoice.spec.ts'],
    );
    assert.deepEqual(
      result.snapshotRevisions.map((item) => item.revision).sort(),
      [f.baseSha, f.headSha].sort(),
    );
    assert.equal(f.git('status', '--porcelain'), before);
    assert.ok(seen.every((args) => !args.join(' ').includes('fixture-secret')));
    assert.ok(!seen.some((args) => args.includes('fetch')));
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'cache')), []);
  } finally {
    f.cleanup();
  }
});

test('real Git rename preserves the prior path and maps old/new imports', async () => {
  const f = fixture();
  try {
    const baseSha = f.headSha;
    f.git('mv', 'src/Dropdown.ts', 'src/Select.ts');
    f.write('src/Checkout.ts', "export { selected } from './Select';\n");
    f.write(
      'src/Invoice.ts',
      "import { selected } from './Select'; export const value = selected;\n",
    );
    f.git('add', '.');
    f.git('commit', '-m', 'Rename dropdown');
    const result = await prepareRegressionPlan({
      request: {
        ...f.request,
        sources: [
          {
            repository: 'demo/forms',
            baseSha,
            headSha: f.git('rev-parse', 'HEAD'),
          },
        ],
      },
      policy: f.policy,
      workspaceDirectory: path.join(f.root, 'cache'),
      repositoryDirectories: { 'demo/forms': f.repository },
    });
    assert.equal(result.mode, 'affected');
    assert.ok(
      result.changedFiles.some(
        (item) =>
          item.status === 'renamed' &&
          item.previousPath === 'src/Dropdown.ts' &&
          item.path === 'src/Select.ts',
      ),
    );
    assert.equal(result.tests.length, 2);
  } finally {
    f.cleanup();
  }
});

test('real Git snapshots follow an explicitly linked consumer repository at its saved pin', async () => {
  const shared = fixture();
  const billing = fixture();
  try {
    billing.write(
      'src/Payment.ts',
      "import { selected } from '@demo/ui/dropdown'; export const Payment = selected;\n",
    );
    billing.git('add', '.');
    billing.git('commit', '-m', 'Consumer of external dropdown');
    const consumerPin = billing.git('rev-parse', 'HEAD');
    const policy = {
      ...shared.policy,
      repositories: [
        ...shared.policy.repositories,
        { repository: 'demo/billing', revision: consumerPin },
      ],
      dependencies: [
        {
          source: { repository: 'demo/forms', path: 'src/Dropdown.ts' },
          consumer: { repository: 'demo/billing', path: 'src/Payment.ts' },
          specifier: '@demo/ui/dropdown',
        },
      ],
      journeys: [
        ...shared.policy.journeys,
        {
          id: 'payment',
          title: 'Billing payment',
          sources: [{ repository: 'demo/billing', path: 'src/Payment.ts' }],
          tests: [{ file: 'tests/payment.spec.ts' }],
        },
      ],
    };
    const result = await prepareRegressionPlan({
      request: shared.request,
      policy,
      workspaceDirectory: path.join(shared.root, 'cache'),
      repositoryDirectories: {
        'demo/forms': shared.repository,
        'demo/billing': billing.repository,
      },
    });
    assert.equal(result.mode, 'affected');
    assert.equal(result.tests.length, 3);
    assert.ok(
      result.snapshotRevisions.some(
        (item) =>
          item.repository === 'demo/billing' && item.revision === consumerPin,
      ),
    );
    assert.deepEqual(
      result.journeys.find((item) => item.id === 'payment')?.reasons[0].path,
      [
        { repository: 'demo/forms', path: 'src/Dropdown.ts' },
        { repository: 'demo/billing', path: 'src/Payment.ts' },
      ],
    );
  } finally {
    shared.cleanup();
    billing.cleanup();
  }
});

test('real Git deletion keeps affected journeys from the base graph', async () => {
  const f = fixture();
  try {
    f.git('rm', 'src/Dropdown.ts');
    f.write('src/Checkout.ts', 'export const selected = false;');
    f.write('src/Invoice.ts', 'export const value = false;');
    f.git('add', '.');
    f.git('commit', '-m', 'Remove shared control');
    const result = await prepareRegressionPlan({
      request: {
        ...f.request,
        sources: [
          {
            repository: 'demo/forms',
            baseSha: f.headSha,
            headSha: f.git('rev-parse', 'HEAD'),
          },
        ],
      },
      policy: f.policy,
      workspaceDirectory: path.join(f.root, 'cache'),
      repositoryDirectories: { 'demo/forms': f.repository },
    });
    assert.equal(result.mode, 'affected');
    assert.ok(result.changedFiles.some((item) => item.status === 'deleted'));
    assert.equal(result.tests.length, 2);
  } finally {
    f.cleanup();
  }
});

test('missing saved policy runs broad checks instead of claiming no affected tests', async () => {
  const f = fixture();
  try {
    const result = await prepareRegressionPlan({
      request: f.request,
      workspaceDirectory: path.join(f.root, 'cache'),
      testRepository: 'demo/forms',
      repositoryDirectories: { 'demo/forms': f.repository },
    });
    assert.equal(result.mode, 'full');
    assert.ok(
      result.fallbackReasons.includes(
        'No saved regression mapping is configured',
      ),
    );
  } finally {
    f.cleanup();
  }
});

test('missing consumer pins and foreign source mappings widen without cloning unauthorized repositories', async () => {
  const f = fixture();
  try {
    const seen: string[][] = [];
    const result = await prepareRegressionPlan({
      request: {
        ...f.request,
        sources: [
          ...f.request.sources,
          {
            repository: 'demo/foreign',
            baseSha: 'c'.repeat(40),
            headSha: 'd'.repeat(40),
          },
        ],
      },
      policy: {
        ...f.policy,
        repositories: [
          ...f.policy.repositories,
          { repository: 'demo/consumer' },
        ],
      },
      workspaceDirectory: path.join(f.root, 'cache'),
      repositoryDirectories: { 'demo/forms': f.repository },
      git: (args, options) => {
        seen.push(args);
        return runRegressionGit(args, options);
      },
    });
    assert.equal(result.mode, 'full');
    assert.ok(
      result.fallbackReasons.some((item) =>
        item.includes('immutable revision: demo/consumer'),
      ),
    );
    assert.ok(
      result.fallbackReasons.some((item) =>
        item.includes('no mapping in this test node: demo/foreign'),
      ),
    );
    assert.ok(
      !seen.some((args) =>
        args.some((arg) => arg.includes('github.com/demo/foreign')),
      ),
    );
  } finally {
    f.cleanup();
  }
});

test('immutable verification errors are blocked and never expose Git error text', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      prepareRegressionPlan({
        request: f.request,
        policy: f.policy,
        workspaceDirectory: path.join(f.root, 'cache'),
        repositoryDirectories: { 'demo/forms': f.repository },
        git: async () => {
          throw new Error('provider error fixture-secret');
        },
      }),
      (error: Error) =>
        /Could not verify immutable/.test(error.message) &&
        !error.message.includes('fixture-secret'),
    );
  } finally {
    f.cleanup();
  }
});

test('Git output limits fail closed and token travels only through environment', async () => {
  const environment = regressionGitEnvironment('fixture-secret');
  assert.equal(environment.GIT_TERMINAL_PROMPT, '0');
  assert.equal(environment.GIT_NO_REPLACE_OBJECTS, '1');
  assert.match(environment.GIT_CONFIG_VALUE_0 || '', /^Authorization: Basic /);
  await assert.rejects(
    runRegressionGit(['--version'], {
      environment,
      maxOutputBytes: 1,
      timeoutMs: 1000,
    }),
    /exceeded/,
  );
});
