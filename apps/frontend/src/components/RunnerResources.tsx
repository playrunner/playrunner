import React from 'react';
import { Cpu, MemoryStick, Server, Info, AlertCircle } from 'lucide-react';
import type {
  RunnerResource,
  RunnerResourceSnapshot,
} from '../../../runners/shared/runner-resources';

const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
const cores = (value: number) => value.toFixed(1);
export function HostLoad({
  snapshot,
  live,
  now,
}: {
  snapshot: RunnerResourceSnapshot | null;
  live: boolean;
  now: number;
}): React.ReactNode {
  const host = snapshot?.host;
  const fresh =
    live && snapshot && now - Date.parse(snapshot.sampledAt) < 15000;
  if (!host || !fresh)
    return (
      <p className="flex items-start gap-2 text-sm text-muted">
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        Server host load unavailable. Runner usage does not measure overall host
        load.
      </p>
    );
  const elevated = host.loadAverage[0] > host.cpus;
  return (
    <section
      aria-label="Server host health"
      className="rounded-xl border border-subtle bg-surface p-4 space-y-2"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        {elevated ? (
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Server className="h-4 w-4" aria-hidden="true" />
        )}
        {elevated ? 'Elevated server host load' : 'Server host load'}
      </p>
      <p className="text-sm tabular-nums">
        {host.loadAverage.map((value) => value.toFixed(2)).join(' / ')} load ·{' '}
        {host.cpus} logical CPUs
      </p>
      <p className="text-xs text-muted">
        API server host, averages over 1 / 5 / 15 minutes. Includes other
        services on that host; Docker may run on a different host.
      </p>
      {elevated && (
        <p role="status" className="text-sm text-muted">
          Work is queuing or waiting on the host and may slow runs. This sample
          does not identify the responsible process or establish an external
          service failure.
        </p>
      )}
    </section>
  );
}
function totals(runners: RunnerResource[]) {
  return {
    cpu: runners.reduce((sum, runner) => sum + runner.cpuPercent / 100, 0),
    cpuLimit: runners.every((runner) => runner.cpuLimit !== null)
      ? runners.reduce((sum, runner) => sum + runner.cpuLimit!, 0)
      : null,
    memory: runners.reduce((sum, runner) => sum + runner.memoryBytes, 0),
    memoryLimit: runners.reduce(
      (sum, runner) => sum + runner.memoryLimitBytes,
      0,
    ),
  };
}
function Meter({
  value,
  limit,
  label,
}: {
  value: number;
  limit: number;
  label: string;
}) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(value, limit)}
      className="h-1.5 rounded-full bg-surface-hover overflow-hidden"
    >
      <div
        className="h-full rounded-full bg-[var(--accent)] transition-all"
        style={{ width: `${Math.min(100, (value / limit) * 100)}%` }}
      />
    </div>
  );
}
export function NodeResources({ runners }: { runners: RunnerResource[] }) {
  if (!runners.length) return null;
  const usage = totals(runners);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tabular-nums">
      <span className="inline-flex items-center gap-1">
        <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
        {cores(usage.cpu)}
        {usage.cpuLimit === null ? '' : ` / ${cores(usage.cpuLimit)}`} CPU
      </span>
      <span className="inline-flex items-center gap-1">
        <MemoryStick className="h-3.5 w-3.5" aria-hidden="true" />
        {gib(usage.memory)} / {gib(usage.memoryLimit)}
      </span>
      <span>
        {runners.length} {runners.length === 1 ? 'runner' : 'runners'}
      </span>
    </span>
  );
}
export function RunnerResources({
  snapshot,
  live,
  now,
}: {
  snapshot: RunnerResourceSnapshot | null;
  live: boolean;
  now: number;
}) {
  const fresh =
    live && snapshot?.available && now - Date.parse(snapshot.sampledAt) < 15000;
  if (!fresh)
    return (
      <p role="status" className="flex items-start gap-2 text-sm text-muted">
        <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
        {!snapshot
          ? 'Waiting for runner telemetry…'
          : 'Runner telemetry unavailable. Usage is unknown until a fresh sample arrives.'}
      </p>
    );
  const usage = totals(snapshot.runners);
  const cards = [
    {
      title: 'Local runners',
      Icon: Server,
      value: String(snapshot.runners.length),
      detail: 'Running containers for your executions',
      used: 0,
      limit: 0,
    },
    {
      title: 'Runner CPU',
      Icon: Cpu,
      value: `${cores(usage.cpu)} cores`,
      detail:
        usage.cpuLimit === null
          ? 'No CPU limit configured'
          : `${cores(usage.cpuLimit)} cores allocated`,
      used: usage.cpu,
      limit: usage.cpuLimit || 0,
    },
    {
      title: 'Runner memory',
      Icon: MemoryStick,
      value: gib(usage.memory),
      detail: `${gib(usage.memoryLimit)} allocated`,
      used: usage.memory,
      limit: usage.memoryLimit,
    },
  ];
  return (
    <section aria-label="Runner resources" className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map(({ title, Icon, value, detail, used, limit }) => (
          <div
            key={title}
            className="rounded-xl border border-subtle bg-surface p-4 shadow-sm space-y-3"
          >
            <div className="flex items-center gap-2 text-sm text-muted">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {title}
            </div>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted">{detail}</p>
            {limit > 0 && (
              <Meter value={used} limit={limit} label={`${title} usage`} />
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        {snapshot.capacity &&
          `Docker capacity: ${snapshot.capacity.cpus} CPU · ${gib(snapshot.capacity.memoryBytes)} memory. `}
        Updates every 5 seconds. Cloud runner usage is not included.
      </p>
    </section>
  );
}
