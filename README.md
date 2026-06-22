# playrunner

## Quick start

### Prerequisites

- Docker Desktop
- Node.js 18+
- npm

### 1. Install dependencies

```bash
./install-local.sh
```

### 2. Create the local config file

```bash
cp .env.example .env
```

This step is recommended if you want to change ports before the first run. If `.env` is missing, `./start-local.sh` will create it from `.env.example` automatically.

Edit `.env` if you want a different local web port or Postgres port than the defaults. For example, if `5432` is already in use locally, set `POSTGRES_PORT=55432` before setup.

### 3. Run the one-time setup flow

```bash
./start-local.sh --setup
```

Then open the URL printed by the script and finish the setup wizard. With defaults, that is `http://127.0.0.1:3000/setup`.

### 4. Start the app

```bash
./start-local.sh
```

Then open the URL printed by the script and log in with the username and password you created during setup. With defaults, that is `http://127.0.0.1:3000`.

### Run setup again

If you need to reopen the setup wizard:

```bash
rm setup/installer/.setup-state.json
./start-local.sh --setup
```

For more detail, see [`docs/docs/tutorials/01-getting-started.md`](docs/docs/tutorials/01-getting-started.md).

## Run the docs site

The Docusaurus docs live in `docs/`. They use their own dependencies and are
not installed by `./install-local.sh`.

```bash
cd docs
npm ci
npm run start -- --port 3004
```

Then open `http://127.0.0.1:3004/playrunner/docs/`.

The docs workspace currently requires Node.js 20+.

## License

Playrunner is source-available under the [Playrunner Sustainable Use
License](LICENSE), copyright © 2026 Concept AI PTY LTD.

You can use and modify Playrunner for your own internal business purposes, or
for personal and other non-commercial use. You may not resell Playrunner, offer
it as a hosted or white-label service, or embed it into a commercial offering
where a material part of the value comes from Playrunner itself without
separate written permission.

This is not an OSI-approved open source license. See
[`LICENSE`](LICENSE) and [`docs/docs/legal/license.md`](docs/docs/legal/license.md)
for the full terms.
