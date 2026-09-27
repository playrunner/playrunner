import { teamsScopes } from '../scopes';

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function createTeamsAuthorization(input: {
  tenantId: string;
  clientId: string;
  redirectUri: string;
}) {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  );
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(input.tenantId)}/oauth2/v2.0/authorize`,
  );
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: teamsScopes,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return { url: url.toString(), verifier, state };
}

export function isTeamsCallback(
  event: MessageEvent,
  popup: Window,
  state: string,
  origin: string,
) {
  return (
    event.origin === origin &&
    event.source === popup &&
    event.data?.type === 'oauth_callback' &&
    event.data?.params?.state === state
  );
}
