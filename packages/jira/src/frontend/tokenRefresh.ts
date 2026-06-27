import type { IntegrationRefreshContext } from '@playrunner/integration-sdk';

export async function refreshJiraTokenIfNeeded({
  integrationData,
  getApiHeaders,
  saveIntegration,
}: IntegrationRefreshContext) {
  if (
    !integrationData ||
    !integrationData.accessToken ||
    !integrationData.refreshToken ||
    !integrationData.expiresAt
  ) {
    return integrationData;
  }

  if (Date.now() + 5 * 60 * 1000 <= integrationData.expiresAt) {
    return integrationData;
  }

  try {
    console.log('Jira token is expired or expiring soon, refreshing...');
    const res = await fetch('/api/jira/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getApiHeaders()),
      },
      body: JSON.stringify({
        refresh_token: integrationData.refreshToken,
        client_id: integrationData.clientId,
        client_secret: integrationData.clientSecret,
      }),
    });

    const tokenData = await res.json();

    if (tokenData.access_token) {
      integrationData.accessToken = tokenData.access_token;
      if (tokenData.refresh_token) {
        integrationData.refreshToken = tokenData.refresh_token;
      }
      if (tokenData.expires_in) {
        integrationData.expiresAt = Date.now() + tokenData.expires_in * 1000;
      }
      integrationData.updatedAt = new Date().toISOString();

      await saveIntegration(integrationData);
      console.log('Jira token refreshed successfully.');
    } else {
      console.error(
        'Failed to refresh Jira token, no access_token returned:',
        tokenData,
      );
    }
  } catch (error) {
    console.error('Failed to refresh Jira token:', error);
  }

  return integrationData;
}
