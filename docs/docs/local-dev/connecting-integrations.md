---
sidebar_position: 3
title: Connecting Integrations
---

# Connecting Integrations

## OAuth Integrations

When adding a new OAuth integration, it requires a complete flow spanning the frontend UI, authentication popups, routing, and backend proxy endpoints. Ensure you implement all of the following components:

### 1. Frontend Settings Modal
Create a configuration modal (e.g., `ProviderSettingsModal.tsx`) that:
- Provides clear, step-by-step instructions in the UI explaining exactly how the user can obtain their `Client ID` and `Client Secret` from the specific provider's developer console.
- Allows the user to input their `Client ID` and `Client Secret`.
- Opens a popup window pointing to the provider's OAuth URL with the appropriate `scope`, `redirect_uri`, and `response_type=code`.
- Listens for an `oauth_callback` message from the popup via `window.addEventListener('message', ...)`.
- Takes the authorization code and exchanges it for access/refresh tokens using the backend proxy endpoint.
- Persists the credentials using `DbAPI.saveIntegration` or `DbAPI.saveCloudCredential`.
- Implements token refresh logic if the access token is expired before making API calls.

### 2. The Callback Route
The provider will redirect back to the application. This is handled automatically by the application's dynamic router:
- **Built-in Route:** The main routing file (`apps/web/src/App.tsx`) contains a dynamic route: `<Route path="/oauth/callback/:provider" element={<OAuthCallback />} />`. You do NOT need to add a new route for each integration.
- **Consistent URLs:** The `redirect_uri` used in your `window.open` call must EXACTLY match the one configured in the OAuth provider portal. It should follow the format: `https://[your-domain]/oauth/callback/[provider-id]`.

### 3. Backend Proxy Endpoints (API)
You must create backend endpoints to handle token exchange and refresh. The backend acts as a proxy to prevent CORS issues and cleanly parse provider responses:
- **Token Exchange Endpoint:** `POST /api/[provider]/token`
  - Receives `code`, `client_id`, `client_secret`, and `redirect_uri` from the frontend.
  - Makes a request to the provider's token URL (e.g., `grant_type=authorization_code`).
  - Returns the `access_token` and `refresh_token` to the frontend.
- **Token Refresh Endpoint:** `POST /api/[provider]/refresh`
  - Receives `refresh_token`, `client_id`, and `client_secret`.
  - Makes a request to the provider's token URL (e.g., `grant_type=refresh_token`).
  - Returns the new tokens to the frontend.
- **Security:** Ensure these endpoints are mounted correctly in the main Express router (`apps/api/src/index.ts` or `routes/index.ts`) and are protected by authentication middleware if applicable.

### 4. Database Storage
Store the integration credentials securely in Firestore using the existing `DbAPI`:
- Save `clientId`, `clientSecret`, `accessToken`, `refreshToken`, and an `expiresAt` timestamp (calculated using `Date.now() + expires_in * 1000`).
- Use `merge: true` when updating tokens to preserve other configuration fields (like selected projects or repositories).
