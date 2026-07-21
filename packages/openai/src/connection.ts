export interface OpenAIIntegrationData {
  apiKey: string;
  updatedAt: string;
}

export function createOpenAIIntegrationData(
  apiKey: string,
  updatedAt = new Date().toISOString(),
): OpenAIIntegrationData {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) {
    throw new Error('OpenAI API key is required.');
  }

  return { apiKey: normalizedKey, updatedAt };
}
