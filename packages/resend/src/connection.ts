export interface ResendIntegrationData {
  provider: 'resend';
  config: {
    authMode: 'apiKey';
    receivingAddress?: string;
  };
  secrets: { apiKey: string };
}

export function createResendApiKeyIntegrationData(
  apiKey: string,
  receivingAddress?: string,
): ResendIntegrationData {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) throw new Error('Resend API key is required.');

  const address = receivingAddress?.trim();
  return {
    provider: 'resend',
    config: {
      authMode: 'apiKey',
      ...(address ? { receivingAddress: address } : {}),
    },
    secrets: { apiKey: normalizedKey },
  };
}
