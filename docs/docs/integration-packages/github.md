---
sidebar_position: 4
sidebar_label: GitHub
title: GitHub Integration
---

# GitHub Integration

`@playrunner/github` contains the built-in GitHub connection and OAuth proxy routes.

## Install

```bash
npm install @playrunner/github
```

npm: [@playrunner/github](https://www.npmjs.com/package/@playrunner/github) (placeholder until published)

## Exports

```ts
import { githubIntegration, GithubSettingsModal } from "@playrunner/github";
import { githubRouter } from "@playrunner/github/api";
```

## Frontend

The frontend entrypoint exports `githubIntegration`, which keeps the existing integration id as `github` so saved workflow auth references continue to resolve.

The integration uses `@playrunner/integration-sdk` for host-provided auth, persistence, and UI primitives. The host app registers GitHub in `apps/frontend/src/integrations/registry.ts`, and Playwright reuses `GithubSettingsModal` for repository auth.

## API

The API entrypoint exports `githubRouter`, mounted by the host API at `/api/github`.

The router owns:

- `POST /token`
- `POST /refresh`

## Assets

The GitHub SVG lives inside the package at `packages/github/assets/github.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
