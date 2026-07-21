---
sidebar_position: 3
title: Connect GitHub
---

# Connect GitHub

Playrunner uses a GitHub App with OAuth user authorization to clone private test
repositories. This tutorial shows you how to create the app, authenticate, select
a repository, and set a target branch.

**Prerequisites:** A GitHub account and a repository containing Playwright tests.

---

## Step 1 - Create a GitHub App

1. Open Playrunner, go to **Integrations**, and open **Connect to GitHub**.
2. Copy the callback URL shown in the dialog.
3. Go to
   **GitHub -> Settings -> Developer settings -> GitHub Apps -> New GitHub App**.
4. Under **Basic information**, set:
   - **GitHub App name:** a local name such as `Playrunner Local`
   - **Homepage URL:** the normal app URL printed by `./start-local.sh` (with
     defaults: `http://127.0.0.1:3100`)
5. Under **Identifying and authorizing users**, paste the callback URL from
   Playrunner.
6. Check **Request user authorization (OAuth) during installation**.
7. Under **Post installation**, set **Setup URL** to the same callback URL and
   check **Redirect on update**.
8. Under **Webhook**, uncheck **Active**.
9. Under **Repository permissions**, set **Contents** to **Read and write**.
10. Under **Where can this GitHub App be installed?**, select the installation
    scope you want:
    - **Only on this account** for your own repositories.
    - **Any account** if other users will install this app for their
      repositories.
11. Click **Create GitHub App**.
12. Generate a new **Client Secret**.
13. Copy the **Client ID**, **Client Secret**, and the app URL slug from
    `https://github.com/apps/<slug>`.

---

## Step 2 - Paste Credentials in Playrunner

In the **Connect to GitHub** dialog, fill in:

- **GitHub App Name (URL Slug):** the `<slug>` from
  `https://github.com/apps/<slug>`
- **Client ID:** the GitHub App client ID
- **Client Secret:** the generated client secret

---

## Step 3 - Install and Authenticate

1. Click **Authenticate** in the Playrunner dialog.
2. A GitHub popup opens for app installation.
3. Choose the repositories Playrunner can access.
4. After installation, the popup continues to GitHub's user authorization
   screen. Approve the requested access.
5. GitHub returns a one-time OAuth code to Playrunner. The API exchanges that
   code, encrypts the resulting credentials, and stores the connection.
6. Wait for the popup to close and for the dialog to show **Connected** before
   closing it.

Reopen **Connect to GitHub** to verify the saved connection. Playrunner restores
the non-secret app name and the connected status. The client ID, client secret,
and tokens deliberately remain blank because saved secrets are never returned
to the browser.

If the dialog returns to **Not connected**, the OAuth exchange or credential
save did not finish. Read the error in the dialog and check the API terminal. For
a local checkout, restart with `./start-local.sh` so the API has its credential
encryption key, then authenticate again.

---

## Step 4 - Select a Repository and Branch

With GitHub connected:

1. Open a Playwright node and use the **Repository** dropdown to select your
   test repository.
2. Use the **Branch** dropdown to choose the branch you want to run tests from,
   such as `main`.
3. Your selection is saved automatically.

Repository and branch discovery runs through the authenticated Playrunner API.
The API decrypts the saved GitHub access token, requests only the repositories
granted to the saved GitHub App installation, and returns repository or branch
metadata to the browser. The browser never receives the access token.

If the connection shows **Connected** but the repository list is empty:

1. Check that the GitHub App installation has access to at least one repository.
2. Read the error displayed below the repository dropdown and check the API
   terminal for the matching GitHub response.
3. For local package development, confirm both `@playrunner/github` and
   `@playrunner/playwright` resolve to `packages/` rather than npm, then restart
   `./start-local.sh` and hard-refresh the browser. Reconnecting GitHub does not
   rebuild a stale frontend package.

---

## Token refresh

Playrunner refreshes the GitHub access token on the server before it expires and
updates only the encrypted secret fields. The browser and saved workflow never
receive the client secret or refresh token. You should not need to authenticate
again unless the GitHub authorization is revoked or the stored credential can
no longer be decrypted.

---

## Next steps

➡️ [Run Your First Test](./04-run-your-first-test.md)
