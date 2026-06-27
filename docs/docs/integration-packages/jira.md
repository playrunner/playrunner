---
sidebar_position: 2
sidebar_label: Jira
title: Jira Integration
---

# Jira Integration

`@playrunner/jira` is the reference integration.

## Install

```bash
npm install @playrunner/jira
```

npm: [@playrunner/jira](https://www.npmjs.com/package/@playrunner/jira) (placeholder until published)

## Exports

```ts
import {
  jiraIntegration,
  JiraConfigPanel,
  JiraSettingsModal,
} from "@playrunner/jira";
import { jiraRouter } from "@playrunner/jira/api";
```

## Frontend

The frontend entrypoint exports `jiraIntegration`, which includes the integration metadata, SVG icon URL, settings modal, and node config panel. Jira uses SDK UI helpers and reads Playrunner host services through `useIntegrationHost`.

The host app registers Jira in `apps/frontend/src/integrations/registry.ts`.

## API

The API entrypoint exports `jiraRouter`, mounted by the host API at `/api/jira`.

The router owns:

- `POST /token`
- `POST /refresh`
- `GET /projects`

## Assets

The Jira SVG lives inside the package at `packages/jira/assets/jira.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
