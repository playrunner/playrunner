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
4. Authorize the app.
5. The popup closes automatically and Playrunner stores the GitHub credentials.

---

## Step 4 - Select a Repository and Branch

With GitHub connected:

1. Use the **Repository** dropdown to search and select your test repo.
2. Use the **Branch** dropdown to choose the branch you want to run tests from (e.g. `main`).
3. Your selection is saved automatically.

---

## Token refresh

Playrunner automatically refreshes your GitHub access token in the background before it expires. You won't need to re-authenticate unless you revoke access from GitHub's side.

---

## Next steps

➡️ [Run Your First Test](./run-your-first-test)
