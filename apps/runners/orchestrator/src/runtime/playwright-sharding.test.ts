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

test('auto sharding jointly selects runner resources within aggregate capacity', () => {
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

  assert.equal(plan.count, 6);
  assert.equal(plan.aggregateCpu, 6);
  assert.equal(plan.aggregateMemoryGb, 24);
  assert.equal(plan.aggregateWorkers, 6);
  assert.equal(plan.cpuPerShard, 1);
  assert.equal(plan.memoryGbPerShard, 4);
});

test('auto sharding avoids runners with too little useful work', () => {
  const plan = planPlaywrightShards({
    config: { maxShards: 8, shardingMode: 'auto' },
    discovery: { ...discovery, shardableUnits: 2, testCount: 2 },
  });

  assert.equal(plan.count, 1);
});

test('auto sharding caps workers at the selected CPU shape', () => {
  const plan = planPlaywrightShards({
    config: { maxShards: 8, shardingMode: 'auto', workers: 4 },
    discovery: { ...discovery, shardableUnits: 8, testCount: 8 },
  });

  assert.equal(plan.count, 1);
  assert.equal(plan.aggregateWorkers, 2);
  assert.equal(plan.workersPerShard, 2);
});

test('auto sharding does not oversubscribe CPU or memory per shard', () => {
  const plan = planPlaywrightShards({
    capacity: {
      maxConcurrentShards: 4,
      maxShards: 16,
      maxTotalCpu: 10,
      maxTotalMemoryGb: 8,
      maxTotalWorkers: 10,
    },
    config: {
      cpu: 1,
      maxShards: 16,
      memory: 0.5,
      shardingMode: 'auto',
      workers: 10,
    },
    discovery: { ...discovery, shardableUnits: 128, testCount: 128 },
  });

  assert.equal(plan.count, 4);
  assert.equal(plan.cpuPerShard, 1);
  assert.equal(plan.memoryGbPerShard, 0.5);
  assert.equal(plan.workersPerShard, 1);
  assert.equal(plan.aggregateWorkers, 4);
  assert.equal(plan.limits.useful, 4);
  assert.match(plan.reason, /1 worker selected per shard/);
});

test('auto planning uses comparable history to select memory and meet a duration target', () => {
  const plan = planPlaywrightShards({
    capacity: {
      maxConcurrentShards: 4,
      maxShards: 4,
      maxTotalCpu: 8,
      maxTotalMemoryGb: 16,
      maxTotalWorkers: 8,
    },
    config: {
      cpu: 4,
      maxShards: 4,
      memory: 8,
      shardingMode: 'auto',
      targetDurationMinutes: 6,
      workers: 2,
    },
    discovery,
    history: [
      {
        blobReportsComplete: true,
        completed: true,
        cpuPerShard: 2,
        discovery,
        durationMs: 10 * 60_000,
        memoryGbPerShard: 2,
        shardCount: 2,
        workersPerShard: 2,
      },
    ],
  });

  assert.equal(plan.count, 4);
  assert.equal(plan.cpuPerShard, 2);
  assert.equal(plan.memoryGbPerShard, 2);
  assert.equal(plan.estimate.durationMs, 5 * 60_000);
  assert.equal(plan.estimate.historySamples, 1);
  assert.equal(plan.estimate.source, 'history');
});

test('auto planning explores an equivalent shape with more workers per shard', () => {
  const plan = planPlaywrightShards({
    capacity: {
      maxConcurrentShards: 4,
      maxShards: 16,
      maxTotalCpu: 8,
      maxTotalMemoryGb: 4,
      maxTotalWorkers: 8,
    },
    config: {
      cpu: 4,
      maxShards: 16,
      memory: 4,
      shardingMode: 'auto',
      workers: 10,
    },
    discovery: { ...discovery, shardableUnits: 128, testCount: 128 },
    history: [
      {
        blobReportsComplete: true,
        completed: true,
        cpuPerShard: 2,
        discovery: { ...discovery, shardableUnits: 128, testCount: 128 },
        durationMs: 42_000,
        memoryGbPerShard: 1,
        shardCount: 4,
        workersPerShard: 2,
      },
    ],
  });

  assert.equal(plan.count, 2);
  assert.equal(plan.cpuPerShard, 4);
  assert.equal(plan.memoryGbPerShard, 2);
  assert.equal(plan.workersPerShard, 4);
  assert.equal(plan.aggregateWorkers, 8);
  assert.equal(plan.estimate.durationMs, 42_000);
  assert.match(plan.reason, /feasible shapes/);
});

