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
    { label: 'Auth path', value: 'users/{uid}/integrations/github' },
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
    exchange and refresh calls.
  </IntegrationCard>

  <IntegrationCard eyebrow="Used by Playwright" title="Repository auth">
    Playwright reuses `GithubSettingsModal` for repository authentication, so
    GitHub must stay installed and registered when Playwright is installed.
  </IntegrationCard>

  <IntegrationCard eyebrow="Assets" title="Package-owned icon">
    The GitHub SVG lives inside the package and the frontend no longer needs a
    duplicate public asset.
  </IntegrationCard>
</IntegrationGrid>

## Setup

For the end-user setup flow, including the GitHub App fields, callback URL, app
installation, and repository selection, see
[Connect GitHub](../tutorials/connect-github).

## Exports

```ts
import { githubIntegration, GithubSettingsModal } from "@playrunner/github";
import { githubRouter } from "@playrunner/github/api";
```

## Frontend

The integration uses `@playrunner/integration-sdk` for host-provided auth, persistence, and UI primitives. The host app registers GitHub in `apps/frontend/src/integrations/registry.ts`.

## API

The API entrypoint exports `githubRouter`, mounted by the host API at `/api/github`.

The router owns:

- `POST /token`
- `POST /refresh`

## Assets

The GitHub SVG lives inside the package at `packages/github/assets/github.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
