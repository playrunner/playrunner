import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RunnerResourceSnapshot } from '../../../runners/shared/runner-resources';

const execFileAsync = promisify(execFile);
type DockerCommand = (args: string[]) => Promise<string>;
const docker: DockerCommand = async (args) => {
  const result = await execFileAsync('docker', args, {
    timeout: 8000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return result.stdout;
};

export function parseDockerBytes(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|[KMGT]i?B)$/i);
  if (!match) throw new Error('Invalid Docker memory sample');
  const unit = match[2].toUpperCase();
  const power = unit === 'B' ? 0 : 'KMGT'.indexOf(unit[0]) + 1;
  return Number(match[1]) * (unit.includes('I') ? 1024 : 1000) ** power;
}

function number(value: unknown): number {
  const result = Number(value);
  if (value === '' || value == null || !Number.isFinite(result) || result < 0)
    throw new Error('Invalid Docker resource sample');
  return result;
}

export async function sampleRunnerResources(
  command: DockerCommand = docker,
): Promise<RunnerResourceSnapshot> {
  try {
    const [inventory, rawCapacity] = await Promise.all([
      command([
        'ps',
        '--filter',
        'label=playrunner.execution-id',
        '--format',
        '{{.ID}}\t{{.Label "playrunner.execution-id"}}\t{{.Label "playrunner.node-id"}}',
      ]),
      command(['info', '--format', '{{json .NCPU}}\t{{json .MemTotal}}']),
    ]);
    const [cpus, memory] = rawCapacity.trim().split('\t');
    const capacity = { cpus: number(cpus), memoryBytes: number(memory) };
    const containers = inventory
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, executionId, nodeId] = line.split('\t');
        if (!/^[a-f0-9]{12,64}$/.test(id) || !executionId || !nodeId)
          throw new Error('Invalid runner inventory');
        return { id, executionId, nodeId };
      });
    if (!containers.length)
      return {
        source: 'local-docker',
        available: true,
        sampledAt: new Date().toISOString(),
        capacity,
        runners: [],
      };
    const ids = containers.map((container) => container.id);
    const [rawStats, rawLimits] = await Promise.all([
      command(['stats', '--no-stream', '--format', '{{json .}}', ...ids]),
      command([
        'inspect',
        '--format',
        '{{.Id}}\t{{.HostConfig.NanoCpus}}',
        ...ids,
      ]),
    ]);
    const limits = rawLimits
      .trim()
      .split('\n')
      .map((line) => line.split('\t'));
    const stats = rawStats
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const runners = containers.map((container) => {
      const stat = stats.find((item) =>
        String(item.ID).startsWith(container.id),
      );
      const limit = limits.find(([id]) => id.startsWith(container.id));
      if (!stat || !limit) throw new Error('Runner stopped while sampling');
      const [used, total] = String(stat.MemUsage).split('/');
      const cpuLimit = number(limit[1]) / 1e9;
      return {
        executionId: container.executionId,
        nodeId: container.nodeId,
        cpuPercent: number(String(stat.CPUPerc).replace(/%$/, '')),
        cpuLimit: cpuLimit || null,
        memoryBytes: parseDockerBytes(used),
        memoryLimitBytes: parseDockerBytes(total),
      };
    });
    return {
      source: 'local-docker',
      available: true,
      sampledAt: new Date().toISOString(),
      capacity,
      runners,
    };
  } catch {
    return {
      source: 'local-docker',
      available: false,
      sampledAt: new Date().toISOString(),
      capacity: null,
      runners: [],
    };
  }
}

// One bounded sample is shared across SSE subscribers; filter authorization
// afresh on every response, including after team access is revoked.
let pending: Promise<RunnerResourceSnapshot> | undefined;
let last: RunnerResourceSnapshot | undefined;
export async function getRunnerResources(executionIds: Set<string>) {
  if (!last || Date.now() - Date.parse(last.sampledAt) >= 5000) {
    pending ??= sampleRunnerResources()
      .then((sample) => {
        last = sample;
        return sample;
      })
      .finally(() => {
        pending = undefined;
      });
    await pending;
  }
  return filterRunnerResources(last!, executionIds);
}

export function filterRunnerResources(
  snapshot: RunnerResourceSnapshot,
  executionIds: Set<string>,
) {
  return {
    ...snapshot,
    runners: snapshot.runners.filter((runner) =>
      executionIds.has(runner.executionId),
    ),
  };
}
