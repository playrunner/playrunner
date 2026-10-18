import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegressionPlan,
  parseRegressionPolicy,
  parseRegressionRequest,
  REGRESSION_LIMITS,
  widenRegressionPlan,
  type RegressionPolicy,
  type RegressionSnapshot,
} from './regression';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const consumerPin = 'c'.repeat(40);
const request = parseRegressionRequest({
  version: 1,
  mode: 'affected',
  sources: [{ repository: 'demo/forms', baseSha: base, headSha: head }],
});
const policy = parseRegressionPolicy({
  version: 1,
  repositories: [
    { repository: 'demo/forms', aliases: { '@ui/*': 'src/ui/*' } },
  ],
  dependencies: [],
  journeys: [
    {
      id: 'checkout',
      title: 'Checkout country',
      sources: [{ repository: 'demo/forms', path: 'src/Checkout.tsx' }],
      tests: [{ file: 'tests/checkout.spec.ts' }],
    },
    {
      id: 'invoice',
      title: 'Invoice currency',
      sources: [{ repository: 'demo/forms', path: 'src/Invoice.tsx' }],
      tests: [{ file: 'tests/invoice.spec.ts', project: 'desktop' }],
    },
    {
      id: 'profile',
      title: 'Profile name',
      sources: [{ repository: 'demo/forms', path: 'src/Profile.tsx' }],
      tests: [{ file: 'tests/profile.spec.ts' }],
    },
  ],
});
const files = {
  'src/ui/Dropdown.tsx': 'export const Dropdown = () => null;',
  'src/ui/index.ts': "export { Dropdown } from './Dropdown';",
  'src/Checkout.tsx':
    "import { Dropdown } from '@ui/index'; export const Checkout = Dropdown;",
  'src/Invoice.tsx':
    "import { Dropdown } from './ui/Dropdown.js'; export const Invoice = Dropdown;",
  'src/Profile.tsx': 'export const Profile = () => null;',
};
const snapshots: RegressionSnapshot[] = [base, head].map((revision) => ({
  repository: 'demo/forms',
  revision,
  files,
}));
const change = {
  repository: 'demo/forms',
  path: 'src/ui/Dropdown.tsx',
  status: 'modified' as const,
};
const plan = (
  overrides: Partial<Parameters<typeof buildRegressionPlan>[0]> = {},
) =>
  buildRegressionPlan({
    request,
    policy,
    snapshots,
    changes: [change],
    ...overrides,
  });

test('shared dropdown selects both consuming journeys and excludes unrelated forms', () => {
  const result = plan();
  assert.equal(result.mode, 'affected');
  assert.deepEqual(result.tests, [
    { file: 'tests/checkout.spec.ts' },
    { file: 'tests/invoice.spec.ts', project: 'desktop' },
  ]);
  assert.deepEqual(
    result.journeys
      .find((journey) => journey.id === 'checkout')
      ?.reasons[0].path.map((item) => item.path),
    ['src/ui/Dropdown.tsx', 'src/ui/index.ts', 'src/Checkout.tsx'],
  );
  assert.equal(result.fallbackReasons.length, 0);
  assert.match(result.hash, /^[a-f0-9]{64}$/);
  assert.equal(plan().hash, result.hash);
});

test('base graph retains a removed consumer dependency', () => {
  const result = plan({
    snapshots: [
      snapshots[0],
      {
        ...snapshots[1],
        files: {
          ...files,
          'src/Invoice.tsx': 'export const Invoice = () => null;',
        },
      },
    ],
  });
  assert.equal(result.mode, 'affected');
  assert.ok(result.tests.some((item) => item.file === 'tests/invoice.spec.ts'));
});

test('deletion and rename follow old and new file identities', () => {
  const renamedFiles = Object.fromEntries(
    Object.entries(files).filter(([name]) => name !== 'src/ui/Dropdown.tsx'),
  );
  const result = plan({
    snapshots: [
      snapshots[0],
      {
        ...snapshots[1],
        files: {
          ...renamedFiles,
          'src/ui/Select.tsx': files['src/ui/Dropdown.tsx'],
          'src/ui/index.ts': "export { Dropdown } from './Select';",
          'src/Invoice.tsx': "import { Dropdown } from './ui/Select';",
        },
      },
    ],
    changes: [
      {
        ...change,
        path: 'src/ui/Select.tsx',
        previousPath: change.path,
        status: 'renamed',
      },
    ],
  });
  assert.equal(result.mode, 'affected');
  assert.equal(result.tests.length, 2);
  const deleted = plan({
    changes: [{ ...change, status: 'deleted' }],
    snapshots: [
      snapshots[0],
      {
        ...snapshots[1],
        files: {
          'src/Checkout.tsx': '',
          'src/Invoice.tsx': '',
          'src/Profile.tsx': '',
        },
      },
    ],
  });
  assert.equal(deleted.mode, 'affected');
  assert.equal(deleted.tests.length, 2);
});

