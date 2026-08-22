import type { BotPrDeliveryResult } from './bot-pr';
import type { AgentStructuredMemory } from './payload';
import type { ChangedLineRange, PreparedRepository } from './repository';
import type { SupervisorResult } from './supervisor';

export type TerminalFailureKind = 'artifact' | 'delivery' | 'repository';

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maximumBytes) return value;
  let end = maximumBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

function lineRanges(lines: number[]): ChangedLineRange[] {
  const sorted = Array.from(
    new Set(lines.filter((line) => Number.isSafeInteger(line) && line > 0)),
  ).sort((left, right) => left - right);
  const ranges: ChangedLineRange[] = [];
  for (const line of sorted) {
    const previous = ranges.at(-1);
    if (previous && previous.end + 1 === line) previous.end = line;
    else ranges.push({ end: line, start: line });
  }
  return ranges;
}

function coverageGaps(
  prepared: PreparedRepository,
  supervisor: SupervisorResult,
): AgentStructuredMemory['coverageGaps'] {
  const validation = supervisor.validation;
  if (!prepared.changeManifest || !validation?.changedCoverage) return [];
  const gaps = new Map<string, AgentStructuredMemory['coverageGaps'][number]>();
  for (const uncovered of validation.changedCoverage.uncovered) {
    gaps.set(uncovered.file, {
      changedLines: lineRanges(uncovered.lines),
      path: uncovered.file,
      reason: `${uncovered.total} executable changed line${uncovered.total === 1 ? '' : 's'} remain uncovered.`,
    });
  }
  for (const missingPath of validation.changedCoverage.missingFiles) {
    const changedFile = prepared.changeManifest.files.find(
      (file) => file.path === missingPath,
    );
    gaps.set(missingPath, {
      changedLines: changedFile?.changedLines.slice(0, 500) || [],
      path: missingPath,
      reason: 'The detailed coverage report did not instrument this file.',
    });
  }
  return [...gaps.values()].slice(0, 100);
}

function failureSummary(kind: TerminalFailureKind): string {
  if (kind === 'artifact') {
    return 'Artifact publication failed after validation. Inspect the execution logs, fix artifact storage or callback configuration, and retry.';
  }
  if (kind === 'repository') {
    return 'Repository inspection failed after validation. Inspect the execution logs, ensure Git can read the workspace, and retry.';
  }
  return 'Bot PR delivery failed after validation. Inspect the execution logs and verify the source-repository GitHub App permissions, branch protection, and workflow safety configuration.';
}

export function createStructuredMemory(options: {
  delivery?: BotPrDeliveryResult;
  effectiveStatus: 'failed' | 'passed';
  prepared: PreparedRepository;
  repository?: string;
  supervisor: SupervisorResult;
  terminalFailureKind?: TerminalFailureKind;
}): AgentStructuredMemory | undefined {
  const { delivery, effectiveStatus, prepared, supervisor } = options;
  const context = prepared.changeContext;
  const summary = options.terminalFailureKind
    ? failureSummary(options.terminalFailureKind)
    : supervisor.validation?.feedback.summary ||
      (effectiveStatus === 'failed'
        ? 'Validation failed. Inspect the execution logs and validator feedback before retrying.'
        : 'Validation passed.');
  const memory: AgentStructuredMemory = {
    ...(delivery && delivery.status !== 'no_changes'
      ? {
          botPullRequest: {
            headRef: delivery.pullRequest.headRef,
            headSha: delivery.commitSha,
            number: delivery.pullRequest.number,
            url: delivery.pullRequest.url,
          },
        }
      : {}),
    coverageGaps: coverageGaps(prepared, supervisor),
    generatedTestFiles: delivery?.generatedTestFiles || [],
    lastProcessedHeadSha: context?.headSha || prepared.headRevision,
    repository: context?.repository || String(options.repository || ''),
    schemaVersion: '1.0',
    validation: {
      status: effectiveStatus,
      summary: truncateUtf8(summary, 4_096),
    },
  };
  const maximumBytes = 60 * 1024;
  while (
    Buffer.byteLength(JSON.stringify(memory), 'utf8') > maximumBytes &&
    memory.coverageGaps.length
  ) {
    memory.coverageGaps.pop();
  }
  while (
    Buffer.byteLength(JSON.stringify(memory), 'utf8') > maximumBytes &&
    memory.generatedTestFiles.length
  ) {
    memory.generatedTestFiles.pop();
  }
  return memory;
}
