export type RunnerResource = {
  executionId: string;
  nodeId: string;
  cpuPercent: number;
  cpuLimit: number | null;
  memoryBytes: number;
  memoryLimitBytes: number;
};

export type RunnerResourceSnapshot = {
  source: 'local-docker';
  available: boolean;
  sampledAt: string;
  capacity: { cpus: number; memoryBytes: number } | null;
  runners: RunnerResource[];
};
