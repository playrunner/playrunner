---
sidebar_position: 1
title: Testing
description: Run Playrunner's deterministic browser tests and inspect their results.
---

# Testing

Playrunner's package E2E harness runs package-owned scenarios against the real
frontend in Chromium. Each integration package contributes its test data, page
object model (POM), and scenarios through an `./e2e` export. The core harness
discovers those contributions and supplies the shared browser and host
fixtures.

The current harness is deterministic: it starts the real Vite frontend and
simulates the browser-facing integration persistence API in memory. It does not
require PostgreSQL, a running Playrunner API, or real provider credentials, and
it does not make requests to OpenAI.

## Run the tests

Install the repository dependencies, then install Playwright's Chromium browser
once on a new development machine:

```bash
npm exec --prefix apps/frontend -- playwright install chromium
```

From the repository root, run every package E2E scenario:

```bash
npm run test:e2e
```

Filter by a package's Playwright tag while developing. The extra `--` is
required so npm forwards `--grep` to Playwright:

```bash
npm run test:e2e -- --grep @openai
```

The OpenAI scenario connects an API key, confirms the connected state survives
a browser reload, disconnects it, and confirms the disconnected state also
survives a reload.

## Reports and debugging

The HTML report is written to `playwright-report/` at the repository root. Open
the most recent report with:

```bash
npx playwright show-report
```

Playwright retains traces, screenshots, and videos for failed attempts under
`apps/frontend/test-results/`. Both output directories are ignored by Git.

Useful troubleshooting checks:

- **No tests found:** include the forwarding separator in
  `npm run test:e2e -- --grep @openai`. Playwright treats its remaining command
  arguments as test-file regular expressions, so `@openai` must reach `--grep`.
- **Chromium executable is missing:** run the browser installation command
  above.
- **Port 4173 is already in use:** stop the existing frontend dev server before
  rerunning the suite.
- **No HTML report found:** run a test with the current configuration first,
  then invoke `npx playwright show-report` from the repository root.

## Architecture

```text
packages/<integration>/src/e2e
  data factory + package POM + scenarios
                    │
                    ▼
@playrunner/<integration>/e2e (default contribution)
                    │ generated discovery
                    ▼
apps/frontend/e2e/package-contributions.spec.ts
                    │
                    ├── real Vite frontend
                    ├── shared Playrunner host POM
                    └── isolated in-memory API fixture
```

The core discovers contributions from package metadata and exports, not from
class names. A package can call its POM `OpenAIE2EPom`, `SlackSettingsPom`, or
anything else; the package's default E2E contribution constructs it through
`createPom`.

See [Package E2E Contributions](./package-e2e.md) to add coverage to another
integration.
