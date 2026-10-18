import { projectExecution } from './execution-dashboard';
import { sanitizeWorkflowLogMessage } from './execution-events';
import {
  readTestProgress,
  readTestResultEvent,
} from '../../../runners/shared/test-progress';

export const FEEDBACK_EVENT_TYPES = [
  'node_state',
  'node_started',
  'node_completed',
  'node_failed',
  'node_cancelled',
  'test_progress',
  'test_result',
  'regression_plan',
  'node_output',
  'workflow_completed',
  'workflow_failed',
  'workflow_cancelled',
];
export const FEEDBACK_PAGE_SIZE = 100;
export const FEEDBACK_SNAPSHOT_LIMIT = 1000;
const MAX_NODES = 100;
const MAX_FAILURES = 25;
const MAX_JOURNEYS = 100;

export type FeedbackEvent = {
  id: bigint;
  type: string;
  nodeId: string | null;
  payload: unknown;
  occurredAt: Date | null;
  createdAt: Date;
};
export type FeedbackExecution = {
  id: string;
  workflowId: string | null;
  status: string;
  cloudProvider: string;
  startedAt: Date;
  completedAt: Date | null;
  lastEventAt?: Date | null;
};
const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, max = 500) =>
  sanitizeWorkflowLogMessage(value)?.slice(0, max) ?? '';
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value)
    ? value
    : null;
