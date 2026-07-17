---
sidebar_position: 6
title: OAuth and Connection Development
description: Implement package-owned OAuth, credential persistence, callback handling, and API routes.
slug: /local-dev/connecting-integrations
---

# OAuth and Connection Development

## OAuth Integrations

An OAuth integration spans the package's frontend and API contributions. Declare
both surfaces in the package's `playrunner.integration` manifest metadata and
default-export each contribution. The frontend and API builds then generate
static imports from the installed direct production dependency; do not edit a
shared provider registry or add runtime package discovery.

Implement all of the following components in the package:

### 1. Frontend Settings Modal

Create a configuration modal (e.g., `ProviderSettingsModal.tsx`) that:

- Provides clear, step-by-step instructions in the UI explaining exactly how the user can obtain their `Client ID` and `Client Secret` from the specific provider's developer console.
- Allows the user to input their `Client ID` and `Client Secret`.
- Opens a popup window pointing to the provider's OAuth URL with the appropriate `scope`, `redirect_uri`, and `response_type=code`.
- Listens for an `oauth_callback` message from the popup via `window.addEventListener('message', ...)`.
- Takes the authorization code and exchanges it for access/refresh tokens using the backend proxy endpoint.
- Persists the credentials using `useIntegrationHost().store.saveIntegration`.
- Implements token refresh logic if the access token is expired before making API calls.

### 2. The Callback Route

The provider will redirect back to the application. This is handled automatically by the application's dynamic router:

- **Built-in Route:** The main routing file (`apps/frontend/src/App.tsx`) contains a dynamic route: `<Route path="/oauth/callback/:provider" element={<OAuthCallback />} />`. You do NOT need to add a new route for each integration.
- **Consistent URLs:** The `redirect_uri` used in your `window.open` call must EXACTLY match the one configured in the OAuth provider portal. It should follow the format: `https://[your-domain]/oauth/callback/[provider-id]`.

### 3. Package-owned API endpoints

You must create backend endpoints to handle token exchange and refresh. The backend acts as a proxy to prevent CORS issues and cleanly parse provider responses:

- **Token Exchange Endpoint:** `POST /api/[provider]/token`
  - Receives `code`, `client_id`, `client_secret`, and `redirect_uri` from the frontend.
  - Makes a request to the provider's token URL (e.g., `grant_type=authorization_code`).
  - Returns the `access_token` and `refresh_token` to the frontend.
- **Token Refresh Endpoint:** `POST /api/[provider]/refresh`
  - Receives `refresh_token`, `client_id`, and `client_secret`.
  - Makes a request to the provider's token URL (e.g., `grant_type=refresh_token`).
  - Returns the new tokens to the frontend.
- **API contribution:** Default-export the package API contribution containing
  its stable integration ID, mount path, and Express router. The API host mounts
  it from the generated build-time composition.
- **Security:** Protect credential endpoints with the appropriate authentication
  middleware. Do not expose client secrets or provider tokens to unrelated
  integrations.

### 4. Database Storage

Store integration credentials through the SDK store injected by the host app. Package code should not import `DbAPI`, Prisma, or host app modules directly.

```ts
const { auth, store } = useIntegrationHost();
const userId = auth.currentUser?.uid;
if (!userId) return;

await store.saveIntegration(userId, 'provider-id', {
  clientId,
  clientSecret,
  accessToken,
  refreshToken,
  expiresAt: Date.now() + tokenData.expires_in * 1000,
  updatedAt: new Date().toISOString(),
});
```

The host persists this as one Prisma `Integration` row per `userId + provider`, with provider-specific values in the `data` JSON column. `saveIntegration` currently replaces that JSON object, so token refresh code should preserve existing provider-owned fields:

```ts
const current = await store.getIntegration(userId, 'provider-id');
const {
  id,
  provider,
  userId: _storedUserId,
  createdAt,
  updatedAt,
  ...currentData
} = current ?? {};

await store.saveIntegration(userId, 'provider-id', {
  ...currentData,
  accessToken: refreshed.access_token,
  refreshToken: refreshed.refresh_token,
  expiresAt: Date.now() + refreshed.expires_in * 1000,
  updatedAt: new Date().toISOString(),
});
```

Save `clientId`, `clientSecret`, `accessToken`, `refreshToken`, and an `expiresAt` timestamp for OAuth integrations. Keep node-specific choices, such as selected projects or repositories, on the workflow node config unless they are account-level defaults.
