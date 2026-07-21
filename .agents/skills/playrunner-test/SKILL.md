---
name: playrunner-test
description: Build and maintain Playrunner package-owned Playwright end-to-end coverage, including the core frontend E2E harness, real API/database lifecycle, mock and live provider modes, shared integration E2E contracts, package POMs, deterministic datasets, scenario contributions, generated discovery, selectors, and CI verification. Use when adding E2E coverage to packages/*, changing apps/frontend/e2e, extending the e2e integration surface, debugging package browser tests, or reviewing Playrunner test architecture.
---

# Playrunner Test

## Overview

Keep package-specific test knowledge in the package and keep browser, host,
authentication, real Playrunner API/database lifecycle, provider fakes,
discovery, and reporting infrastructure in the core frontend harness.

Read [references/e2e-architecture.md](references/e2e-architecture.md) completely
before adding a package contribution or changing the harness contract.

## Workflow

1. Inspect the package's declared frontend, API, and orchestrator surfaces.
2. Identify the real user journey and the smallest deterministic scenario that
   proves package composition, configuration, persistence, and cleanup.
3. Reuse `@playrunner/integration-sdk/e2e`; do not invent a package-local
   contribution contract.
4. Add a package-owned `./e2e` export with a POM, data factory, scenarios, and
   default contribution.
5. Compose the core `PlayrunnerE2EHost`; do not duplicate login, integrations
   navigation, browser creation, server startup, or reporting in the package.
6. Prefer accessible roles, names, and labels. Add a namespaced test id only
   where a stable semantic locator is unavailable.
7. Run the real Playrunner API against the dedicated E2E database schema.
   Replace only outbound provider boundaries in default mock mode.
8. Generate the E2E contribution registry before Playwright test discovery.
9. Run the package, SDK, generator, frontend, and browser checks listed below.

## Hard Rules

- Keep Playwright and E2E source out of production entrypoints and bundles.
- Declare `playrunner.integration.e2e` and an exact matching package export.
- Let the frontend's direct dependencies determine the tested package set.
- Register tests in the core spec; package modules export scenario data and
  functions but never import or invoke Playwright's `test` object.
- Generate unique data from `runId`; do not depend on scenario order or shared
  records left by another test.
- Never store real API keys, tokens, OAuth state, auth storage, traces, videos,
  reports, or test results in Git.
- Never mock browser-to-Playrunner APIs in package E2E. Run the real API and
  dedicated PostgreSQL schema. For API-server outbound provider traffic, use
  an injectable client or fake upstream server because `page.route` cannot
  intercept server-side HTTP.
- Every scenario declares `mode: 'mock' | 'live'`. Default runs select `mock`;
  live scenarios must be explicitly selected and secret-gated.
- Keep live-provider tests optional, tagged `@live`, secret-gated, and outside
  the normal pull-request gate.
- Do not add package ids or imports to handwritten shared registries.
- Do not update product documentation until the user has tested and accepted
  the implementation.

## Required Package Shape

Use this layout:

```text
packages/<id>/
  src/e2e/
    <Package>E2EPom.ts
    data.ts
    index.ts
```

Export the contribution from `./e2e`, include `@playwright/test` as an optional
peer plus development dependency when its types are used, and add the SDK E2E
path to the package TypeScript configuration.

## Verification

Run the narrow checks first, then the composed browser test:

```bash
npm run test:integration-composition
npm run typecheck --prefix packages/integration-sdk
npm run lint --prefix packages/integration-sdk
npm run typecheck --prefix packages/<id>
npm run lint --prefix packages/<id>
npm run generate:e2e-integrations --prefix apps/frontend
npm run typecheck --prefix apps/frontend
npm run lint --prefix apps/frontend
npm run test:e2e:mock -- --grep @<id>
npm run test:e2e:live -- --grep @<id>
git diff --check
```

Also run package tests and builds relevant to any production surfaces changed.
Inspect `npm pack --dry-run --json` when changing the published E2E export.

## Handoff

Report the scenarios exercised, whether they use simulated or live provider
traffic, the exact test command, and any unavailable browser/dependency checks.
No runner image push is needed for frontend/package E2E-only changes.
