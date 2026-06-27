import type { IntegrationRefreshContext } from '@playrunner/integration-sdk';

function isBadGithubRefreshTokenError(tokenData: any) {
  return tokenData?.error === 'bad_refresh_token';
}

export async function refreshGithubTokenIfNeeded({
  integrationData,
  getApiHeaders,
  saveIntegration,
  deleteIntegration,
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
    console.log('GitHub token is expired or expiring soon, refreshing...');
    const res = await fetch('/api/github/refresh', {
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
      if (tokenData.refresh_token_expires_in) {
        integrationData.refreshTokenExpiresAt =
          Date.now() + tokenData.refresh_token_expires_in * 1000;
      }
      integrationData.updatedAt = new Date().toISOString();

      await saveIntegration(integrationData);
      console.log('GitHub token refreshed successfully.');
      return integrationData;
    }

    if (isBadGithubRefreshTokenError(tokenData)) {
      console.warn(
        'GitHub refresh token is invalid or expired. Clearing the saved GitHub connection; reconnect GitHub to continue.',
      );
      await deleteIntegration();
      return null;
    }

    console.error(
      'Failed to refresh GitHub token, no access_token returned:',
      tokenData,
    );
  } catch (error) {
    console.error('Failed to refresh GitHub token:', error);
  }

  return integrationData;
}
