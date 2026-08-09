import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface OpenAIE2EData {
  apiKey: string;
  jsonSchema: string;
  maxOutputTokens: string;
  model: string;
  prompt: string;
}

export function createOpenAIE2EData({
  runId,
}: PlayrunnerE2EDataContext): OpenAIE2EData {
  const normalizedRunId = runId.replace(/[^a-zA-Z0-9-]/g, '-');

  return {
    apiKey: `sk-e2e-${normalizedRunId}`,
    jsonSchema:
      '{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}',
    maxOutputTokens: '2048',
    model: 'gpt-5.6-terra',
    prompt: `Return structured output for ${normalizedRunId}`,
  };
}
