import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface JavascriptE2EData {
  runId: string;
}

export function createJavascriptE2EData({
  runId,
}: PlayrunnerE2EDataContext): JavascriptE2EData {
  return { runId };
}
