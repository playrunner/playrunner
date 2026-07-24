export type RunnerBuildFingerprints = {
  orchestrator: {
    fingerprint: string;
  };
  playwright: Array<{
    fingerprint: string;
    publishAsLatest: boolean;
    runtime: 'python' | 'typescript';
    version: string;
  }>;
};

export function findPlayrunnerRepoRoot(
  startDirectory?: string,
): Promise<string | null>;

export function getOrchestratorBuildFingerprint(args: {
  basePath?: string;
  repoRoot: string;
}): Promise<string>;

export function getPlaywrightBuildFingerprint(args: {
  repoRoot: string;
  runtime: 'python' | 'typescript';
  version: string;
}): Promise<string>;

export function getRunnerBuildFingerprints(args: {
  basePath?: string;
  repoRoot: string;
}): Promise<RunnerBuildFingerprints>;
