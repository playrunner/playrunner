---
sidebar_position: 2
title: Jira Package
---

# Jira Package

`@playrunner/jira` is the reference integration package.

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

The frontend entrypoint exports `jiraIntegration`, which includes the integration metadata, SVG icon URL, settings modal, and node config panel. The package uses SDK UI helpers and reads Playrunner host services through `useIntegrationHost`.

The host app registers Jira in `apps/frontend/src/integrations/registry.ts`.

## API

The API entrypoint exports `jiraRouter`, mounted by the host API at `/api/jira`.

The router owns:

- `POST /token`
- `POST /refresh`
- `GET /projects`

## Assets

The Jira SVG lives inside the package at `packages/jira/assets/jira.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