test('explicit cross-repository edge selects a consumer test at its immutable pin', () => {
  const crossPolicy: RegressionPolicy = {
    ...policy,
    repositories: [
      ...policy.repositories,
      { repository: 'demo/billing', revision: consumerPin },
    ],
    dependencies: [
      {
        source: { repository: 'demo/forms', path: change.path },
        consumer: { repository: 'demo/billing', path: 'src/Payment.tsx' },
        specifier: '@shared/ui/dropdown',
      },
    ],
    journeys: [
      ...policy.journeys,
      {
        id: 'payment',
        title: 'Billing payment',
        sources: [{ repository: 'demo/billing', path: 'src/Payment.tsx' }],
        tests: [{ file: 'tests/billing.spec.ts' }],
      },
    ],
  };
  const result = plan({
    policy: crossPolicy,
    snapshots: [
      ...snapshots,
      {
        repository: 'demo/billing',
        revision: consumerPin,
        files: {
          'src/Payment.tsx':
            "import { Dropdown } from '@shared/ui/dropdown'; export const Payment = Dropdown;",
        },
      },
    ],
  });
  assert.equal(result.mode, 'affected');
  assert.equal(result.tests.length, 3);
  assert.deepEqual(
    result.journeys
      .find((item) => item.id === 'payment')
      ?.reasons[0].path.map((item) => item.repository),
    ['demo/forms', 'demo/billing'],
  );
  const unrelated = plan({
    policy: crossPolicy,
    snapshots: [
      ...snapshots,
      {
        repository: 'demo/billing',
        revision: consumerPin,
        files: {
          'src/Payment.tsx':
            "import { Dropdown } from '@shared/ui/dropdown'; import Unknown from '@unmapped/package';",
        },
      },
    ],
  });
  assert.equal(unrelated.mode, 'full');
  assert.ok(
    unrelated.fallbackReasons.some((reason) =>
      reason.includes('@unmapped/package'),
    ),
  );
});

test('one mapped consumer does not conceal another unmapped form', () => {
  const result = plan({
    policy: {
      ...policy,
      journeys: policy.journeys.filter((item) => item.id !== 'invoice'),
    },
  });
  assert.equal(result.mode, 'full');
  assert.ok(
    result.fallbackReasons.some((reason) =>
      reason.includes('consumer pathway'),
    ),
  );
});

test('mapping only the shared control still requires mappings for consumer pathways', () => {
  const result = plan({
    policy: {
      ...policy,
      journeys: [
        {
          id: 'dropdown',
          title: 'Dropdown unit',
          sources: [{ repository: change.repository, path: change.path }],
          tests: [{ file: 'tests/dropdown.spec.ts' }],
        },
      ],
    },
  });
  assert.equal(result.mode, 'full');
});

test('a mapped intermediate wrapper cannot hide an unmapped downstream form', () => {
  const result = plan({
    snapshots: snapshots.map((snapshot) => ({
      ...snapshot,
      files: {
        ...files,
        'src/OtherForm.tsx':
          "import { Checkout } from './Checkout'; export const OtherForm = Checkout;",
      },
    })),
  });
  assert.equal(result.mode, 'full');
  assert.ok(
    result.fallbackReasons.some((reason) =>
      reason.includes('consumer pathway'),
    ),
  );
});

test('exact mapped test files are covered leaves in the declared test repository and folder', () => {
  const withTests = snapshots.map((snapshot) => ({
    ...snapshot,
    files: {
      ...files,
      'e2e/tests/checkout.spec.ts':
        "import { Checkout } from '../../src/Checkout';",
      'e2e/tests/invoice.spec.ts':
        "import { Invoice } from '../../src/Invoice';",
    },
  }));
  const result = plan({
    snapshots: withTests,
    testRepository: 'demo/forms',
    testFolder: 'e2e',
  });
  assert.equal(result.mode, 'affected');
  assert.equal(
    plan({
      snapshots: withTests,
      testRepository: 'demo/forms',
      testFolder: 'other',
    }).mode,
    'full',
  );
});

test('unresolved aliases, dynamic imports, and unbounded import globs widen the suite', () => {
  for (const text of [
    "import Widget from '@missing/Widget';",
    'const Widget = import(moduleName);',
    "const Widget = import('./ui/' + moduleName);",
    "const Widget = require('./ui/' + moduleName);",
    "const modules = import.meta.glob('./*.tsx');",
    "const modules = import.meta.globEager('./*.tsx');",
    "const modules = require.context('./ui', true);",
    "const load = require; const Widget = load('./ui/Dropdown');",
    "const Widget = eval('loadWidget()');",
    'const data = `${import(moduleName)}`;',
  ]) {
    const result = plan({
      snapshots: snapshots.map((snapshot) => ({
        ...snapshot,
        files: { ...files, 'src/Unknown.ts': text },
      })),
    });
    assert.equal(result.mode, 'full', text);
    assert.ok(
      result.fallbackReasons.some((reason) =>
        /[Uu]nresolved|specifier|glob|template|[Cc]omputed|[Dd]ynamic|Aliased|Runtime-generated/.test(
          reason,
        ),
      ),
    );
  }
});

