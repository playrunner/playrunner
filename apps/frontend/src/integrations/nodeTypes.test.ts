import assert from 'node:assert/strict';
import test from 'node:test';
import { createNodeTypeCatalog } from './nodeTypes';
import type { Integration } from './types';

function integration(
  id: string,
  metadata: Partial<Integration> = {},
): Integration {
  return {
    id,
    name: id,
    category: 'Test',
    description: id,
    icon: id,
    ...metadata,
  };
}

test('hides new-node discovery without removing metadata needed by existing nodes', () => {
  const catalog = createNodeTypeCatalog([
    integration('hidden-parent', {
      showInNodeSelector: false,
      acceptsAttachments: ['agent', 'memory', 'tool'],
    }),
    integration('hidden-agent', {
      showInNodeSelector: false,
      executionRole: 'attachment',
      attachmentKind: 'agent',
      showInputPanel: false,
    }),
    integration('orphan-memory', {
      executionRole: 'attachment',
      attachmentKind: 'memory',
    }),
    integration('standalone-tool', { attachmentKind: 'tool' }),
    integration('ordinary-workflow'),
  ]);

  assert.deepEqual(
    catalog.selectable.map((node) => node.id),
    ['standalone-tool', 'ordinary-workflow'],
  );
  assert.equal(catalog.all.length, 5);
  const agent = catalog.all.find((node) => node.id === 'hidden-agent');
  assert.equal(agent?.executionRole, 'attachment');
  assert.equal(agent?.attachmentKind, 'agent');
  assert.equal(agent?.acceptsInboundConnection, false);
  assert.equal(agent?.iconSrc, 'hidden-agent');
});

test('shows only attachments supported by a visible workflow parent', () => {
  const catalog = createNodeTypeCatalog([
    integration('parent', { acceptsAttachments: ['memory'] }),
    integration('memory', {
      executionRole: 'attachment',
      attachmentKind: 'memory',
    }),
    integration('unsupported-agent', {
      executionRole: 'attachment',
      attachmentKind: 'agent',
    }),
    integration('hidden-memory', {
      showInNodeSelector: false,
      executionRole: 'attachment',
      attachmentKind: 'memory',
    }),
  ]);

  assert.deepEqual(
    catalog.selectable.map((node) => node.id),
    ['parent', 'memory'],
  );
});
