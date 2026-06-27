---
sidebar_position: 7
title: Playwright Package
---

# Playwright Package

`@playrunner/playwright` contains the built-in Playwright test runner trigger node.

## Exports

```ts
import {
  playwrightIntegration,
  PlaywrightConfigPanel,
} from "@playrunner/playwright";
import { playwrightRouter } from "@playrunner/playwright/api";
```

## Frontend

The frontend entrypoint exports `playwrightIntegration`, which keeps the existing integration id as `playwright` so saved workflows continue to resolve their test runner nodes.

The package owns the Playwright configuration UI, including repository selection, inline script editing, zip upload metadata, environment variable injection, and runner resource settings.

## GitHub Dependency

Playwright repository authentication still uses GitHub. The package imports `GithubSettingsModal` from `@playrunner/github` and declares `@playrunner/github` as a peer dependency. The host app must install both packages and keep the GitHub integration registered.

## API

The API entrypoint exports an empty `playwrightRouter`, mounted by the host API at `/api/playwright`. The current Playwright node executes through workflow runner infrastructure rather than package-local API endpoints, but the package still exposes an API entrypoint so all extracted integration packages have the same frontend/API shape.

## Assets

The Playwright SVG lives inside the package at `packages/playwright/assets/playwright.svg`. The frontend entrypoint resolves it with `new URL(..., import.meta.url)`, so the app does not need a duplicate public asset.
