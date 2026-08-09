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

Run E2E commands from the repository root. The prepared commands use Docker
Compose to start PostgreSQL and the Pub/Sub emulator, rebuild the local
Orchestrator image, and replace a stale Orchestrator container before Playwright
starts. Docker Desktop or another compatible Docker daemon must therefore be
running.

The test launcher reads `DATABASE_URL` from `apps/api/.env`. You can override
the source database URL with `PLAYRUNNER_E2E_DATABASE_URL`; the launcher still
sets its schema to `playrunner_e2e` and never resets the normal application
schema. Port overrides in `.env.local`, including `POSTGRES_PORT` and
`PUBSUB_EMULATOR_PORT`, are used when starting the supporting containers.

Install the repository dependencies, then install Playwright's Chromium browser
once on a new development machine:

```bash
npm exec --prefix apps/frontend -- playwright install chromium
```

From the repository root, run every deterministic mock-provider scenario:

```bash
npm run test:e2e:mock
```

Use `npm run test:e2e` only when PostgreSQL, Pub/Sub, and the current local
Orchestrator image are already prepared. It invokes Playwright directly and
selects mock mode when `PLAYRUNNER_E2E_MODE` is unset.

Filter by a package's Playwright tag while developing. The extra `--` is
required so npm forwards `--grep` to Playwright:

```bash
npm run test:e2e:mock -- --grep @github
npm run test:e2e:mock -- --grep '@environment|@github'
```

Quote combined regular expressions so the shell does not interpret `|` as a
pipe. A single tag can be quoted or unquoted. The available package tags are
`@environment`, `@gcp`, `@github`, `@huggingface`, `@code`, `@jira`, `@openai`,
`@playwright`, `@resend`, `@schedule`, `@slack`, and `@webhooks`.

The Environment node scenario creates a project and workflow, configures a
variable, saves it as a global environment through the real API and database,
reloads the workflow, and executes the node through the local Orchestrator.

The GitHub mock scenario seeds an encrypted test connection on the API server,
configures and reloads a Create Issue node, executes it through the local
Orchestrator, and verifies the issue sent to a local fake GitHub HTTP server.
The browser-to-Playrunner API, credential encryption, database, Pub/Sub, and
Orchestrator paths remain real.

## Mock and live provider modes

Both modes run the real Playrunner frontend, local authentication, API,
credential encryption, and PostgreSQL persistence:

| Mode   | Third-party provider boundary                                      | Intended use                    |
| ------ | ------------------------------------------------------------------ | ------------------------------- |
| `mock` | Uses fake data or a deterministic fake provider when one is needed | Pull requests and local changes |
| `live` | Uses protected credentials and the real provider                   | Manual or protected CI checks   |

The GitHub live scenario needs a token with access to the target repository and
permission to read and write issues. Export its protected values in the shell
or secret manager that starts the test; do not put them in `.env` files that
could be committed:

```bash
export PLAYRUNNER_E2E_GITHUB_TOKEN='replace-with-a-protected-token'
export PLAYRUNNER_E2E_GITHUB_REPOSITORY='owner/repository'

npm run test:e2e:live -- --grep @github
```

Each scenario declares `mode: 'mock'` or `mode: 'live'`. The harness skips
scenarios belonging to the other mode. The GitHub live scenario stores the
token in the API's encrypted connection store without sending it to the
browser, creates a real issue through the GitHub node, verifies the issue with
GitHub, and closes it as not planned during cleanup. The scenario is skipped
when either required environment variable is absent.

A result such as `1 skipped, 4 passed` is expected from the filtered mock
Environment and GitHub run: the four mock scenarios ran, while the protected
GitHub live scenario was discovered but skipped because mock mode was selected.

The OpenAI mock scenario connects a fake API key through the real API, confirms
the encrypted connection state survives a browser reload, disconnects it, and
confirms the disconnected state also survives a reload. It does not make a
request to OpenAI.

## Reports and debugging

The HTML report is written beside the Playwright configuration at
`apps/frontend/playwright-report/`. From the repository root, open the most
recent report with the repository script so npm uses the frontend's installed
Playwright version:

```bash
npm run show:e2e-report
```

Do not run `npx playwright show-report` from the repository root. There is no
root Playwright dependency, so `npx` may offer to download a different version.
Playwright retains traces, screenshots, and videos for failed attempts under
`apps/frontend/test-results/`. Both artifact directories are ignored by Git and
Prettier.

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
- **Docker reports that port 5432 is already allocated:** set the checkout's
  `POSTGRES_PORT` in `.env.local` to the same free port used by
  `apps/api/.env`, then rerun the prepared root command.
- **Workflow execution reports that a Pub/Sub token is required:** use the
  prepared `npm run test:e2e:mock` command so the local Pub/Sub emulator and
  E2E defaults are active.
- **Port 3999 or 4173 is already in use:** stop the existing process before
  rerunning the suite. The harness deliberately refuses to reuse another API or
  frontend process.
- **GitHub live test is skipped:** export both
  `PLAYRUNNER_E2E_GITHUB_TOKEN` and
  `PLAYRUNNER_E2E_GITHUB_REPOSITORY`, select live mode with
  `npm run test:e2e:live`, and filter with `--grep @github`.
- **No HTML report found:** run a test with the current configuration first,
  then invoke `npm run show:e2e-report` from the repository root.

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