test('declared external packages are not treated as unresolved local aliases', () => {
  const result = plan({
    snapshots: snapshots.map((snapshot) => ({
      ...snapshot,
      files: {
        ...files,
        'package.json': JSON.stringify({ dependencies: { react: '19.0.0' } }),
        'src/Profile.tsx':
          "import React from 'react'; export const Profile = React.createElement;",
      },
    })),
  });
  assert.equal(result.mode, 'affected');
});

test('configuration changes, unsupported files, empty changes and missing snapshots widen', () => {
  const cases: Array<Partial<Parameters<typeof buildRegressionPlan>[0]>> = [
    { changes: [{ ...change, path: 'package-lock.json' }] },
    { changes: [{ ...change, path: 'src/styles.css' }] },
    { changes: [] },
    { snapshots: [snapshots[1]] },
    { policy: { ...policy, journeys: [] } },
  ];
  for (const input of cases) assert.equal(plan(input).mode, 'full');
  const unsupportedConsumer = plan({
    snapshots: snapshots.map((snapshot) => ({
      ...snapshot,
      files: { ...files, 'src/OtherForm.vue': null },
    })),
  });
  assert.equal(unsupportedConsumer.mode, 'full');
  assert.ok(
    unsupportedConsumer.fallbackReasons.some((reason) =>
      reason.includes('untracked consumers'),
    ),
  );
});

test('explicit full mode preserves its selection explanation and widening rehashes', () => {
  const focused = plan();
  const full = plan({ request: { ...request, mode: 'full' } });
  assert.equal(full.mode, 'full');
  assert.equal(full.requestedMode, 'full');
  assert.deepEqual(full.tests, focused.tests);
  const widened = widenRegressionPlan(
    focused,
    'A selected file is missing from Playwright discovery',
  );
  assert.equal(widened.mode, 'full');
  assert.notEqual(widened.hash, focused.hash);
  assert.equal(
    widenRegressionPlan(widened, widened.fallbackReasons[0]).hash,
    widened.hash,
  );
});

test('parsers reject ambiguous identities, traversal, arbitrary properties and unmapped repositories', () => {
  for (const source of [
    {
      repository: 'https://github.com/demo/forms',
      baseSha: base,
      headSha: head,
    },
    { repository: 'demo/forms', baseSha: 'main', headSha: head },
    { repository: 'demo/forms', baseSha: head, headSha: head },
    {
      repository: 'demo/forms',
      baseSha: base,
      headSha: head,
      token: 'not allowed',
    },
  ])
    assert.throws(() =>
      parseRegressionRequest({
        version: 1,
        mode: 'affected',
        sources: [source],
      }),
    );
  assert.throws(() =>
    parseRegressionRequest({
      ...request,
      sources: [...request.sources, ...request.sources],
    }),
  );
  assert.throws(() =>
    parseRegressionPolicy({
      ...policy,
      journeys: [
        { ...policy.journeys[0], tests: [{ file: '../outside.spec.ts' }] },
      ],
    }),
  );
  assert.throws(() =>
    parseRegressionPolicy({
      ...policy,
      dependencies: [
        {
          source: { repository: 'other/private', path: 'index.ts' },
          consumer: policy.journeys[0].sources[0],
        },
      ],
    }),
  );
  assert.throws(() =>
    parseRegressionPolicy({
      ...policy,
      repositories: [
        { repository: 'demo/forms', aliases: { '@ui/*': '../escape/*' } },
      ],
    }),
  );
  assert.equal(
    parseRegressionRequest({
      ...request,
      sources: [
        {
          repository: 'Demo/Forms',
          baseSha: base.toUpperCase(),
          headSha: head.toUpperCase(),
        },
      ],
    }).sources[0].repository,
    'demo/forms',
  );
});

test('large impact evidence is bounded and widens instead of silently truncating focused coverage', () => {
  const sourcePath = `src/${'x'.repeat(850)}.ts`;
  const largePolicy = parseRegressionPolicy({
    version: 1,
    repositories: [{ repository: 'demo/forms' }],
    journeys: Array.from({ length: 300 }, (_, index) => ({
      id: `journey-${index}`,
      title: `Journey ${index}`,
      sources: [{ repository: 'demo/forms', path: sourcePath }],
      tests: [{ file: `tests/${'t'.repeat(850)}-${index}.spec.ts` }],
    })),
  });
  const result = plan({
    policy: largePolicy,
    snapshots: [base, head].map((revision) => ({
      repository: 'demo/forms',
      revision,
      files: { [sourcePath]: 'export const item = 1;' },
    })),
    changes: [{ ...change, path: sourcePath }],
  });
  assert.equal(result.mode, 'full');
  assert.ok(
    Buffer.byteLength(JSON.stringify(result)) < REGRESSION_LIMITS.planBytes,
  );
  assert.ok((result.truncation?.journeysOmitted || 0) > 0);
  assert.ok(
    Buffer.byteLength(
      JSON.stringify(widenRegressionPlan(result, 'x'.repeat(1_000_000))),
    ) < REGRESSION_LIMITS.planBytes,
  );
});
