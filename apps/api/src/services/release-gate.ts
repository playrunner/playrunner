import { createHash } from 'node:crypto';
import { buildWorkflowPlanReport } from './workflow-test-plan';
import {
  parseReleaseCandidate,
  parseReleaseRequest,
  sameReleaseCandidate,
  RELEASE_IDENTITY_CASE,
  type ReleaseRequest,
} from './release-contract';

type Execution = Parameters<typeof buildWorkflowPlanReport>[0];
const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

// Evaluate stored evidence only. A caller cannot attach identity or test results
// to a verdict request, and a lifecycle completion alone is never a release pass.
export function buildReleaseVerdict(
  execution: Execution,
  expected: ReleaseRequest,
  now = Date.now(),
) {
  const reasons: Array<{ code: string; message: string }> = [];
  const block = (code: string, message: string) =>
    reasons.push({ code, message });
  const definitions = execution.events.filter(
    (event) => event.type === 'execution_definition',
  );
  const definition = record(definitions[0]?.payload);
  let captured: ReleaseRequest | undefined;
  const metadata = record(definition.release);
  try {
    captured = parseReleaseRequest({
      candidate: metadata.candidate,
      policyVersion: metadata.policyVersion,
      maxAgeSeconds: metadata.maxAgeSeconds,
    });
  } catch {
    block(
      'MISSING_RELEASE_CONTEXT',
      'This execution was not started with a release candidate.',
    );
  }
  if (definitions.length !== 1)
    block(
      'INVALID_EXECUTION_SNAPSHOT',
      'Exactly one server-created execution snapshot is required.',
    );
  if (captured && !sameReleaseCandidate(captured.candidate, expected.candidate))
    block(
      'CANDIDATE_MISMATCH',
      'The execution belongs to a different release candidate.',
    );
  if (captured && captured.policyVersion !== expected.policyVersion)
    block('POLICY_MISMATCH', 'The execution used a different release policy.');

  let report: ReturnType<typeof buildWorkflowPlanReport> = null;
  try {
    report = buildWorkflowPlanReport(execution);
  } catch {
    block(
      'INVALID_TEST_EVIDENCE',
      'The execution test evidence could not be evaluated.',
    );
  }
  if (!report)
    block(
      'MISSING_TEST_PLAN',
      'The execution has no captured release requirements.',
    );
  if (report && report.version !== metadata.criteriaVersion)
    block(
      'CRITERIA_MISMATCH',
      'The captured criteria version does not match the execution evidence.',
    );
  if (report && report.status !== 'PASS')
    block(
      'REQUIREMENTS_NOT_PASSED',
      'Every required release check must have passing evidence.',
    );
  if (
    execution.status !== 'completed' ||
    report?.executionStatus !== 'completed'
  )
    block(
      'EXECUTION_NOT_COMPLETED',
      'The release verification execution has not completed successfully.',
    );

  const started = execution.startedAt.getTime();
  const completed = execution.completedAt?.getTime();
  // Age starts with the run, so a long-running workflow cannot refresh old checks
  // by finishing late. Neither a retry nor a caller can extend the original TTL.
  const expiry =
    started +
    Math.min(
      expected.maxAgeSeconds,
      captured?.maxAgeSeconds ?? expected.maxAgeSeconds,
    ) *
      1000;
  if (
    !Number.isFinite(started) ||
    started > now ||
    !completed ||
    !Number.isFinite(completed) ||
    completed < started ||
    completed > now
  )
    block(
      'INVALID_EVIDENCE_TIME',
      'A valid, completed execution timestamp is required.',
    );
  if (!Number.isFinite(expiry) || now >= expiry)
    block(
      'EVIDENCE_EXPIRED',
      'The release evidence has expired; verify the candidate again.',
    );

  const identity = report?.cases.find(
    (item) => item.id === RELEASE_IDENTITY_CASE,
  );
  const identityNode = metadata.identityNodeId;
  if (
    !identity ||
    identity.nodes?.length !== 1 ||
    identity.nodes[0] !== identityNode ||
    identity.tests.length ||
    identity.status !== 'PASS'
  )
    block(
      'IDENTITY_CHECK_NOT_PASSED',
      'The required release identity check has not passed.',
    );
  const observations = execution.events.filter(
    (event) =>
      event.type === 'node_output' &&
      event.nodeId === identityNode &&
      Object.hasOwn(record(record(event.payload).output), 'releaseCandidate'),
  );
  if (!observations.length)
    block(
      'MISSING_OBSERVED_IDENTITY',
      'The identity node must report the application build observed at the target.',
    );
  for (const observation of observations) {
    try {
      const observed = parseReleaseCandidate(
        record(record(observation.payload).output).releaseCandidate,
      );
      if (!sameReleaseCandidate(observed, expected.candidate)) {
        block(
          'OBSERVED_IDENTITY_MISMATCH',
          'The observed application build does not match the release candidate.',
        );
        break;
      }
    } catch {
      block(
        'INVALID_OBSERVED_IDENTITY',
        'The identity node returned invalid application build evidence.',
      );
      break;
    }
  }
  if (report && report.cases.length < 2)
    block(
      'MISSING_RELEASE_REQUIREMENTS',
      'Release checks beyond build identity are required.',
    );

  const status =
    reasons.length === 0
      ? 'PASS'
      : report?.status === 'FAIL' || execution.status === 'failed'
        ? 'FAIL'
        : 'BLOCKED';
  return {
    schemaVersion: 1,
    status,
    allowed: status === 'PASS',
    workflowId: execution.workflowId,
    executionId: execution.id,
    candidate: expected.candidate,
    policyVersion: expected.policyVersion,
    criteriaVersion: report?.version ?? null,
    completedAt:
      completed && Number.isFinite(completed)
        ? new Date(completed).toISOString()
        : null,
    expiresAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : null,
    evaluatedAt: new Date(now).toISOString(),
    reasons,
    requirements: (report?.cases ?? []).map((item) => ({
      id: item.id,
      status: item.status,
      reason: item.reason,
      evidence: item.evidence.map((evidence) => ({
        nodeId: evidence.nodeId ?? '',
        kind: evidence.kind ?? 'test',
        status: evidence.status,
        // Opaque reference: do not expose arbitrary strings from runner output.
        evidenceId: createHash('sha256')
          .update(
            JSON.stringify([
              execution.id,
              evidence.nodeId,
              evidence.kind,
              evidence.title,
              evidence.project,
              evidence.evidenceId,
            ]),
          )
          .digest('hex'),
      })),
    })),
  };
}
