import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlaywrightRuntimeNodeId,
  planPlaywrightShards,
  resolveLocalPlaywrightShardCapacity,
} from './playwright-sharding';

const discovery = {
  fileCount: 20,
  fullyParallel: true,
  projectCount: 1,
  shardableUnits: 100,
  sourceRevision: 'abc123',
  testCount: 100,
};

test('auto sharding is bounded by useful work and aggregate capacity', () => {
  const plan = planPlaywrightShards({
    capacity: {
      maxConcurrentShards: 8,
      maxShards: 8,
      maxTotalCpu: 6,
      maxTotalMemoryGb: 24,
      maxTotalWorkers: 8,
    },
    config: {
      cpu: 2,
      maxShards: 6,
      memory: 4,
      shardingMode: 'auto',
      workers: 2,
    },
    discovery,
  });

  assert.equal(plan.count, 3);
  assert.equal(plan.aggregateCpu, 6);
  assert.equal(plan.aggregateMemoryGb, 12);
  assert.equal(plan.aggregateWorkers, 6);
});

test('auto sharding avoids runners with too little useful work', () => {
  const plan = planPlaywrightShards({
    config: { maxShards: 8, shardingMode: 'auto' },
    discovery: { ...discovery, shardableUnits: 2, testCount: 2 },
  });

  assert.equal(plan.count, 1);
});

test('auto sharding accounts for workers inside each shard', () => {
  const plan = planPlaywrightShards({
    config: { maxShards: 8, shardingMode: 'auto', workers: 4 },
    discovery: { ...discovery, shardableUnits: 8, testCount: 8 },
  });

  assert.equal(plan.count, 1);
  assert.equal(plan.aggregateWorkers, 4);
});

test('local capacity is bounded by host resources and a safe concurrency cap', () => {
  assert.deepEqual(
    resolveLocalPlaywrightShardCapacity({
      availableCpu: 10,
      totalMemoryGb: 24,
    }),
    {
      maxConcurrentShards: 4,
      maxShards: 4,
      maxTotalCpu: 10,
      maxTotalMemoryGb: 24,
      maxTotalWorkers: 10,
    },
  );
});

test('manual sharding rejects a request above capacity', () => {
  assert.throws(
    () =>
      planPlaywrightShards({
        capacity: { maxConcurrentShards: 2 },
        config: { shardCount: 4, shardingMode: 'manual' },
        discovery,
      }),
    /exceed the current capacity limit of 2/,
  );
});

test('runtime child ids are stable and collision-free', () => {
  assert.equal(
    createPlaywrightRuntimeNodeId('node 1', 'shard', 2, 4),
    'node-1--shard-2-of-4',
  );
  assert.equal(
    createPlaywrightRuntimeNodeId('node 1', 'discovery'),
    'node-1--discovery',
  );
  assert.equal(
    createPlaywrightRuntimeNodeId('node 1', 'aggregate'),
    'node-1--aggregate',
  );
});
