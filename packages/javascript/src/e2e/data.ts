import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface JavascriptE2EData {
  code: string;
  runId: string;
}

export function createJavascriptE2EData({
  runId,
}: PlayrunnerE2EDataContext): JavascriptE2EData {
  return {
    code: `return { runId: '${runId.replace(/'/g, '')}', ok: true };`,
    runId,
  };
}
