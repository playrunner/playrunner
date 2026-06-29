---
sidebar_position: 1
title: Getting Started
---

# Getting Started with Playrunner

This tutorial walks you through setting up the complete Playrunner local development environment from scratch. By the end you'll have the local stack running, the workspace configured through the setup UI, and the product app ready for login.

**Time to complete:** ~15 minutes  
**Prerequisites:** Docker Desktop, Node.js 20+, Git

---

## Step 1 — Clone the repository

```bash
git clone https://github.com/playrunner/playrunner.git
cd playrunner
```

---

## Step 2 — Install dependencies

Install the local development dependencies from the repo root:

```bash
./install-local.sh
```

This installs the packages needed for:

- `apps/api`
- `apps/frontend`
- `apps/runners/orchestrator`
- `apps/runners/playwright`
- `docs`

`apps/setup` does not have its own `package.json`; it reuses `apps/frontend/node_modules`.

---

## Step 3 — Create the local config file

Copy the root example file so the local startup scripts have their default ports and local database settings:

```bash
cp .env.local.example .env.local
```

This step is recommended if you want to change ports before the first run. If `.env.local` is missing, `./start-local.sh` will create it from `.env.local.example` automatically. If you already have an older repo-root `.env`, `./start-local.sh` renames it to `.env.local` the next time you run it.

Edit `.env.local` before continuing if you want different local web, docs, or Postgres ports. For example, if `5432` is already in use locally, set `POSTGRES_PORT=55432` before setup. For the standard local flow, `./start-local.sh` creates and updates `apps/api/.env` for you whenever setup is active.

---

## Step 4 — Start the local stack

Start the repo-root local stack:

```bash
./start-local.sh
```

This is the main local-development entry point. On the first run it:

- starts the local Docker Postgres container
- opens setup automatically
- starts the local docs site and opens the Getting Started page

Then open the setup URL printed by the script. With defaults:

```text
http://127.0.0.1:3000/setup
```

This route is only available while startup has put the workspace into setup mode. The setup app is gated by a one-time session token and talks to the local installer through `/setup-api/*`.

On first-time setup, the local docs site also opens in the browser. With defaults:

```text
http://127.0.0.1:3004/playrunner/
```

### What the setup UI does

The setup UI is intentionally short. In the form you:

1. Confirm or replace the PostgreSQL `DATABASE_URL`.
2. Choose the first local admin username and password for the login screen.
3. Let the installer write the local database config into `apps/api/.env` and store the local login credentials in PostgreSQL.

After setup, run the normal local stack:

```bash
./start-local.sh
```

That command starts the local Postgres container, runs Prisma bootstrap, and starts the product app.

The installer writes the PostgreSQL and Prisma config into `apps/api`, including:

- `.env` updates for `DATABASE_URL` and `DIRECT_URL`
- `prisma/schema.prisma`
- `src/lib/prisma.ts`

The local admin username, password hash, and JWT secret are stored in PostgreSQL so they do not live in `apps/api/.env`.

If you need to rerun setup later:

```bash
rm apps/api/.env
./start-local.sh
```

---

## Step 5 — Start the normal app

After setup completes, stop the setup-only session and start the normal local stack:

```bash
./start-local.sh
```

This starts the product web app, API, and local docs site, and also rebuilds the local runner images needed by the editor. Later `./start-local.sh` runs keep the docs server available locally, but they do not auto-open the docs browser tab again.

---

## Step 6 — If `start-local.sh` does not get you there

Use these fallback checks before going deeper:

1. Re-run the dependency install:

   ```bash
   ./install-local.sh
   ```

2. Create the root local config file yourself if it is missing:

   ```bash
   cp .env.local.example .env.local
   ```

3. If Docker says the Postgres port is already in use, edit `.env.local` and change `POSTGRES_PORT`, then run `./start-local.sh` again.

4. If setup should reopen, delete the generated API env file and start again:

   ```bash
   rm apps/api/.env
   ./start-local.sh
   ```

5. If startup succeeds but the browser did not land on setup, open the setup URL directly. With defaults:

   ```text
   http://127.0.0.1:3000/setup
   ```

---

## Step 7 — Open the product app

Once the script output settles, open the URL printed by the script. With defaults:

```
http://127.0.0.1:3000
```

Log in with the username and password you configured in the setup wizard. You should then see the Playrunner product app and can continue into the workflow editor.

While the local stack is running, the header `Docs` link opens the local Docusaurus site instead of the live docs domain.

---

## Next steps

Now that everything is running, continue with:

➡️ [Create Your First Workflow](./create-your-first-workflow)
