export interface HuggingFaceIntegrationData {
  provider: 'huggingface';
  config: Record<string, never>;
  secrets: { accessToken: string };
}

export function createHuggingFaceIntegrationData(
  accessToken: string,
): HuggingFaceIntegrationData {
  const normalizedToken = accessToken.trim();
  if (!normalizedToken) {
    throw new Error('Hugging Face access token is required.');
  }

  return {
    provider: 'huggingface',
    config: {},
    secrets: { accessToken: normalizedToken },
  };
}
