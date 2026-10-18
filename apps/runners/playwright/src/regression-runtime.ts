import fs from 'node:fs';
import path from 'node:path';
import {
  widenRegressionPlan,
  type RegressionPlan,
} from '../../shared/regression';

export type RegressionDiscovery = {
  status: 'ready' | 'blocked';
  testCount: number;
  files: Array<{ file: string; project: string }>;
  blockReason?: string;
};

// Playwright CLI positional arguments are regular expressions matched against
// absolute file paths, not literal filenames or shell globs.
export function regressionFileSelectors(
  plan: RegressionPlan,
  workingDir: string,
): string[] {
  if (plan.mode === 'full') return [];
  workingDir = fs.existsSync(workingDir)
    ? fs.realpathSync(workingDir)
    : path.resolve(workingDir);
  return [...new Set(plan.tests.map((item) => item.file))].map((file) => {
    const absolute = path.resolve(workingDir, file);
    const relative = path.relative(workingDir, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        'Regression test files must be inside the test workspace.',
      );
    }
    return `^${absolute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  });
}

export function readRegressionDiscovery(
  reportPath: string,
  workingDir: string,
): RegressionDiscovery {
  if (fs.statSync(reportPath).size > 16 * 1024 * 1024) {
    throw new Error('Regression discovery report exceeds the 16 MB limit.');
  }
  workingDir = fs.realpathSync(workingDir);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (!report || !Array.isArray(report.suites)) {
    throw new Error('Regression discovery report is malformed.');
  }
  if (Array.isArray(report.errors) && report.errors.length) {
    throw new Error(
      'Playwright reported errors while discovering regression tests.',
    );
  }
  const files = new Map<string, { file: string; project: string }>();
  const pending = [...report.suites];
  let visited = 0;
  let testCount = 0;
  while (pending.length) {
    if (++visited > 20000) {
      throw new Error('Regression discovery exceeds traversal limits.');
    }
    const suite = pending.shift();
    if (!suite || typeof suite !== 'object') continue;
    if (Array.isArray(suite.suites)) pending.push(...suite.suites);
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      if (typeof spec?.file !== 'string') {
        throw new Error('Discovered test has no source file.');
      }
      const absolute = path.resolve(
        report.config?.rootDir || workingDir,
        spec.file,
      );
      const file = path
        .relative(workingDir, absolute)
        .split(path.sep)
        .join('/');
      if (!file || file.startsWith('../') || path.isAbsolute(file)) {
        throw new Error(
          'Discovered regression tests are outside the test workspace.',
        );
      }
      for (const item of Array.isArray(spec.tests) ? spec.tests : []) {
        const project =
          typeof item?.projectName === 'string' ? item.projectName : '';
        files.set(`${file}\0${project}`, { file, project });
        testCount++;
      }
    }
  }
  return {
    status: testCount ? 'ready' : 'blocked',
    testCount,
    files: [...files.values()].sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.project.localeCompare(b.project),
    ),
    ...(testCount
      ? {}
      : {
          blockReason:
            'No regression tests were discovered. This run cannot establish coverage.',
        }),
  };
}

export type ValidatedRegressionRun = {
  plan: RegressionPlan;
  discovery: RegressionDiscovery;
  selectors: string[];
};

// Discover with the same selectors and authentication config used for execution.
// A missing mapping never becomes a silent passing run: widen once to the full
// suite, and block explicitly if that suite cannot be discovered either.
export async function validateRegressionRun(args: {
  plan: RegressionPlan;
  workingDir: string;
  discover: (selectors: string[]) => Promise<RegressionDiscovery>;
}): Promise<ValidatedRegressionRun> {
  let plan = args.plan;
  if (plan.mode === 'affected' && !plan.tests.length) {
    plan = widenRegressionPlan(
      plan,
      'No mapped tests were selected; running the full suite.',
    );
  }
  let selectors: string[];
  let discovery: RegressionDiscovery;
  try {
    selectors = regressionFileSelectors(plan, args.workingDir);
    discovery = await args.discover(selectors);
    if (plan.mode === 'affected') {
      const missing = plan.tests.some(
        (selected) =>
          !discovery.files.some(
            (actual) =>
              actual.file === selected.file &&
              (selected.project === undefined ||
                selected.project === actual.project),
          ),
      );
      const unexpected = discovery.files.some(
        (actual) =>
          !plan.tests.some((selected) => actual.file === selected.file),
      );
      if (missing || unexpected || !discovery.testCount) {
        throw new Error(
          'Mapped regression tests were not all found by Playwright discovery.',
        );
      }
    }
  } catch (error) {
    if (plan.mode === 'affected') {
      plan = widenRegressionPlan(
        plan,
        error instanceof Error
          ? error.message
          : 'Regression discovery could not validate the mapped tests.',
      );
      selectors = [];
      try {
        discovery = await args.discover(selectors);
      } catch {
        discovery = {
          status: 'blocked',
          testCount: 0,
          files: [],
          blockReason:
            'Full-suite discovery failed after widening the regression run.',
        };
      }
    } else {
      selectors = [];
      discovery = {
        status: 'blocked',
        testCount: 0,
        files: [],
        blockReason: 'Full-suite regression discovery failed.',
      };
    }
  }
  return { plan, discovery, selectors };
}

export function writeRegressionArtifacts(
  workingDir: string,
  run: ValidatedRegressionRun,
) {
  const directory = path.join(workingDir, 'playwright-report');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'regression-plan.json'),
    JSON.stringify({ plan: run.plan, discovery: run.discovery }, null, 2),
  );
}
