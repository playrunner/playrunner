---
sidebar_position: 8
title: Firebase & Data Storage
---

# Firebase & Data Storage

> **Local development only.** The app uses a live (remote) Firebase project even during local development — there is no local Firebase emulator configured.

---

## Firebase Services Used

| Service | Purpose |
|---|---|
| **Firebase Auth** | User authentication (email/password, Google) |
| **Cloud Firestore** | Persisting workflows, integrations, credentials, and secrets |

---

## Configuration

Firebase is configured via `apps/web/firebase-applet-config.json`, which is committed to the repo with the shared dev project credentials:

```json
{
  "projectId": "...",
  "appId": "...",
  "apiKey": "...",
  "authDomain": "...",
  "firestoreDatabaseId": "...",
  "storageBucket": "...",
  "messagingSenderId": "..."
}
```

This file is imported directly by `apps/web/src/lib/firebase.ts`, which initialises the Firebase SDK and exports `auth` and `db` for use throughout the app.

---

## Firestore Collections

All documents follow a **flat collection** pattern with deterministic IDs in the form `{userId}_{resourceId}`. This avoids subcollections and simplifies security rules.

### `workflows`

Stores workflow graphs (nodes, connections, name, etc.)

| Field | Type | Description |
|---|---|---|
| `userId` | string | Owner's Firebase UID |
| `nodes` | array | Workflow node definitions |
| `connections` | array | Workflow edge definitions |
| `name` | string | Workflow display name |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |

Document ID pattern: `{userId}_{workflowId}`

### `integrations`

Stores credentials for third-party integrations (GitHub, Slack, Jira, etc.)

| Field | Type | Description |
|---|---|---|
| `userId` | string | Owner's Firebase UID |
| `accessToken` | string | OAuth access token |
| `refreshToken` | string | OAuth refresh token (if applicable) |
| `expiresAt` | number | Token expiry timestamp (ms since epoch) |
| `clientId` | string | OAuth app client ID |
| `clientSecret` | string | OAuth app client secret |
| `updatedAt` | string | ISO timestamp |

Document ID pattern: `{userId}_{integrationId}` (e.g. `abc123_github`)

### `cloud_credentials`

Stores cloud provider credentials (GCP, AWS, etc.)

Document ID pattern: `{userId}_{providerId}`

### `secrets`

Stores arbitrary user-defined secrets.

Document ID pattern: `{userId}_{secretKey}`

---

## Security Rules

Firestore security rules are defined in `apps/web/firestore.rules`. All collections enforce:

- **Read/write requires authentication** — `request.auth != null`
- **Ownership enforcement** — documents can only be read/written by the user whose UID matches the document's `userId` field, or whose UID prefixes the document ID

Deploy updated rules with:
```bash
cd apps/web
firebase deploy --only firestore:rules
```

---

## GitHub Token Auto-Refresh

When any code reads a GitHub integration (`DbAPI.getIntegration(userId, 'github')`), the `db.ts` layer automatically checks if the token is expired or within 5 minutes of expiry. If so, it:

1. Calls `POST /api/github/refresh` with the stored `refreshToken`, `clientId`, and `clientSecret`
2. Updates the integration document in Firestore with the new tokens
3. Returns the refreshed integration data to the caller

This refresh is transparent — callers always receive a valid token without any manual intervention.

---

## DB API Reference

All Firestore interactions go through `apps/web/src/lib/db.ts`, which exposes a `DbAPI` object:

```typescript
DbAPI.getWorkflow(userId, workflowId)
DbAPI.getWorkflows(userId)
DbAPI.saveWorkflow(userId, workflowId, data)
DbAPI.createWorkflow(userId, data)
DbAPI.deleteWorkflow(userId, workflowId)

DbAPI.getIntegration(userId, integrationId)      // auto-refreshes GitHub token
DbAPI.saveIntegration(userId, integrationId, data)
DbAPI.getAllIntegrations(userId)                  // auto-refreshes GitHub token
DbAPI.subscribeToIntegration(userId, integrationId, callback)  // real-time listener
DbAPI.deleteIntegration(userId, integrationId)

DbAPI.getCloudCredential(userId, providerId)
DbAPI.saveCloudCredential(userId, providerId, data)
DbAPI.deleteCloudCredential(userId, providerId)

DbAPI.saveSecret(userId, secretKey, data)
```
