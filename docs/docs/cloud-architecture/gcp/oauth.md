---
sidebar_position: 3
title: Google OAuth Setup
sidebar_label: OAuth
---

# Google OAuth Setup

This step connects Playrunner to a Google account. It does not create Google
Cloud infrastructure and it does not run Terraform.

## 1. Open the Connect Dialog

Start Playrunner locally from the repo root (if not already running):

```bash
./start-local.sh
```

Open **Integrations**, choose **Connect to GCP**, and copy the **Authorized
redirect URI** shown in the dialog.

It will be something like the following

```text
http://127.0.0.1:3100/oauth/callback/gcp
```

or

```
http://localhost:3100/oauth/callback/gcp
```

## 2. Create the Google OAuth Client

1. Open
   [Google Cloud Console APIs & Services](https://console.cloud.google.com/apis/credentials).
2. Open **OAuth consent screen**.
3. Create or update the consent screen for the project.
4. Add the Google account that will authenticate with Playrunner as a test user
   if the app is still in testing.
5. Open **Credentials**.
6. Click **Create Credentials** and choose **OAuth client ID**.
7. Set **Application type** to **Web application**.
8. Add the redirect URI from Playrunner as an **Authorized redirect URI**.
9. Create the client.
10. Copy the generated **Client ID** and **Client Secret**.

## 3. Authenticate in Playrunner

1. Paste the **Client ID** and **Client Secret** into the Connect to GCP dialog.
2. Click **Authenticate**.
3. Complete the Google OAuth popup.
4. After the dialog shows **Connected to GCP**, select or enter the Google
   Cloud project ID.
5. Set the Cloud Run region, for example `us-central1`.
6. Click **Save GCP Settings**.

Playrunner stores the OAuth tokens, selected project, Cloud Run region, and
standard runner defaults in the local `CloudCredential` row.

After OAuth succeeds, Playrunner loads the Google Cloud projects visible to the
connected account on the **Project & Region** step. Start typing in the project
field and select the matching **Project ID** from the suggestions.

If the project is new, not visible to the connected account, or Google project
lookup fails, click **Refresh projects**. If it still does not appear, type the
Project ID manually. The project must already exist in GCP before you continue
to Terraform.

## 4. Continue to Terraform

After saving the GCP settings, continue to [Terraform setup](./terraform).
