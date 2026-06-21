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
