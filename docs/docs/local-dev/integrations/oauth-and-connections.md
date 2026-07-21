---
sidebar_position: 6
title: OAuth and Connection Development
description: Implement package-owned OAuth, encrypted credential persistence, callback handling, and API routes.
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
- Sends the authorization code and initial credential fields to the authenticated
  package API endpoint. The endpoint exchanges and persists the tokens.
- Reads only the public connection returned by
  `useIntegrationHost().store.getIntegration`. Use
  `credentialStatus.configured` for connected state; secret values are never
  returned to the browser.
- Leaves saved secret inputs blank when the modal is reopened. Blank inputs do
  not mean that the connection is missing.

### 2. The Callback Route

The provider will redirect back to the application. This is handled automatically by the application's dynamic router:

- **Built-in Route:** The main routing file (`apps/frontend/src/App.tsx`) contains a dynamic route: `<Route path="/oauth/callback/:provider" element={<OAuthCallback />} />`. You do NOT need to add a new route for each integration.
- **Consistent URLs:** The `redirect_uri` used in your `window.open` call must EXACTLY match the one configured in the OAuth provider portal. It should follow the format: `https://[your-domain]/oauth/callback/[provider-id]`.

### 3. Package-owned API endpoints

You must create backend endpoints to handle token exchange and refresh. The backend acts as a proxy to prevent CORS issues and cleanly parse provider responses:

- **Token Exchange Endpoint:** `POST /api/[provider]/token`
  - Receives the authorization code and the fields required for the initial
    exchange from the frontend.
  - Makes a request to the provider's token URL (e.g.,
    `grant_type=authorization_code`).
  - Saves provider metadata in `config` and credentials in `secrets` through the
    request-scoped credential store.
  - Returns a success status, not access or refresh tokens.
- **Token Refresh Endpoint:** `POST /api/[provider]/refresh`
  - Resolves the existing encrypted credentials through the request-scoped
    credential store.
  - Makes a request to the provider's token URL (e.g.,
    `grant_type=refresh_token`).
  - Updates the encrypted token fields and returns a success status.
- **API contribution:** Default-export the package API contribution containing
  its stable integration ID, mount path, and Express router. The API host mounts
  it from the generated build-time composition.
- **Security:** Protect credential endpoints with the appropriate authentication
  middleware. Do not expose client secrets or provider tokens to unrelated
  integrations.

### 4. Connection envelopes

Every provider uses the same envelope. Provider-specific names are expected
inside `config` and `secrets`; the consistent part is where each type of value is
stored.

```ts
// GCP connection
{
  provider: 'gcp',
  config: {
    selectedProject: 'my-project',
    cloudRunLocation: 'australia-southeast1',
  },
  secrets: {
    clientId: '...',
    clientSecret: '...',
    accessToken: '...',
    refreshToken: '...',
  },
}
```

Use `config` for values that are safe to return to the browser, such as project,
region, app slug, or account-level defaults. Use `secrets` for API keys, client
credentials, OAuth tokens, passwords, and webhook URLs. The API rejects known
secret field names nested under `config`.

Package API contributions access resolved credentials through the SDK instead
of importing Prisma or host modules:

```ts
import { getIntegrationCredentialStore } from '@playrunner/integration-sdk/api';

const store = getIntegrationCredentialStore(req);
if (!store) throw new Error('Credential storage is unavailable.');

await store.save('integration', 'provider-id', {
  provider: 'provider-id',
  config: { accountName },
  secrets: {
    clientId,
    clientSecret,
    accessToken,
    refreshToken,
    expiresAt,
  },
});
```

`save` replaces only the envelope sections that are supplied. A config-only save
preserves the existing encrypted secrets. Use `updateSecrets` for refresh-token
updates that must merge with the current secret object.

### 5. Persistence and resolution

The host stores one Prisma `Connection` row per `userId + kind + provider`.
`config` remains JSON, while `secrets` is encrypted with AES-256-GCM and stored
as `encryptedSecrets` with an `encryptionVersion`. The authenticated public
store routes return `config` and `credentialStatus.configured`; they never
return decrypted secrets.

Only trusted server paths resolve secrets. Package API endpoints use the
request-scoped credential store, and workflow execution resolves the required
provider connections before sending package-scoped settings to a runner. Do not
put credentials in workflow node config, browser state, node output, or error
messages.

Deleting an integration or cloud credential deletes its `Connection` row.
Provider-specific node choices, such as a repository and branch, still belong
on workflow node config unless they are account-level connection defaults.
