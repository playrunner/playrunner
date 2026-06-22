# playrunner

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

### 3. Run the one-time setup flow

```bash
./start-local.sh --setup
```

Then open the URL printed by the script and finish the setup wizard. With defaults, that is `http://127.0.0.1:3000/setup`.

That same command also starts the local Docusaurus site. With defaults, it is available at `http://127.0.0.1:3004/playrunner/`, and the app header's `Docs` link points there during local development.

### 4. Start the app

```bash
./start-local.sh
```

Then open the URL printed by the script and log in with the username and password you created during setup. With defaults, that is `http://127.0.0.1:3000`.

The local docs site also starts with this command. With defaults, it is `http://127.0.0.1:3004/playrunner/`.

### Run setup again

If you need to reopen the setup wizard:

```bash
rm setup/installer/.setup-state.json
./start-local.sh --setup
```

For more detail, see [`docs/docs/tutorials/01-getting-started.md`](docs/docs/tutorials/01-getting-started.md).

## Run only the docs site

`./start-local.sh` and `./start-local.sh --setup` already start the local Docusaurus site for you. If you only want to work on the docs site by itself:

```bash
cd docs
npm run start -- --port 3004
```

Then open `http://127.0.0.1:3004/playrunner/`.

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
