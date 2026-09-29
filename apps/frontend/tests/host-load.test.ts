import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostLoad } from '../src/components/RunnerResources';
import type { RunnerResourceSnapshot } from '../../runners/shared/runner-resources';

test('high host load is visible even if Docker telemetry failed; stale samples are unknown', () => {
  const now = Date.now();
  const snapshot: RunnerResourceSnapshot = {
    source: 'local-docker',
    available: false,
    sampledAt: new Date(now).toISOString(),
    capacity: null,
    runners: [],
    host: { source: 'api-server', cpus: 8, loadAverage: [65, 32, 12] },
  };
  const render = (time: number, live = true) =>
    renderToStaticMarkup(
      createElement(HostLoad, { snapshot, now: time, live }),
    );
  assert.match(render(now), /Elevated server host load/);
  assert.match(render(now), /65.00 \/ 32.00 \/ 12.00/);
  assert.match(render(now), /does not identify the responsible process/);
  assert.match(render(now + 15001), /load unavailable/);
  assert.match(render(now, false), /load unavailable/);
});