const hasControl = (value: string) =>
  [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

export function parseFeedbackCursor(value: unknown): bigint {
  if (value === undefined) return 0n;
  if (
    typeof value !== 'string' ||
    !/^\d{1,19}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new Error('after must be a non-negative event cursor.');
  return BigInt(value);
}

export function feedbackArtifactPath(
  value: unknown,
  executionId: string,
): string | null {
  if (
    typeof value !== 'string' ||
    value.length > 2000 ||
    /[?#\\]/.test(value) ||
    hasControl(value)
  )
    return null;
  try {
    const decoded = decodeURIComponent(value);
    // Encoded separators and double-encoded traversal must not create another path.
    if (
      /[%?#\\]/.test(decoded) ||
      hasControl(decoded) ||
      !decoded.startsWith(`/outputs/${executionId}/`)
    )
      return null;
    if (decoded.split('/').some((part) => part === '.' || part === '..'))
      return null;
    return value.startsWith(`/outputs/${executionId}/`) ? value : null;
  } catch {
    return null;
  }
}

function fileName(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > 500 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    hasControl(value) ||
    value.split('/').includes('..')
  )
    return '';
  return text(value);
}

function safePlan(value: unknown) {
  const plan = record(value);
  if (
    plan.version !== 1 ||
    !['affected', 'full'].includes(plan.mode) ||
    !['affected', 'full'].includes(plan.requestedMode)
  )
    return null;
  const files = (value: unknown) =>
    list(value)
      .slice(0, 100)
      .map((test) => ({
        file: fileName(record(test).file),
        ...(typeof record(test).project === 'string'
          ? { project: text(record(test).project, 100) }
          : {}),
      }))
      .filter((test) => test.file);
  const omitted = (key: string) => {
    const value = record(plan.truncation)[key];
    return value === undefined
      ? 0
      : Number.isSafeInteger(value) && value >= 0
        ? (value as number)
        : null;
  };
  const truncation = {
    changedFilesOmitted: omitted('changedFilesOmitted'),
    testsOmitted: omitted('testsOmitted'),
    journeysOmitted: omitted('journeysOmitted'),
    reasonsOmitted: omitted('reasonsOmitted'),
  };
  return {
    version: 1,
    requestedMode: plan.requestedMode as 'affected' | 'full',
    mode: plan.mode as 'affected' | 'full',
    hash:
      typeof plan.hash === 'string' && /^[a-f0-9]{64}$/.test(plan.hash)
        ? plan.hash
        : null,
    policyHash:
      typeof plan.policyHash === 'string' &&
      /^[a-f0-9]{64}$/.test(plan.policyHash)
        ? plan.policyHash
        : null,
    sources: list(plan.sources)
      .slice(0, 16)
      .map((source) => ({
        repository: text(record(source).repository, 201),
        baseSha: /^[a-f0-9]{40}$/.test(record(source).baseSha)
          ? record(source).baseSha
          : null,
        headSha: /^[a-f0-9]{40}$/.test(record(source).headSha)
          ? record(source).headSha
          : null,
      })),
    changedFileCount:
      truncation.changedFilesOmitted === null
        ? null
        : list(plan.changedFiles).length + truncation.changedFilesOmitted,
    selectedTestFiles: files(plan.tests),
    selectedTestFileCount:
      truncation.testsOmitted === null
        ? null
        : list(plan.tests).length + truncation.testsOmitted,
    selectedJourneyCount:
      truncation.journeysOmitted === null
        ? null
        : list(plan.journeys).length + truncation.journeysOmitted,
    truncation,
    journeys: list(plan.journeys)
      .slice(0, MAX_JOURNEYS)
      .map((journey) => ({
        id: text(record(journey).id, 100),
        title: text(record(journey).title, 200),
        tests: files(record(journey).tests),
        reasons: list(record(journey).reasons)
          .slice(0, 5)
          .map((reason) => ({
            repository: text(record(record(reason).changed).repository, 201),
            changedPath: fileName(record(record(reason).changed).path),
          })),
      })),
    fallbackReasons: list(plan.fallbackReasons)
      .slice(0, 20)
      .map((reason) => text(reason, 300)),
    truncated:
      Object.values(truncation).some((value) => value !== 0) ||
      list(plan.fallbackReasons).length > 20 ||
      list(plan.journeys).length > MAX_JOURNEYS ||
      list(plan.tests).length > 100 ||
      list(plan.journeys).some(
        (journey) =>
          list(record(journey).tests).length > 100 ||
          list(record(journey).reasons).length > 5,
      ),
  };
}

function safeDiscovery(value: unknown) {
  const discovery = record(value);
  if (!['ready', 'blocked'].includes(discovery.status)) return null;
  return {
    status: discovery.status as 'ready' | 'blocked',
    testCount:
      Number.isSafeInteger(discovery.testCount) && discovery.testCount >= 0
        ? discovery.testCount
        : null,
    files: list(discovery.files)
      .slice(0, 100)
      .map((item) => ({
        file: fileName(record(item).file),
        project: text(record(item).project, 100),
      }))
      .filter((item) => item.file),
    truncated: list(discovery.files).length > 100,
    ...(typeof discovery.reason === 'string'
      ? { reason: text(discovery.reason) }
      : {}),
    ...(typeof discovery.blockReason === 'string'
      ? { reason: text(discovery.blockReason) }
      : {}),
  };
}

function finalTests(report: Record<string, any>) {
  return list(report.planTests)
    .slice(0, 10000)
    .filter(
      (test) =>
        typeof test?.title === 'string' &&
        typeof test?.project === 'string' &&
        ['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NOT RUN'].includes(test.status),
    );
}

function safeTestResult(value: unknown) {
  const result = readTestResultEvent(value);
  if (!result) return null;
  return {
    evidenceId: text(result.evidenceId, 200),
    title: text(result.title, 300),
    project: text(result.project, 100),
    file: fileName(result.file),
    status: result.status as 'passed' | 'failed' | 'skipped' | 'blocked',
    ...(result.expectedFailure === true ? { expectedFailure: true } : {}),
    retry:
      Number.isSafeInteger(result.retry) && result.retry >= 0
        ? result.retry
        : 0,
  };
}

export function projectMachineFeedback(params: {
  execution: FeedbackExecution;
  snapshotEvents: FeedbackEvent[];
  pageEvents: FeedbackEvent[];
  after: bigint;
  snapshotTruncated?: boolean;
}) {
  const { execution } = params;
  const events = [...params.snapshotEvents].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const reports = new Map<string, Record<string, any>>();
  const plans = new Map<string, NonNullable<ReturnType<typeof safePlan>>>();
  const discoveries = new Map<
    string,
    NonNullable<ReturnType<typeof safeDiscovery>>
  >();
  const artifacts = new Map<
    string,
    { nodeId: string; kind: string; path: string }
  >();
  const liveResults = new Map<
    string,
    Map<string, NonNullable<ReturnType<typeof safeTestResult>>>
  >();
  let truncated = Boolean(params.snapshotTruncated);
  for (const event of events) {
    const nodeId = identifier(event.nodeId);
    if (!nodeId) continue;
    const payload = record(event.payload);
    if (event.type === 'test_result') {
      const result = safeTestResult(payload.test);
      if (result) {
        const byTest = liveResults.get(nodeId) ?? new Map();
        byTest.set(JSON.stringify([result.evidenceId, result.project]), result);
        liveResults.set(nodeId, byTest);
      }
    }
    const output = event.type === 'node_output' ? record(payload.output) : {};
    const plan = safePlan(
      event.type === 'regression_plan' ? payload.plan : output.regressionPlan,
    );
    if (plan) plans.set(nodeId, plan);
    const discovery = safeDiscovery(
      event.type === 'regression_plan'
        ? payload.discovery
        : output.regressionDiscovery,
    );
    if (discovery) discoveries.set(nodeId, discovery);
    if (output.report) reports.set(nodeId, record(output.report));
    for (const [key, kind] of [
      ['reportUrl', 'html'],
      ['reportDataUrl', 'json'],
      ['regressionPlanUrl', 'regression_plan'],
    ] as const) {
      const path = feedbackArtifactPath(output[key], execution.id);
      if (path) artifacts.set(path, { nodeId, kind, path });
    }
  }
  // The dashboard projection owns shard aggregation and terminal-state rules.
  const snapshot = projectExecution({ ...execution, events });
  const nodes = snapshot.nodes.slice(0, MAX_NODES).map((node) => ({
    id: text(node.id, 100),
    title: text(node.title, 200),
    status: node.status,
    parentNodeId: node.parentNodeId,
    progress: node.progress,
    ...(plans.has(node.id) ? { plan: plans.get(node.id) } : {}),
    ...(discoveries.has(node.id)
      ? { discovery: discoveries.get(node.id) }
      : {}),
  }));
  if (snapshot.nodes.length > MAX_NODES) truncated = true;
  const progressNodes = snapshot.nodes.filter(
    (node) => !node.parentNodeId && node.progress,
  );
  const progress = progressNodes.length
    ? progressNodes.reduce(
        (sum, node) => {
          for (const key of [
            'total',
            'completed',
            'passed',
            'failed',
            'skipped',
            'running',
          ] as const)
            sum[key] += node.progress![key];
          return sum;
        },
        {
          total: 0,
          completed: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          running: 0,
        },
      )
    : null;
  const failures: Array<Record<string, unknown>> = [];
  const issues: Array<{ nodeId: string; message: string }> = [];
  let failureCount = 0;
  let expectedFailureCount = 0;
  const addExpectedFailure = (nodeId: string, title: unknown) => {
    expectedFailureCount++;
    if (issues.length < 20)
      issues.push({
        nodeId,
        message: `Failure expected by test configuration: ${text(title, 300)}. This does not establish a baseline, a new failure alert or passing release evidence.`,
      });
    else truncated = true;
  };
  let evidenceIncomplete =
    Boolean(params.snapshotTruncated) ||
    [...discoveries.values()].some(
      (discovery) => discovery.status === 'blocked',
    );
  for (const [nodeId, report] of reports) {
    const ancestors = new Set<string>();
    let parent = snapshot.nodes.find(
      (node) => node.id === nodeId,
    )?.parentNodeId;
    while (parent && !ancestors.has(parent)) {
      ancestors.add(parent);
      parent = snapshot.nodes.find((node) => node.id === parent)?.parentNodeId;
    }
    if ([...ancestors].some((ancestor) => reports.has(ancestor))) continue;
    const tests = finalTests(report);
    const details = list(report.failures).slice(0, 25).map(record);
    if (
      !Array.isArray(report.planTests) ||
      record(report.truncation).truncated ||
      list(report.planTests).length > 10000
    )
      evidenceIncomplete = true;
    const seen = new Set<string>();
    for (const test of tests.filter((test) => test.status === 'FAIL')) {
      const key = JSON.stringify([test.evidenceId || test.title, test.project]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (test.expectedFailure === true) {
        addExpectedFailure(nodeId, test.title);
        continue;
      }
      failureCount += 1;
      if (failures.length >= MAX_FAILURES) {
        truncated = true;
        continue;
      }
      const candidates = details.filter(
        (detail) =>
          detail.projectName === test.project &&
          ((test.evidenceId && detail.evidenceId === test.evidenceId) ||
            (!detail.evidenceId &&
              (detail.title === test.title ||
                detail.title === `${test.title} — ${test.project}`))),
      );
      const detail = candidates.sort(
        (a, b) => Number(b.retry ?? 0) - Number(a.retry ?? 0),
      )[0];
      const file = fileName(record(detail?.location).file);
      const journeyIds = (plans.get(nodeId)?.journeys ?? [])
        .filter(
          (journey) =>
            file && journey.tests.some((selected) => selected.file === file),
        )
        .map((journey) => journey.id);
      const attachmentPaths = list(detail?.attachments)
        .slice(0, 8)
        .map((attachment) =>
          feedbackArtifactPath(record(attachment).url, execution.id),
        )
        .filter((path): path is string => Boolean(path));
      const error = list(detail?.errors)
        .map((item) =>
          text(typeof item === 'string' ? item : record(item).message, 1200),
        )
        .find(Boolean);
      failures.push({
        nodeId,
        title: text(test.title, 300),
        project: text(test.project, 100),
        evidenceId: text(test.evidenceId, 200),
        status: 'failed',
        journeyIds,
        ...(file ? { file } : {}),
        ...(error ? { error } : {}),
        artifacts: attachmentPaths,
      });
    }
    for (const error of list(report.errors).slice(0, 5)) {
      const message = text(
        typeof error === 'string' ? error : record(error).message,
        1200,
      );
      if (message) issues.push({ nodeId, message });
    }
  }
  for (const node of nodes)
    if (node.status === 'failed' && !reports.has(node.id))
      evidenceIncomplete = true;
  for (const node of snapshot.nodes) {
    if (
      node.type === 'playwright' &&
      (['completed', 'failed', 'cancelled'].includes(snapshot.status) ||
        ['succeeded', 'failed', 'cancelled', 'skipped'].includes(
          node.status,
        )) &&
      !reports.has(node.id)
    )
      evidenceIncomplete = true;
  }
  for (const [nodeId, tests] of liveResults) {
    // The end-of-node report is authoritative, even if live reporter IDs differ.
    if (reports.has(nodeId)) continue;
    const parent = snapshot.nodes.find(
      (node) => node.id === nodeId,
    )?.parentNodeId;
    if (parent && reports.has(parent)) continue;
    for (const test of tests.values()) {
      if (test.expectedFailure === true) {
        addExpectedFailure(nodeId, test.title);
        continue;
      }
      if (test.status !== 'failed') continue;
      failureCount++;
      if (failures.length >= MAX_FAILURES) {
        truncated = true;
        continue;
      }
      failures.push({
        ...test,
        nodeId,
        journeyIds: (plans.get(nodeId)?.journeys ?? [])
          .filter((journey) =>
            journey.tests.some((selected) => selected.file === test.file),
          )
          .map((journey) => journey.id),
        artifacts: [],
      });
    }
  }
  const page = params.pageEvents.slice(0, FEEDBACK_PAGE_SIZE);
  const changes = page.map((event) => {
    const payload = record(event.payload);
    const progress =
      event.type === 'test_progress'
        ? readTestProgress(payload.progress)
        : null;
    return {
      sequence: event.id.toString(),
      type: event.type,
      nodeId: identifier(event.nodeId),
      ...(progress ? { progress } : {}),
      ...(event.type === 'test_result' && safeTestResult(payload.test)
        ? { test: safeTestResult(payload.test) }
        : {}),
      ...(event.type === 'node_state' &&
      [
        'idle',
        'pending',
        'running',
        'success',
        'error',
        'warning',
        'cancelled',
        'skipped',
      ].includes(payload.state)
        ? { state: payload.state }
        : {}),
    };
  });
  const result = {
    executionId: execution.id,
    workflowId: execution.workflowId,
    status: snapshot.status,
    startedAt: execution.startedAt.toISOString(),
    completedAt: execution.completedAt?.toISOString() ?? null,
    lastActivityAt: snapshot.lastActivityAt,
    activityStale: snapshot.activityStale,
    progress,
    nodes,
    failures,
    failureCount,
    expectedFailureCount,
    issues: issues.slice(0, 20),
    artifacts: [...artifacts.values()].slice(0, 100),
    evidenceIncomplete,
    truncated:
      truncated ||
      issues.length > 20 ||
      artifacts.size > 100 ||
      [...plans.values()].some((plan) => plan.truncated) ||
      [...discoveries.values()].some((discovery) => discovery.truncated),
    changes,
    nextCursor: page.at(-1)?.id.toString() ?? params.after.toString(),
    hasMore: params.pageEvents.length > FEEDBACK_PAGE_SIZE,
    // A failing head run alone is not evidence that the baseline passed.
    regressionConclusion: 'not_evaluated',
  };
  const oversized = () =>
    Buffer.byteLength(JSON.stringify(result)) > 128 * 1024;
  // Output bounds are independent of input/event limits. Large mappings and
  // reports stay accessible through authenticated artifacts, not tool context.
  while (oversized() && result.nodes.length) {
    result.nodes.pop();
    result.truncated = true;
  }
  while (oversized() && result.artifacts.length) {
    result.artifacts.pop();
    result.truncated = true;
  }
  while (oversized() && result.failures.length) {
    result.failures.pop();
    result.truncated = true;
  }
  while (oversized() && result.changes.length > 1) {
    result.changes.pop();
    result.nextCursor = result.changes.at(-1)!.sequence;
    result.hasMore = true;
    result.truncated = true;
  }
  return result;
}
