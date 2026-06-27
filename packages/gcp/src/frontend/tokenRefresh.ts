export type GcpCloudCredentialRefreshContext = {
  credentialData: any;
  getApiHeaders: () => Promise<Record<string, string>>;
  saveCloudCredential: (data: any) => Promise<void>;
};

export async function refreshGcpCloudCredentialIfNeeded({
  credentialData,
  getApiHeaders,
  saveCloudCredential,
}: GcpCloudCredentialRefreshContext) {
  if (
    !credentialData ||
    !credentialData.accessToken ||
    !credentialData.refreshToken
  ) {
    return credentialData;
  }

  const isExpired =
    !credentialData.expiresAt ||
    Date.now() + 5 * 60 * 1000 > credentialData.expiresAt;
  if (!isExpired) {
    return credentialData;
  }

  try {
    console.log('GCP token is expired or expiring soon, refreshing...');
    const res = await fetch('/api/gcp/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getApiHeaders()),
      },
      body: JSON.stringify({
        refresh_token: credentialData.refreshToken,
        client_id: credentialData.clientId,
        client_secret: credentialData.clientSecret,
      }),
    });

    const tokenData = await res.json();

    if (tokenData.access_token) {
      credentialData.accessToken = tokenData.access_token;
      if (tokenData.expires_in) {
        credentialData.expiresAt = Date.now() + tokenData.expires_in * 1000;
      }
      credentialData.updatedAt = new Date().toISOString();

      await saveCloudCredential(credentialData);
      console.log('GCP token refreshed successfully.');
    } else {
      console.error(
        'Failed to refresh GCP token, no access_token returned:',
        tokenData,
      );
    }
  } catch (error) {
    console.error('Failed to refresh GCP token:', error);
  }

  return credentialData;
}
