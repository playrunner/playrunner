export type PlaywrightShardingMode = 'auto' | 'manual' | 'off';

export type PlaywrightShardDiscovery = {
  fileCount: number;
  fullyParallel: boolean;
  projectCount: number;
  shardableUnits: number;
  sourceRevision?: string;
  testCount: number;
};

export type PlaywrightShardCapacity = {
  maxConcurrentShards: number;
  maxShards: number;
  maxTotalCpu: number;
  maxTotalMemoryGb: number;
  maxTotalWorkers: number;
};

export type PlaywrightShardPlan = {
  aggregateCpu: number;
  aggregateMemoryGb: number;
  aggregateWorkers: number;
  count: number;
  discovery: PlaywrightShardDiscovery;
  limits: {
    capacity: number;
    configured: number;
    useful: number;
  };
  mode: Exclude<PlaywrightShardingMode, 'off'>;
  reason: string;
};

const DEFAULT_CAPACITY: PlaywrightShardCapacity = {
  maxConcurrentShards: 16,
  maxShards: 16,
  maxTotalCpu: 64,
  maxTotalMemoryGb: 256,
  maxTotalWorkers: 64,
};

const DEFAULT_LOCAL_MAX_CONCURRENT_SHARDS = 4;
const DEFAULT_AUTO_UNITS_PER_WORKER = 4;

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolvePlaywrightShardingMode(
  config: Record<string, unknown>,
): PlaywrightShardingMode {
  if (config.shardingMode === 'auto' || config.shardingMode === 'manual') {
    return config.shardingMode;
  }
  return 'off';
}

export function resolvePlaywrightShardCapacity(
  value?: Partial<PlaywrightShardCapacity>,
): PlaywrightShardCapacity {
  return {
    maxConcurrentShards: positiveInteger(
      value?.maxConcurrentShards,
      positiveInteger(
        process.env.PLAYRUNNER_MAX_CONCURRENT_SHARDS,
        DEFAULT_CAPACITY.maxConcurrentShards,
      ),
    ),
    maxShards: positiveInteger(
      value?.maxShards,
      positiveInteger(
        process.env.PLAYRUNNER_MAX_SHARDS,
        DEFAULT_CAPACITY.maxShards,
      ),
    ),
    maxTotalCpu: positiveNumber(
      value?.maxTotalCpu,
      positiveNumber(
        process.env.PLAYRUNNER_MAX_SHARD_CPU,
        DEFAULT_CAPACITY.maxTotalCpu,
      ),
    ),
    maxTotalMemoryGb: positiveNumber(
      value?.maxTotalMemoryGb,
      positiveNumber(
        process.env.PLAYRUNNER_MAX_SHARD_MEMORY_GB,
        DEFAULT_CAPACITY.maxTotalMemoryGb,
      ),
    ),
    maxTotalWorkers: positiveInteger(
      value?.maxTotalWorkers,
      positiveInteger(
        process.env.PLAYRUNNER_MAX_SHARD_WORKERS,
        DEFAULT_CAPACITY.maxTotalWorkers,
      ),
    ),
  };
}

export function resolveLocalPlaywrightShardCapacity(args?: {
  availableCpu?: number;
  totalMemoryGb?: number;
}): PlaywrightShardCapacity {
  const availableCpu = positiveInteger(
    args?.availableCpu,
    os.availableParallelism(),
  );
  const totalMemoryGb = positiveNumber(
    args?.totalMemoryGb,
    os.totalmem() / 1024 ** 3,
  );
  const maxConcurrentShards = positiveInteger(
    process.env.PLAYRUNNER_LOCAL_MAX_CONCURRENT_SHARDS,
    DEFAULT_LOCAL_MAX_CONCURRENT_SHARDS,
  );

  return resolvePlaywrightShardCapacity({
    maxConcurrentShards,
    maxShards: maxConcurrentShards,
    maxTotalCpu: availableCpu,
    maxTotalMemoryGb: totalMemoryGb,
    maxTotalWorkers: availableCpu,
  });
}

export function createPlaywrightRuntimeNodeId(
  logicalNodeId: string,
  kind: 'aggregate' | 'discovery' | 'shard',
  shardIndex?: number,
  shardTotal?: number,
): string {
  const base = logicalNodeId.replace(/[^a-zA-Z0-9_-]/g, '-');
  if (kind === 'shard') {
    return `${base}--shard-${positiveInteger(shardIndex, 1)}-of-${positiveInteger(shardTotal, 1)}`;
  }
  return `${base}--${kind}`;
}

export function planPlaywrightShards(args: {
  capacity?: Partial<PlaywrightShardCapacity>;
  config: Record<string, unknown>;
  discovery: PlaywrightShardDiscovery;
}): PlaywrightShardPlan {
  const mode = resolvePlaywrightShardingMode(args.config);
  if (mode === 'off') {
    throw new Error('Cannot create a shard plan when sharding is off.');
  }

  const cpu = positiveNumber(args.config.cpu, 2);
  const memory = positiveNumber(args.config.memory, 4);
  const workers = positiveInteger(args.config.workers, 1);
  const capacity = resolvePlaywrightShardCapacity(args.capacity);
  const configured = positiveInteger(
    mode === 'manual' ? args.config.shardCount : args.config.maxShards,
    mode === 'manual' ? 2 : 4,
  );
  const shardableUnits = Math.max(
    1,
    positiveInteger(args.discovery.shardableUnits, 1),
  );
  const autoUnitsPerWorker = positiveInteger(
    args.config.autoUnitsPerWorker,
    DEFAULT_AUTO_UNITS_PER_WORKER,
  );
  const useful =
    mode === 'auto'
      ? Math.max(1, Math.ceil(shardableUnits / (workers * autoUnitsPerWorker)))
      : shardableUnits;
  const capacityLimit = Math.max(
    1,
    Math.min(
      capacity.maxShards,
      capacity.maxConcurrentShards,
      Math.floor(capacity.maxTotalCpu / cpu),
      Math.floor(capacity.maxTotalMemoryGb / memory),
      Math.floor(capacity.maxTotalWorkers / workers),
    ),
  );

  if (mode === 'manual' && configured > capacityLimit) {
    throw new Error(
      `The requested ${configured} shards exceed the current capacity limit of ${capacityLimit}.`,
    );
  }

  const count = Math.max(1, Math.min(configured, useful, capacityLimit));
  const reason = [
    `${configured} configured`,
    `${useful} useful shard${useful === 1 ? '' : 's'} for ${shardableUnits} ${args.discovery.fullyParallel ? 'test' : 'file/project'} unit${shardableUnits === 1 ? '' : 's'} at ${workers} worker${workers === 1 ? '' : 's'} each${mode === 'auto' ? ` and ${autoUnitsPerWorker} units per worker` : ''}`,
    `${capacityLimit} allowed by capacity`,
  ].join(' · ');

  return {
    aggregateCpu: count * cpu,
    aggregateMemoryGb: count * memory,
    aggregateWorkers: count * workers,
    count,
    discovery: args.discovery,
    limits: { capacity: capacityLimit, configured, useful },
    mode,
    reason,
  };
}
import os from 'node:os';
