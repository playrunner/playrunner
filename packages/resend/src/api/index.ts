import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Response as ExpressResponse } from 'express';
import type { IntegrationCredentialStore } from '@playrunner/integration-sdk/api';

const DEFAULT_API_BASE_URL = 'https://api.resend.com';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_EARLY_MS = 2 * 60 * 1000;

function apiBaseUrl() {
  return (process.env.RESEND_API_BASE_URL || DEFAULT_API_BASE_URL).replace(
    /\/+$/,
    '',
  );
}

function credentialStore(req: unknown): IntegrationCredentialStore {
  const store = (req as { integrationCredentials?: IntegrationCredentialStore })
    .integrationCredentials;
  if (!store) {
    throw Object.assign(new Error('Credential storage is unavailable.'), {
      statusCode: 500,
    });
  }
  return store;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function validRedirectUri(value: unknown): string {
  if (typeof value !== 'string') {
    throw Object.assign(new Error('Redirect URI is required.'), {
      statusCode: 400,
    });
  }
  const url = new URL(value);
  const isLoopback =
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.hash || (url.protocol !== 'https:' && !isLoopback)) {
    throw Object.assign(
      new Error('Redirect URI must use HTTPS or a loopback HTTP address.'),
      { statusCode: 400 },
    );
  }
  return url.toString();
}

async function jsonResponse(response: Response) {
  const value = (await response.json().catch(() => undefined)) as unknown;
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function oauthError(data: Record<string, unknown>, fallback: string) {
  return typeof data.error_description === 'string'
    ? data.error_description
    : typeof data.error === 'string'
      ? data.error
      : fallback;
}

function basicAuthorization(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export async function refreshResendCredentials(
  store: IntegrationCredentialStore,
  _kind: 'cloud' | 'integration' = 'integration',
  force = false,
) {
  const connection = await store.resolve('integration', 'resend');
  if (!connection || connection.config.authMode === 'apiKey') return;

  const expiresAt = connection.secrets.expiresAt;
  if (
    !force &&
    typeof expiresAt === 'number' &&
    Date.now() < expiresAt - REFRESH_EARLY_MS
  ) {
    return;
  }

  const clientId = connection.secrets.clientId;
  const clientSecret = connection.secrets.clientSecret;
  const refreshToken = connection.secrets.refreshToken;
  if (
    typeof clientId !== 'string' ||
    typeof clientSecret !== 'string' ||
    typeof refreshToken !== 'string'
  ) {
    throw new Error('Resend authorization has expired. Reconnect Resend.');
  }

  const response = await fetch(`${apiBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthorization(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const data = await jsonResponse(response);
  if (!response.ok || typeof data.access_token !== 'string') {
    throw new Error('Resend authorization has expired. Reconnect Resend.');
  }

  await store.updateSecrets('integration', 'resend', {
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === 'string'
        ? data.refresh_token
        : refreshToken,
    expiresAt:
      typeof data.expires_in === 'number'
        ? Date.now() + data.expires_in * 1000
        : undefined,
    scope: typeof data.scope === 'string' ? data.scope : 'full_access',
  });
}

function handleError(error: unknown, res: ExpressResponse) {
  const status =
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : error instanceof TypeError
        ? 400
        : 500;
  res.status(status).json({
    error:
      status >= 500
        ? 'Resend setup failed.'
        : error instanceof Error
          ? error.message
          : 'Invalid request.',
  });
}

export const resendRouter = Router();

resendRouter.post('/oauth/start', async (req, res) => {
  try {
    const store = credentialStore(req);
    const redirectUri = validRedirectUri(req.body?.redirectUri);
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const registrationResponse = await fetch(`${apiBaseUrl()}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Playrunner Resend Integration',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'full_access',
      }),
    });
    const registration = await jsonResponse(registrationResponse);
    if (
      !registrationResponse.ok ||
      typeof registration.client_id !== 'string' ||
      typeof registration.client_secret !== 'string'
    ) {
      throw Object.assign(
        new Error(
          oauthError(registration, 'Resend client registration failed.'),
        ),
        { statusCode: registrationResponse.status || 502 },
      );
    }

    const receivingAddress =
      typeof req.body?.receivingAddress === 'string'
        ? req.body.receivingAddress.trim()
        : '';
    await store.save('integration', 'resend-oauth-pending', {
      provider: 'resend-oauth-pending',
      config: {
        authMode: 'oauth',
        ...(receivingAddress ? { receivingAddress } : {}),
      },
      secrets: {
        clientId: registration.client_id,
        clientSecret: registration.client_secret,
        oauthState: state,
        oauthVerifier: verifier,
        oauthRedirectUri: redirectUri,
        oauthStartedAt: Date.now(),
      },
    });

    const authorizationUrl = new URL(`${apiBaseUrl()}/oauth/authorize`);
    authorizationUrl.search = new URLSearchParams({
      client_id: registration.client_id,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'full_access',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    res.json({ authorizationUrl: authorizationUrl.toString() });
  } catch (error) {
    handleError(error, res);
  }
});

resendRouter.post('/oauth/token', async (req, res) => {
  try {
    const store = credentialStore(req);
    const connection = await store.resolve(
      'integration',
      'resend-oauth-pending',
    );
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    const state = typeof req.body?.state === 'string' ? req.body.state : '';
    const redirectUri = validRedirectUri(req.body?.redirectUri);
    const secrets = connection?.secrets ?? {};
    const startedAt = secrets.oauthStartedAt;
    if (
      !code ||
      !state ||
      typeof secrets.oauthState !== 'string' ||
      !safeEqual(state, secrets.oauthState) ||
      typeof startedAt !== 'number' ||
      Date.now() - startedAt > OAUTH_STATE_TTL_MS ||
      secrets.oauthRedirectUri !== redirectUri ||
      typeof secrets.clientId !== 'string' ||
      typeof secrets.clientSecret !== 'string' ||
      typeof secrets.oauthVerifier !== 'string'
    ) {
      throw Object.assign(
        new Error('Resend OAuth state is invalid or expired.'),
        {
          statusCode: 400,
        },
      );
    }

    const tokenResponse = await fetch(`${apiBaseUrl()}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthorization(
          secrets.clientId,
          secrets.clientSecret,
        ),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: secrets.oauthVerifier,
      }),
    });
    const tokens = await jsonResponse(tokenResponse);
    if (!tokenResponse.ok || typeof tokens.access_token !== 'string') {
      throw Object.assign(
        new Error(oauthError(tokens, 'Resend token exchange failed.')),
        { statusCode: tokenResponse.status || 502 },
      );
    }

    await store.save('integration', 'resend', {
      provider: 'resend',
      config: connection?.config ?? { authMode: 'oauth' },
      secrets: {
        clientId: secrets.clientId,
        clientSecret: secrets.clientSecret,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt:
          typeof tokens.expires_in === 'number'
            ? Date.now() + tokens.expires_in * 1000
            : undefined,
        scope: typeof tokens.scope === 'string' ? tokens.scope : 'full_access',
      },
    });
    res.json({ connected: true });
  } catch (error) {
    handleError(error, res);
  }
});

export const resendApiContribution = {
  id: 'resend',
  mountPath: '/api/resend',
  router: resendRouter,
  prepareCredentials: refreshResendCredentials,
};

export default resendApiContribution;
