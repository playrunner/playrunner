export interface OpenAIIntegrationData {
  provider: 'openai';
  config: Record<string, never>;
  secrets: { apiKey: string };
}

export function createOpenAIIntegrationData(
  apiKey: string,
): OpenAIIntegrationData {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) {
    throw new Error('OpenAI API key is required.');
  }

  return {
    provider: 'openai',
    config: {},
    secrets: { apiKey: normalizedKey },
  };
}
