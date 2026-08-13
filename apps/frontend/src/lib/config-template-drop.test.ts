import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  insertDroppedText,
  normalizeConfigDropText,
} from './config-template-drop';

test('normalizes JavaScript environment access for configuration fields', () => {
  assert.equal(
    normalizeConfigDropText('process.env.RECIPIENT_EMAIL'),
    '{{env.RECIPIENT_EMAIL}}',
  );
});

test('preserves workflow templates and ordinary dropped text', () => {
  assert.equal(
    normalizeConfigDropText('{{workflow.definition.name}}'),
    '{{workflow.definition.name}}',
  );
  assert.equal(
    normalizeConfigDropText('person@example.com'),
    'person@example.com',
  );
});

test('inserts dropped text at the current field selection', () => {
  assert.deepEqual(insertDroppedText('Hello NAME!', '{{env.NAME}}', 6, 10), {
    caret: 18,
    value: 'Hello {{env.NAME}}!',
  });
});
