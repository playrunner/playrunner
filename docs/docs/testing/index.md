---
sidebar_position: 1
title: Testing
description: Run Playrunner's deterministic browser tests and inspect their results.
---

# Testing

Playrunner's package E2E harness runs package-owned scenarios against the real
frontend and API in Chromium. Each integration package contributes its test
data, page object model (POM), and scenarios through an `./e2e` export. The core
harness discovers those contributions and supplies the browser, authentication,
API, database, host POM, cleanup, and reporting lifecycle.

Every run uses the dedicated `playrunner_e2e` PostgreSQL schema. The launcher
applies the Prisma schema, clears stale test state, seeds local authentication,
and starts the normal API entrypoint on port `3999`. Vite starts on port `4173`
and proxies browser requests to that API.

## Run the tests

Complete local setup first. The test launcher reads `DATABASE_URL` from
`apps/api/.env`, so PostgreSQL must be running and reachable. You can override
the source database URL with `PLAYRUNNER_E2E_DATABASE_URL`; the launcher still
sets its schema to `playrunner_e2e` and never resets the normal application
schema.

Install the repository dependencies, then install Playwright's Chromium browser
once on a new development machine:

```bash
npm exec --prefix apps/frontend -- playwright install chromium
```

From the repository root, run every deterministic mock-provider scenario:

```bash
npm run test:e2e:mock
```

`npm run test:e2e` is an equivalent default invocation because the harness
selects mock mode when `PLAYRUNNER_E2E_MODE` is unset.

Filter by a package's Playwright tag while developing. The extra `--` is
required so npm forwards `--grep` to Playwright:

```bash
npm run test:e2e:mock -- --grep @github
npm run test:e2e -- --grep @github
```

The tag is plain shell text. For example, use `@github`, not a Markdown or
plugin link. The available package tags are `@environment`, `@gcp`, `@github`,
`@huggingface`, `@code`, `@jira`, `@openai`, `@playwright`, `@schedule`, and
`@slack`.

## Mock and live provider modes

Both modes run the real Playrunner frontend, local authentication, API,
credential encryption, and PostgreSQL persistence:

| Mode   | Third-party provider boundary                                      | Intended use                    |
| ------ | ------------------------------------------------------------------ | ------------------------------- |
| `mock` | Uses fake data or a deterministic fake provider when one is needed | Pull requests and local changes |
| `live` | Uses protected credentials and the real provider                   | Manual or protected CI checks   |

Run protected live-provider scenarios with:

```bash
npm run test:e2e:live
npm run test:e2e:live -- --grep @github
```

Each scenario declares `mode: 'mock'` or `mode: 'live'`. The harness skips
scenarios belonging to the other mode. No package currently contributes a live
scenario, so `npm run test:e2e:live` currently reports the discovered mock
scenarios as skipped. Adding live scenarios also requires package-specific
secret gating; credentials must never be committed or included in reports,
traces, screenshots, or videos.

The OpenAI mock scenario connects a fake API key through the real API, confirms
the encrypted connection state survives a browser reload, disconnects it, and
confirms the disconnected state also survives a reload. It does not make a
request to OpenAI.

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
  `npm run test:e2e:mock -- --grep @github`. Playwright treats its remaining
  command arguments as test-file regular expressions, so the tag must reach
  `--grep`.
- **Chromium executable is missing:** run the browser installation command
  above.
- **Database preparation fails:** confirm PostgreSQL is running and
  `apps/api/.env` contains a working `DATABASE_URL`, or set
  `PLAYRUNNER_E2E_DATABASE_URL`.
- **Port 3999 or 4173 is already in use:** stop the existing process before
  rerunning the suite. The harness deliberately refuses to reuse another API or
  frontend process.
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
                    └── real API + isolated PostgreSQL schema
                                      │
                                      └── mock or live provider boundary
```

The core discovers contributions from package metadata and exports, not from
class names. A package can call its POM `OpenAIE2EPom`, `SlackSettingsPom`, or
anything else; the package's default E2E contribution constructs it through
`createPom`.

See [Package E2E Contributions](./package-e2e.md) to add coverage to another
integration.
