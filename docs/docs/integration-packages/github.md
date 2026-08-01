---
sidebar_position: 4
sidebar_label: GitHub
title: GitHub Integration
description: Connect GitHub repositories and install app credentials for Playrunner workflows.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="GitHub"
packageName="@playrunner/github"
description="Connect GitHub repositories and install app credentials for Playrunner workflows that need repository access."
icon="github"
installCommand="npm install @playrunner/github"
npmUrl="https://www.npmjs.com/package/@playrunner/github"
badges={['OAuth', 'API routes', 'Repository access']}
facts={[
{ label: 'Node type', value: 'Trigger' },
{ label: 'Connection', value: 'integration / github' },
{ label: 'Backend mount', value: '/api/github' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Settings and registration">
    Exports `githubIntegration` and `GithubSettingsModal`. The integration keeps
    the existing `github` id so saved workflow auth references continue to
    resolve.
  </IntegrationCard>

  <IntegrationCard eyebrow="Backend" title="OAuth proxy routes">
    Exports `githubRouter`, mounted by the host API at `/api/github`, for token
    exchange, refresh, repository discovery, and branch discovery.
  </IntegrationCard>

  <IntegrationCard eyebrow="Used by Playwright" title="Repository auth">
    Playwright reuses `GithubSettingsModal` for repository authentication, so
    GitHub must remain a selected direct dependency when Playwright is installed.
  </IntegrationCard>

  <IntegrationCard eyebrow="Assets" title="Package-owned icon">
    GitHub exports a package-owned React SVG component that uses `currentColor`
    to follow the active theme. Its raw SVG remains available as a separate
    asset export.
  </IntegrationCard>
</IntegrationGrid>

## Setup

Playrunner uses a GitHub App with OAuth user authorization to access private
repositories. You need a GitHub account and a repository containing Playwright
tests.

### Create a GitHub App

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

### Add the credentials to Playrunner

In the **Connect to GitHub** dialog, fill in:

- **GitHub App Name (URL Slug):** the `<slug>` from
  `https://github.com/apps/<slug>`
- **Client ID:** the GitHub App client ID
- **Client Secret:** the generated client secret

### Install and authenticate

1. Click **Authenticate** in the Playrunner dialog.
2. In the GitHub popup, install the app and choose the repositories Playrunner
   can access.
3. Approve the requested user access when the popup continues to GitHub's user
   authorization screen.
4. Wait for the popup to close and the dialog to show **Connected** before
   closing it.

GitHub returns a one-time OAuth code to Playrunner. The API exchanges that code,
encrypts the resulting credentials, and stores the connection. Reopen
**Connect to GitHub** to verify the saved connection. Playrunner restores the
non-secret app name and connected status; the client ID, client secret, and
tokens remain blank because saved secrets are never returned to the browser.

If the dialog returns to **Not connected**, read the error in the dialog and
check the API terminal. For a local checkout, restart with `./start-local.sh` so
the API has its credential encryption key, then authenticate again.

For repository and branch selection after connecting, continue with the
[Connect GitHub tutorial](../tutorials/03-connect-github.md#step-4---select-a-repository-and-branch).

## Exports

```ts
import githubIntegration, {
  GithubIcon,
  GithubSettingsModal,
  githubIconUrl,
} from '@playrunner/github';
import githubApiContribution, { githubRouter } from '@playrunner/github/api';
```

## Frontend

The integration uses `@playrunner/integration-sdk` for host-provided auth,
persistence, and UI primitives. Its own package manifest declares the `.`
frontend and `./api` surfaces, and each entrypoint default-exports its
contribution. Frontend and API builds discover those surfaces from installed
direct production dependencies and generate static imports; no shared registry
edit is required.

## API

The API entrypoint default-exports `githubApiContribution`, containing
`githubRouter` and its `/api/github` mount path.

The router owns:

- `POST /token`
- `POST /refresh`
- `GET /repositories`
- `GET /branches?repository=owner/name`

The token endpoint completes the GitHub App installation and user OAuth flow,
then saves app metadata and encrypted credentials through the host's
request-scoped connection store. The refresh endpoint resolves and updates
those secrets on the server. Neither route returns tokens to the browser.

The repository endpoint uses the installation ID saved in connection `config`
and the decrypted user access token from connection `secrets`. It returns only
repository IDs and full names. The branch endpoint accepts the selected
`owner/name` repository and returns branch names. These routes keep GitHub
credentials out of browser integration data while still supporting the
Playwright selectors.

## Assets

The GitHub SVG lives inside the package at
`packages/github/assets/github.svg`. Product UI renders `GithubIcon`, whose
inline SVG uses `fill="currentColor"` so the mark follows the active theme. The
separate `githubIconUrl` export is available to consumers that specifically need
the asset URL. The app does not need a duplicate public asset or a CSS mask.
