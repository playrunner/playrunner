---
sidebar_position: 3
title: Connect GitHub
---

# Connect GitHub

Playrunner uses GitHub OAuth to clone your private test repositories. This tutorial shows you how to authenticate, select a repository, and set a target branch.

**Prerequisites:** A GitHub account and a repository containing Playwright tests.

---

## Step 1 — Create a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Fill in:
   - **Application name:** `Playrunner Local`
   - **Homepage URL:** the normal app URL printed by `./start-local.sh` (with defaults: `http://127.0.0.1:3100`)
   - **Authorization callback URL:** the same base URL with `/oauth/callback/github` appended (with defaults: `http://127.0.0.1:3100/oauth/callback/github`)
3. Click **Register application**.
4. Copy the **Client ID** and generate a **Client Secret**.

---

## Step 2 — Add credentials to your API `.env`

Open `apps/api/.env` and set:

```env
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
```

Restart the API for the changes to take effect (re-run `./start-local.sh`).

---

## Step 3 — Authenticate in the editor

1. Open the Playrunner editor at the URL printed by `./start-local.sh`. With defaults, that is `http://127.0.0.1:3100`.
2. Click on a **Playwright** node to open its configuration panel.
3. In the **GitHub** section, click **Connect GitHub**.
4. A popup window opens → authorise Playrunner in GitHub.
5. The popup closes automatically and your GitHub username appears in the panel — you're connected.

---

## Step 4 — Select a repository and branch

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
