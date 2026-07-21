# playrunner

[![Documentation](https://img.shields.io/badge/Docs-playrunner.dev-0F766E?style=for-the-badge&logo=docusaurus&logoColor=white)](https://playrunner.dev/docs/overview/)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/23yz25kat)
[![npm packages](https://img.shields.io/badge/npm-%40playrunner-CB3837?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/org/playrunner)

## Quick start

### Prerequisites

- Docker Desktop
- Node.js 20+
- npm

### 1. Install dependencies

```bash
./install-local.sh
```

### 2. Create the local config file

```bash
cp .env.local.example .env.local
```

This step is recommended if you want to change ports before the first run. If `.env.local` is missing, `./start-local.sh` will create it from `.env.local.example` automatically. If you already have an older repo-root `.env`, `./start-local.sh` renames it to `.env.local` the next time you run it.

Edit `.env.local` if you want different local web, docs, or Postgres ports than the defaults. For example, if `5432` is already in use locally, set `POSTGRES_PORT=55432` before setup.

### 3. Start the app

On the first run, Playrunner opens the setup app automatically. After setup is complete, the same command starts the normal local app.

```bash
./start-local.sh
```

If setup is needed, open the URL printed by the script and finish the setup wizard. With defaults, that is `http://127.0.0.1:3000/setup`. In that screen, confirm the PostgreSQL URL and create the first admin username and password.

That same command also starts the local Docusaurus site. With defaults, it is available at `http://127.0.0.1:3004/playrunner/`, and the app header's `Docs` link points there during local development.

Then open the URL printed by the script and log in with the username and password you created during setup. With defaults, that is `http://127.0.0.1:3000`.

The local docs site also starts with this command. With defaults, it is `http://127.0.0.1:3004/playrunner/`.

### Run setup again

If you need to reopen the setup wizard:

```bash
rm apps/api/.env
./start-local.sh
```

If you also want to regenerate the local port or Postgres defaults, remove `.env.local` before rerunning setup.

For more detail, see [`docs/docs/tutorials/01-getting-started.md`](docs/docs/tutorials/01-getting-started.md).

## Run only the docs site

`./start-local.sh` and `./start-local.sh --setup` already start the local Docusaurus site for you. If you only want to work on the docs site by itself:

```bash
cd docs
npm run start -- --port 3004
```

Then open `http://127.0.0.1:3004/playrunner/`.

## Package end-to-end tests

Package E2E tests run the real Vite frontend and Playrunner API against the
dedicated `playrunner_e2e` PostgreSQL schema. Complete local setup first so
`apps/api/.env` contains a working `DATABASE_URL`, and keep PostgreSQL running.
The harness starts its own API and frontend processes on ports `3999` and
`4173`; it does not reuse the normal development servers.

Install Chromium once on a new development machine:

```bash
npm exec --prefix apps/frontend -- playwright install chromium
```

Run all deterministic mock-provider scenarios:

```bash
npm run test:e2e:mock
```

Run one package by its Playwright tag:

```bash
npm run test:e2e:mock -- --grep @github
npm run test:e2e -- --grep @github
```

`npm run test:e2e` defaults to mock-provider mode. Mock mode still uses
the real Playrunner frontend, authentication, API, credential encryption, and
database; only outbound third-party provider boundaries may be faked.

Live-provider scenarios are opt-in and run with:

```bash
npm run test:e2e:live
npm run test:e2e:live -- --grep @github
```

Live scenarios require package-specific protected credentials. Packages with
no live scenario are reported as skipped. To use another PostgreSQL server,
set `PLAYRUNNER_E2E_DATABASE_URL`; the harness still isolates its tables in the
`playrunner_e2e` schema.

Open the latest HTML report from the repository root:

```bash
npx playwright show-report
```

See the [Testing guide](docs/docs/testing/index.md) for architecture,
troubleshooting, and package-authoring instructions.

## License

Playrunner is source-available under the [Playrunner Sustainable Use
License](LICENSE), copyright © 2026 Concept AI PTY LTD.

You can use and modify Playrunner for your own internal business purposes, or
for personal and other non-commercial use. You may not resell Playrunner, offer
it as a hosted or white-label service, or embed it into a commercial offering
where a material part of the value comes from Playrunner itself without
separate written permission.

This is not an OSI-approved open source license. See [`LICENSE`](LICENSE) for
the full terms.
