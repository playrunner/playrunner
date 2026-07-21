import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface OpenAIE2EData {
  apiKey: string;
}

export function createOpenAIE2EData({
  runId,
}: PlayrunnerE2EDataContext): OpenAIE2EData {
  const normalizedRunId = runId.replace(/[^a-zA-Z0-9-]/g, '-');

  return {
    apiKey: `sk-e2e-${normalizedRunId}`,
  };
}