test('auto planning prefers the faster observed execution shape', () => {
  const commonHistory = {
    blobReportsComplete: true,
    completed: true,
    discovery: { ...discovery, shardableUnits: 128, testCount: 128 },
  };
  const plan = planPlaywrightShards({
    capacity: {
      maxConcurrentShards: 4,
      maxShards: 16,
      maxTotalCpu: 8,
      maxTotalMemoryGb: 4,
      maxTotalWorkers: 8,
    },
    config: {
      cpu: 4,
      maxShards: 16,
      memory: 4,
      shardingMode: 'auto',
      workers: 10,
    },
    discovery: commonHistory.discovery,
    history: [
      {
        ...commonHistory,
        cpuPerShard: 2,
        durationMs: 42_000,
        memoryGbPerShard: 1,
        shardCount: 4,
        workersPerShard: 2,
      },
      {
        ...commonHistory,
        cpuPerShard: 4,
        durationMs: 35_000,
        memoryGbPerShard: 2,
        shardCount: 2,
        workersPerShard: 4,
      },
    ],
  });

  assert.equal(plan.count, 2);
  assert.equal(plan.workersPerShard, 4);
  assert.equal(plan.estimate.durationMs, 35_000);

  const planWithSlowerHighWorkerShape = planPlaywrightShards({
    capacity: {
      maxConcurrentShards: 4,
      maxShards: 16,
      maxTotalCpu: 8,
      maxTotalMemoryGb: 4,
      maxTotalWorkers: 8,
    },
    config: {
      cpu: 4,
      maxShards: 16,
      memory: 4,
      shardingMode: 'auto',
      workers: 10,
    },
    discovery: commonHistory.discovery,
    history: [
      {
        ...commonHistory,
        cpuPerShard: 2,
        durationMs: 42_000,
        memoryGbPerShard: 1,
        shardCount: 4,
        workersPerShard: 2,
      },
      {
        ...commonHistory,
        cpuPerShard: 4,
        durationMs: 55_000,
        memoryGbPerShard: 2,
        shardCount: 2,
        workersPerShard: 4,
      },
    ],
  });

  assert.equal(planWithSlowerHighWorkerShape.count, 4);
  assert.equal(planWithSlowerHighWorkerShape.workersPerShard, 2);
  assert.equal(planWithSlowerHighWorkerShape.estimate.durationMs, 42_000);
});

test('auto planning ignores incomplete and dissimilar history', () => {
  const plan = planPlaywrightShards({
    config: {
      cpu: 2,
      maxShards: 4,
      memory: 4,
      shardingMode: 'auto',
      workers: 2,
    },
    discovery,
    history: [
      {
        blobReportsComplete: false,
        completed: false,
        cpuPerShard: 1,
        discovery,
        durationMs: 1_000,
        memoryGbPerShard: 0.5,
        shardCount: 4,
        workersPerShard: 2,
      },
      {
        blobReportsComplete: true,
        completed: true,
        cpuPerShard: 1,
        discovery: { ...discovery, shardableUnits: 1, testCount: 1 },
        durationMs: 1_000,
        memoryGbPerShard: 0.5,
        shardCount: 1,
        workersPerShard: 1,
      },
    ],
  });

  assert.equal(plan.estimate.durationMs, null);
  assert.equal(plan.estimate.historySamples, 0);
  assert.equal(plan.estimate.source, 'discovery');
  assert.equal(plan.memoryGbPerShard, 4);
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

test('manual sharding preserves the configured workers per shard', () => {
  const plan = planPlaywrightShards({
    capacity: { maxTotalWorkers: 12 },
    config: {
      cpu: 4,
      memory: 8,
      shardCount: 3,
      shardingMode: 'manual',
      workers: 4,
    },
    discovery,
  });

  assert.equal(plan.count, 3);
  assert.equal(plan.cpuPerShard, 4);
  assert.equal(plan.memoryGbPerShard, 8);
  assert.equal(plan.workersPerShard, 4);
  assert.equal(plan.aggregateWorkers, 12);
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
