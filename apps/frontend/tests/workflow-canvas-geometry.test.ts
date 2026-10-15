import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAttachmentPortCoordinates,
  getPortCoordinates,
  renderCurve,
} from '../src/components/workflow/geometry';
import { getNodeDimensions } from '../../runners/shared/workflow-geometry';

test('connections meet the editor sockets for environment and agent nodes', () => {
  const environment = { nodeType: 'environment', x: -200, y: -100 };
  const width = getNodeDimensions(environment).width;
  assert.deepEqual(getPortCoordinates(environment, 'right'), {
    x: -200 + width,
    y: -36,
  });
  assert.deepEqual(getPortCoordinates(environment, 'top', 10), {
    x: -200 + width / 2,
    y: -110,
  });
  const agent = { nodeType: 'agent-container', x: 100, y: 200 };
  assert.deepEqual(getAttachmentPortCoordinates(agent, 'memory'), {
    x: 280,
    y: 328,
  });
  assert.deepEqual(getAttachmentPortCoordinates(agent, 'tool'), {
    x: 395.2,
    y: 328,
  });
});

test('routing preserves port direction and endpoints for stepped and curved edges', () => {
  for (const style of ['step', 'bezier'] as const) {
    for (const port of ['top', 'right', 'bottom', 'left'] as const) {
      const path = renderCurve(-100, -60, 280, 328, port, 'bottom', style);
      assert.ok(path.startsWith('M -100 -60'));
      assert.ok(path.endsWith('280 328'));
      assert.doesNotMatch(path, /NaN|Infinity/);
    }
  }
});
