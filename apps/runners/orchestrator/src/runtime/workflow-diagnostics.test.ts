import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendWorkflowDiagnosticLog,
  createWorkflowDiagnosticLogs,
} from './workflow-diagnostics';

test('groups workflow diagnostics by level while preserving the full stream', () => {
  const logs = createWorkflowDiagnosticLogs();
  const entry = {
    level: 'error' as const,
    message: 'Shard crashed.',
    nodeId: 'playwright-1',
    timestamp: '2026-08-14T00:00:00.000Z',
  };

  appendWorkflowDiagnosticLog(logs, entry);

  assert.deepEqual(logs.all, [entry]);
  assert.deepEqual(logs.error, [entry]);
  assert.deepEqual(logs.info, []);
});

test('redacts credentials before diagnostics are passed to another node', () => {
  const logs = createWorkflowDiagnosticLogs();

  appendWorkflowDiagnosticLog(logs, {
    level: 'info',
    message: 'Authorization: Bearer secret-token-value',
    timestamp: '2026-08-14T00:00:00.000Z',
  });

  assert.equal(logs.all[0]?.message, 'Authorization: Bearer [redacted]');
});

test('merges delayed child diagnostics into timestamp order', () => {
  const logs = createWorkflowDiagnosticLogs();

  appendWorkflowDiagnosticLog(logs, {
    level: 'info',
    message: 'Orchestrator completion',
    timestamp: '2026-08-14T00:00:02.000Z',
  });
  appendWorkflowDiagnosticLog(logs, {
    level: 'info',
    message: 'Earlier child log',
    timestamp: '2026-08-14T00:00:01.000Z',
  });

  assert.deepEqual(
    logs.all.map((entry) => entry.message),
    ['Earlier child log', 'Orchestrator completion'],
  );
});

test('drops oldest entries when a diagnostic log reaches its byte limit', () => {
  const logs = createWorkflowDiagnosticLogs({
    maxBytes: 220,
    maxEntries: 10,
  });

  for (let index = 0; index < 5; index += 1) {
    appendWorkflowDiagnosticLog(logs, {
      level: index === 0 ? 'error' : 'info',
      message: `entry-${index}-${'x'.repeat(80)}`,
      timestamp: `2026-08-14T00:00:0${index}.000Z`,
    });
  }

  assert.ok(Buffer.byteLength(JSON.stringify(logs.all), 'utf8') <= 220);
  assert.doesNotMatch(JSON.stringify(logs), /entry-0/);
  assert.match(JSON.stringify(logs), /entry-4/);
});
