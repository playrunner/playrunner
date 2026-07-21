export interface HuggingFaceIntegrationData {
  accessToken: string;
  updatedAt: string;
}

export function createHuggingFaceIntegrationData(
  accessToken: string,
  updatedAt = new Date().toISOString(),
): HuggingFaceIntegrationData {
  const normalizedToken = accessToken.trim();
  if (!normalizedToken) {
    throw new Error('Hugging Face access token is required.');
  }

  return { accessToken: normalizedToken, updatedAt };
}
