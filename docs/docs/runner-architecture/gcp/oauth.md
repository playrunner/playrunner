---
sidebar_position: 3
title: Google OAuth Setup
sidebar_label: OAuth
---

# Google OAuth Setup

OAuth connects Playrunner to a Google account. Playrunner uses the resulting
`cloud-platform` access and refresh tokens to provision runner resources and to
perform GCP workflow operations in the selected project.

## 1. Open the Connect Dialog

Start Playrunner locally from the repo root:

```bash
./start-local.sh
```

Open **Integrations**, choose **Connect to GCP**, and copy the **Authorized
redirect URI** shown in the dialog.

With the default local app URL, the redirect URI is:

```text
http://127.0.0.1:3100/oauth/callback/gcp
```

Always use the value shown in the dialog if your frontend has a different host
or port.

## 2. Create the Google OAuth Client

1. Open
   [Google Cloud Console APIs & Services](https://console.cloud.google.com/apis/credentials).
2. Open **OAuth consent screen**.
3. Create or update the consent screen.
4. Add the Google account that will authenticate with Playrunner as a test user
   if the OAuth app is still in testing.
5. Open **Credentials**.
6. Click **Create Credentials** and choose **OAuth client ID**.
7. Set **Application type** to **Web application**.
8. Add the URI copied from Playrunner as an **Authorized redirect URI**.
9. Create the client and copy its **Client ID** and **Client Secret**.

The OAuth client can be created in a different project from the project that
will run Playrunner workloads. The connected Google account must still have the
required IAM permissions in the selected workload project.

## 3. Authenticate in Playrunner

1. Paste the **Client ID** and **Client Secret** into the OAuth stage.
2. Click **Authenticate**.
3. Complete the Google popup and consent to the requested Google Cloud access.
4. Confirm that the dialog shows **Connected to GCP**.
5. Continue to **Project & Region**.

Playrunner stores the OAuth client details, access token, refresh token, and
expiry as encrypted GCP connection secrets. The API refreshes the access token
when necessary.

The project list is only an autocomplete convenience. On a new project, lookup
can be unavailable until Cloud Resource Manager is enabled. Enter the Project
ID manually and continue. If the Provision stage reports that Cloud Resource
Manager is disabled, enable that API in the selected project and retry.

## OAuth Permissions and IAM

The OAuth request uses this scope:

```text
https://www.googleapis.com/auth/cloud-platform
```

The scope allows Playrunner to request Google Cloud APIs on the user's behalf;
it does not add IAM permissions. The connected account must already have the
project permissions listed in [GCP Setup](./setup.md#required-google-cloud-permissions).

## Reconnecting

Reconnect when:

- Google revokes the grant;
- the refresh token is no longer valid;
- you want to use another Google account; or
- the existing account does not have access to the selected project.

Disconnecting GCP removes the saved credential and settings from Playrunner. It
does not delete Google Cloud resources or Artifact Registry images.

Continue to [Project and Region setup](./project-region.md).
