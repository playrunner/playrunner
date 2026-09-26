export type TestPlan = {
  name: string;
  markdown: string;
  cases: Array<{
    id: string;
    description: string;
    criteria: string;
    tests: Array<{ title: string; project: string }>;
  }>;
};
export type PlanStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'NOT RUN';

export function validateTestPlan(value: unknown): TestPlan {
  const plan = value as TestPlan;
  if (
    !plan ||
    typeof plan.name !== 'string' ||
    !/^[^/\\]{1,200}\.md$/i.test(plan.name) ||
    plan.name.includes(String.fromCharCode(0)) ||
    typeof plan.markdown !== 'string' ||
    !plan.markdown.trim() ||
    Buffer.byteLength(plan.markdown) > 256 * 1024 ||
    !Array.isArray(plan.cases) ||
    plan.cases.length > 200 ||
    Buffer.byteLength(JSON.stringify(plan)) > 1024 * 1024
  )
    throw new Error(
      'Test plan must be a non-empty Markdown file up to 256 KB with at most 200 cases.',
    );
  const ids = new Set<string>();
  for (const item of plan.cases) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.description !== 'string' ||
      item.description.length > 10000 ||
      typeof item.criteria !== 'string' ||
      item.criteria.length > 10000 ||
      !Array.isArray(item.tests) ||
      item.tests.length > 100
    )
      throw new Error(
        'Plan cases require unique IDs, descriptions, criteria, and explicit test mappings.',
      );
    ids.add(item.id);
    for (const mapping of item.tests) {
      if (
        !mapping ||
        typeof mapping.title !== 'string' ||
        !mapping.title.trim() ||
        mapping.title.length > 2000 ||
        typeof mapping.project !== 'string' ||
        mapping.project.length > 200
      )
        throw new Error(
          'Each test mapping requires an exact title and project (empty for the default project).',
        );
    }
  }
  // Strip unexpected input properties before saving or rendering.
  return {
    name: plan.name,
    markdown: plan.markdown,
    cases: plan.cases.map((c) => ({
      id: c.id,
      description: c.description,
      criteria: c.criteria,
      tests: c.tests.map((t) => ({ title: t.title, project: t.project })),
    })),
  };
}

type ReportTest = {
  title: string;
  project: string;
  status: PlanStatus;
  evidenceId: string;
};
function readTests(report: any): ReportTest[] {
  const tests: ReportTest[] = [];
  let visited = 0;
  const walk = (suite: any, parents: string[], depth: number) => {
    if (++visited > 20000 || depth > 50)
      throw new Error('Test report exceeds plan traversal limits.');
    // Playwright's outer suite title is a filename; nested suites are describe groups.
    const titles =
      suite.title && suite.column !== 0 && suite.line !== 0
        ? [...parents, String(suite.title)]
        : parents;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const last = results.at(-1);
        const status: PlanStatus = !last
          ? 'NOT RUN'
          : last.status === 'skipped'
            ? 'SKIPPED'
            : last.status === 'passed' && test.status !== 'unexpected'
              ? 'PASS'
              : last.status === 'interrupted'
                ? 'BLOCKED'
                : 'FAIL';
        tests.push({
          title: [...titles, spec.title].join(' › '),
          project: test.projectName ?? '',
          status,
          evidenceId: String(spec.id ?? ''),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, titles, depth + 1);
  };
  for (const suite of report?.suites ?? []) walk(suite, [], 0);
  return tests;
}

export function evaluateTestPlan(plan: TestPlan, report: unknown) {
  const tests = readTests(report);
  const reportErrors =
    Array.isArray((report as any)?.errors) && (report as any).errors.length > 0;
  const cases = plan.cases.map((item) => {
    const matches = item.tests.map((mapping) =>
      tests.filter(
        (test) =>
          test.title === mapping.title && test.project === mapping.project,
      ),
    );
    const evidence = matches.flat();
    const missing = matches.some((group) => group.length === 0);
    const ambiguous = matches.some((group) => group.length > 1);
    let status: PlanStatus;
    let reason = '';
    if (!item.criteria.trim()) {
      status = 'BLOCKED';
      reason = 'SUCCESS/PASS criteria have not been defined.';
    } else if (!item.tests.length) {
      status = 'NOT RUN';
      reason =
        'No executable tests mapped; manual verification remains unresolved.';
    } else if (evidence.some((test) => test.status === 'FAIL')) {
      status = 'FAIL';
      reason = 'A required test failed.';
    } else if (missing || ambiguous || reportErrors) {
      status = 'BLOCKED';
      reason = missing
        ? 'A required test/project result is missing.'
        : ambiguous
          ? 'Mapping matches multiple tests; use a unique full title.'
          : 'The test runner reported a global error.';
    } else if (
      evidence.some(
        (test) => test.status === 'BLOCKED' || test.status === 'NOT RUN',
      )
    ) {
      status = 'BLOCKED';
      reason = 'A required test did not finish.';
    } else if (evidence.some((test) => test.status === 'SKIPPED')) {
      status = 'SKIPPED';
      reason = 'A required test was skipped.';
    } else {
      status = 'PASS';
      reason = 'All explicitly mapped tests passed.';
    }
    return { ...item, status, reason, evidence };
  });
  const counts = {
    PASS: 0,
    FAIL: 0,
    BLOCKED: 0,
    SKIPPED: 0,
    'NOT RUN': 0,
    unmapped: 0,
  };
  for (const item of cases) {
    counts[item.status]++;
    if (!item.tests.length) counts.unmapped++;
  }
  const status: PlanStatus = cases.some((c) => c.status === 'FAIL')
    ? 'FAIL'
    : cases.length > 0 &&
        cases.every((c) => c.status === 'PASS') &&
        !reportErrors
      ? 'PASS'
      : 'BLOCKED';
  return { status, counts, cases };
}
