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

export type PlaywrightExecutionObservation = {
  blobReportsComplete: boolean;
  completed: boolean;
  cpuPerShard: number;
  discovery: PlaywrightShardDiscovery;
  durationMs: number;
  memoryGbPerShard: number;
  shardCount: number;
  shardDurationsMs?: number[];
  workersPerShard: number;
};

export type PlaywrightShardPlan = {
  aggregateCpu: number;
  aggregateMemoryGb: number;
  aggregateWorkers: number;
  count: number;
  cpuPerShard: number;
  discovery: PlaywrightShardDiscovery;
  estimate: {
    durationMs: number | null;
    historySamples: number;
    source: 'discovery' | 'history';
  };
  limits: {
    capacity: number;
    configured: number;
    useful: number;
  };
  mode: Exclude<PlaywrightShardingMode, 'off'>;
  memoryGbPerShard: number;
  reason: string;
  workersPerShard: number;
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
const MIN_MEMORY_GB_PER_WORKER = 0.5;
const CPU_SIZES = [1, 2, 4, 8];
const MEMORY_SIZES_GB = [0.5, 1, 2, 4, 8, 16, 32];

type AutoShardShape = {
  count: number;
  cpuPerShard: number;
  durationMs: number;
  memoryGbPerShard: number;
  workersPerShard: number;
};

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function availableSizes(
  sizes: number[],
  configuredMaximum: number,
  aggregateMaximum: number,
  shardCount: number,
) {
  const feasibleMaximum = Math.min(
    configuredMaximum,
    aggregateMaximum / shardCount,
  );
  const available = sizes.filter((size) => size <= feasibleMaximum);
  if (available.length > 0) return available;
  return [feasibleMaximum];
}

function smallestSizeAtLeast(sizes: number[], requested: number) {
  return sizes.find((size) => size >= requested) ?? sizes[sizes.length - 1];
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function relevantHistory(
  discovery: PlaywrightShardDiscovery,
  history: PlaywrightExecutionObservation[],
) {
  return history.filter((observation) => {
    if (
      !observation ||
      !observation.blobReportsComplete ||
      !observation.completed ||
      !observation.discovery ||
      !Number.isFinite(observation.durationMs) ||
      observation.durationMs <= 0 ||
      !Number.isFinite(observation.cpuPerShard) ||
      !Number.isFinite(observation.memoryGbPerShard) ||
      !Number.isFinite(observation.shardCount) ||
      !Number.isFinite(observation.workersPerShard) ||
      !Number.isFinite(observation.discovery.shardableUnits)
    ) {
      return false;
    }
    if (observation.discovery.fullyParallel !== discovery.fullyParallel) {
      return false;
    }
    if (observation.discovery.projectCount !== discovery.projectCount) {
      return false;
    }
    const observedUnits = Math.max(1, observation.discovery.shardableUnits);
    const ratio = discovery.shardableUnits / observedUnits;
    return ratio >= 0.5 && ratio <= 2;
  });
}

function estimateDurationMs(args: {
  cpuPerShard: number;
  discovery: PlaywrightShardDiscovery;
  history: PlaywrightExecutionObservation[];
  shardCount: number;
  workersPerShard: number;
}) {
  if (args.history.length === 0) return null;
  const candidateParallelism =
    args.shardCount * Math.min(args.workersPerShard, args.cpuPerShard);
  const exactShapeHistory = args.history.filter(
    (observation) =>
      observation.shardCount === args.shardCount &&
      observation.workersPerShard === args.workersPerShard &&
      observation.cpuPerShard === args.cpuPerShard,
  );
  const samples =
    exactShapeHistory.length > 0 ? exactShapeHistory : args.history;
  return Math.round(
    median(
      samples.map((observation) => {
        const observedParallelism =
          observation.shardCount *
          Math.min(observation.workersPerShard, observation.cpuPerShard);
        const workloadRatio =
          args.discovery.shardableUnits /
          Math.max(1, observation.discovery.shardableUnits);
        return (
          observation.durationMs *
          workloadRatio *
          (observedParallelism / candidateParallelism)
        );
      }),
    ),
  );
}

function feasibleAutoShapes(args: {
  capacity: PlaywrightShardCapacity;
  configuredCpu: number;
  configuredMemory: number;
  configuredWorkers: number;
  discovery: PlaywrightShardDiscovery;
  history: PlaywrightExecutionObservation[];
  maximumShardCount: number;
}): AutoShardShape[] {
  const historicalMemoryPerWorker = Math.max(
    MIN_MEMORY_GB_PER_WORKER,
    Math.min(
      ...args.history.map(
        (observation) =>
          observation.memoryGbPerShard / observation.workersPerShard,
      ),
    ),
  );
  const candidates: AutoShardShape[] = [];

  for (let count = 1; count <= args.maximumShardCount; count += 1) {
    const cpuSizes = availableSizes(
      CPU_SIZES,
      args.configuredCpu,
      args.capacity.maxTotalCpu,
      count,
    );
    const memorySizes = availableSizes(
      MEMORY_SIZES_GB,
      args.configuredMemory,
      args.capacity.maxTotalMemoryGb,
      count,
    );
    const maximumWorkers = Math.max(
      1,
      Math.min(
        args.configuredWorkers,
        Math.floor(args.capacity.maxTotalWorkers / count),
        Math.floor(cpuSizes[cpuSizes.length - 1]),
        Math.floor(
          memorySizes[memorySizes.length - 1] / historicalMemoryPerWorker,
        ),
      ),
    );

    for (
      let workersPerShard = 1;
      workersPerShard <= maximumWorkers;
      workersPerShard += 1
    ) {
      const cpuPerShard = smallestSizeAtLeast(cpuSizes, workersPerShard);
      const requestedMemory = workersPerShard * historicalMemoryPerWorker;
      if (requestedMemory > memorySizes[memorySizes.length - 1]) continue;
      const memoryGbPerShard = smallestSizeAtLeast(
        memorySizes,
        requestedMemory,
      );
      const durationMs = estimateDurationMs({
        cpuPerShard,
        discovery: args.discovery,
        history: args.history,
        shardCount: count,
        workersPerShard,
      });
      if (durationMs === null) continue;
      candidates.push({
        count,
        cpuPerShard,
        durationMs,
        memoryGbPerShard,
        workersPerShard,
      });
    }
  }

  return candidates;
}

function selectAutoShape(
  candidates: AutoShardShape[],
  targetDurationMs: number,
): AutoShardShape | null {
  const withinTarget =
    targetDurationMs > 0
      ? candidates.filter(
          (candidate) => candidate.durationMs <= targetDurationMs,
        )
      : [];
  const ranked = [...(withinTarget.length > 0 ? withinTarget : candidates)];

  ranked.sort((left, right) => {
    if (withinTarget.length > 0) {
      const cpuDifference =
        left.count * left.cpuPerShard - right.count * right.cpuPerShard;
      if (cpuDifference !== 0) return cpuDifference;
      const memoryDifference =
        left.count * left.memoryGbPerShard -
        right.count * right.memoryGbPerShard;
      if (memoryDifference !== 0) return memoryDifference;
    }
    const durationDifference = left.durationMs - right.durationMs;
    if (durationDifference !== 0) return durationDifference;
    const workerDifference =
      right.count * right.workersPerShard - left.count * left.workersPerShard;
    if (workerDifference !== 0) return workerDifference;
    return left.count - right.count;
  });

  return ranked[0] || null;
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
  history?: PlaywrightExecutionObservation[];
}): PlaywrightShardPlan {
  const mode = resolvePlaywrightShardingMode(args.config);
  if (mode === 'off') {
    throw new Error('Cannot create a shard plan when sharding is off.');
  }

  const configuredCpu = positiveNumber(args.config.cpu, 2);
  const configuredMemory = positiveNumber(args.config.memory, 4);
  const configuredWorkers = positiveInteger(args.config.workers, 1);
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
      ? Math.max(
          1,
          Math.ceil(shardableUnits / (configuredWorkers * autoUnitsPerWorker)),
        )
      : shardableUnits;
  const capacityLimit = Math.max(
    1,
    Math.min(
      capacity.maxShards,
      capacity.maxConcurrentShards,
      Math.floor(capacity.maxTotalCpu / (mode === 'auto' ? 1 : configuredCpu)),
      Math.floor(
        capacity.maxTotalMemoryGb / (mode === 'auto' ? 0.5 : configuredMemory),
      ),
      mode === 'auto'
        ? capacity.maxTotalWorkers
        : Math.floor(capacity.maxTotalWorkers / configuredWorkers),
    ),
  );

  if (mode === 'manual' && configured > capacityLimit) {
    throw new Error(
      `The requested ${configured} shards exceed the current capacity limit of ${capacityLimit}.`,
    );
  }

  let count = Math.max(1, Math.min(configured, useful, capacityLimit));
  const cpuSizes = availableSizes(
    CPU_SIZES,
    configuredCpu,
    capacity.maxTotalCpu,
    count,
  );
  const memorySizes = availableSizes(
    MEMORY_SIZES_GB,
    configuredMemory,
    capacity.maxTotalMemoryGb,
    count,
  );
  const history = relevantHistory(args.discovery, args.history ?? []);
  const historicalMemory =
    history.length > 0
      ? Math.min(...history.map((observation) => observation.memoryGbPerShard))
      : null;
  let memoryGbPerShard =
    mode === 'auto'
      ? smallestSizeAtLeast(
          memorySizes,
          historicalMemory ?? memorySizes[memorySizes.length - 1],
        )
      : configuredMemory;
  let workersPerShard =
    mode === 'auto'
      ? Math.max(
          1,
          Math.min(
            configuredWorkers,
            Math.floor(capacity.maxTotalWorkers / count),
            Math.floor(cpuSizes[cpuSizes.length - 1]),
            Math.floor(memoryGbPerShard / MIN_MEMORY_GB_PER_WORKER),
          ),
        )
      : configuredWorkers;
  const targetDurationMs =
    positiveNumber(args.config.targetDurationMinutes, 0) * 60_000;
  const cpuEstimates = cpuSizes
    .filter((cpuPerShard) => cpuPerShard >= workersPerShard)
    .map((cpuPerShard) => ({
      cpuPerShard,
      durationMs: estimateDurationMs({
        cpuPerShard,
        discovery: args.discovery,
        history,
        shardCount: count,
        workersPerShard,
      }),
    }));
  let cpuPerShard =
    mode === 'auto'
      ? ((targetDurationMs > 0
          ? cpuEstimates.find(
              (candidate) =>
                candidate.durationMs !== null &&
                candidate.durationMs <= targetDurationMs,
            )
          : undefined
        )?.cpuPerShard ?? smallestSizeAtLeast(cpuSizes, workersPerShard))
      : configuredCpu;
  let estimatedDurationMs = estimateDurationMs({
    cpuPerShard,
    discovery: args.discovery,
    history,
    shardCount: count,
    workersPerShard,
  });
  let evaluatedShapeCount = 0;
  if (mode === 'auto' && history.length > 0) {
    const candidates = feasibleAutoShapes({
      capacity,
      configuredCpu,
      configuredMemory,
      configuredWorkers,
      discovery: args.discovery,
      history,
      maximumShardCount: count,
    });
    const selectedShape = selectAutoShape(candidates, targetDurationMs);
    evaluatedShapeCount = candidates.length;
    if (selectedShape) {
      count = selectedShape.count;
      cpuPerShard = selectedShape.cpuPerShard;
      memoryGbPerShard = selectedShape.memoryGbPerShard;
      workersPerShard = selectedShape.workersPerShard;
      estimatedDurationMs = selectedShape.durationMs;
    }
  }
  const reason = [
    `${configured} configured`,
    `${useful} useful shard${useful === 1 ? '' : 's'} for ${shardableUnits} ${args.discovery.fullyParallel ? 'test' : 'file/project'} unit${shardableUnits === 1 ? '' : 's'} at up to ${configuredWorkers} worker${configuredWorkers === 1 ? '' : 's'} each${mode === 'auto' ? ` and ${autoUnitsPerWorker} units per worker` : ''}`,
    `${capacityLimit} allowed by capacity`,
    `${count}-shard shape selected`,
    `${workersPerShard} worker${workersPerShard === 1 ? '' : 's'} selected per shard`,
    `${cpuPerShard} CPU and ${memoryGbPerShard}GB memory selected per shard${history.length > 0 ? ` after evaluating ${evaluatedShapeCount} feasible shape${evaluatedShapeCount === 1 ? '' : 's'} from ${history.length} comparable run${history.length === 1 ? '' : 's'}` : ' using the first-run fallback'}`,
  ].join(' · ');

  return {
    aggregateCpu: count * cpuPerShard,
    aggregateMemoryGb: count * memoryGbPerShard,
    aggregateWorkers: count * workersPerShard,
    count,
    cpuPerShard,
    discovery: args.discovery,
    estimate: {
      durationMs: estimatedDurationMs,
      historySamples: history.length,
      source: history.length > 0 ? 'history' : 'discovery',
    },
    limits: { capacity: capacityLimit, configured, useful },
    mode,
    memoryGbPerShard,
    reason,
    workersPerShard,
  };
}
import os from 'node:os';
