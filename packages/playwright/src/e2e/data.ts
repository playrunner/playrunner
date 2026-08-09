import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface PlaywrightE2EData {
  folder: string;
  runId: string;
  script: string;
  zipFileName: string;
}

export function createPlaywrightE2EData({
  runId,
}: PlayrunnerE2EDataContext): PlaywrightE2EData {
  const suffix = runId.replace(/[^a-zA-Z0-9-]/g, '-');
  return {
    folder: `/tests/${suffix}`,
    runId,
    script: `import { test } from '@playwright/test';\ntest('${suffix}', async () => {});`,
    zipFileName: `playwright-${suffix}.zip`,
  };
}
