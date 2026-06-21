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

### 2. Create local env files

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

### 3. Run the one-time setup flow

```bash
./start-local.sh --setup
```

Then open `http://127.0.0.1:3000/setup` and finish the setup wizard.

### 4. Start the app

```bash
./start-local.sh
```

Then open `http://127.0.0.1:3000` and log in with the username and password you created during setup.

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
