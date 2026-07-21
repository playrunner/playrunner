import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface PlaywrightE2EData {
  runId: string;
}

export function createPlaywrightE2EData({
  runId,
}: PlayrunnerE2EDataContext): PlaywrightE2EData {
  return { runId };
}
