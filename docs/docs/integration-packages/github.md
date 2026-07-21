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

For the end-user setup flow, including the GitHub App fields, callback URL, app
installation, and repository selection, see
[Connect GitHub](../tutorials/03-connect-github.md).

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
