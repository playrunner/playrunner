---
sidebar_position: 1
title: Getting Started
---

# Getting Started with Playrunner

This tutorial walks you through setting up the complete Playrunner local development environment from scratch. By the end you'll have the local stack running, the workspace configured through the setup UI, and the product app ready for login.

**Time to complete:** ~15 minutes  
**Prerequisites:** Docker Desktop, Node.js 18+, Git

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
- `apps/web`
- `apps/runners/orchestrator`
- `apps/runners/playwright`

`apps/setup` does not have its own `package.json`; it reuses `apps/frontend/node_modules`.

---

## Step 3 — Create the local env files

Copy the example files so the local dev servers have their default ports and proxy targets:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/frontend/.env.example apps/frontend/.env
```

For local development, these files are mostly transport and proxy configuration. The actual database and local login credentials are configured through the dedicated setup UI.

---

## Step 4 — Run the one-time setup flow

Start an explicit setup session from the repo root:

```bash
./start-local.sh --setup
```

Then open:

```text
http://127.0.0.1:3000/setup
```

This route is only available during an explicit setup run. The setup app is gated by a one-time session token and talks to the local installer through `/setup-api/*`.

### What the setup UI does

The current wizard is built around PostgreSQL and Prisma. In the UI you:

1. Paste the Prisma `DATABASE_URL` and any optional direct or shadow database URLs.
2. Choose the local username and password that should be accepted by the login screen.
3. Let the installer write the PostgreSQL and auth environment variables into `apps/api/.env`.
4. Generate the Prisma scaffold for the API package.
5. Complete setup, which permanently closes the installer for that workspace.

After setup, run the normal local stack:

```bash
./start-local.sh
```

That command now starts the local Postgres container and runs Prisma bootstrap before the API server comes online.

The installer writes the PostgreSQL and Prisma config into `apps/api`, including:

- `.env` updates for `DATABASE_URL`, `DIRECT_URL`, and `SHADOW_DATABASE_URL`
- `.env` updates for `LOCAL_AUTH_USERNAME`, `LOCAL_AUTH_PASSWORD_HASH`, and `AUTH_JWT_SECRET`
- `prisma/schema.prisma`
- `src/lib/prisma.ts`

---

## Step 5 — Start the normal app

After setup completes, stop the setup-only session and start the normal local stack:

```bash
./start-local.sh
```

This starts the product web app and API, and also rebuilds the local runner images needed by the editor.

---

## Step 6 — Open the product app

Once the script output settles, open:

```
http://localhost:3000
```

Log in with the username and password you configured in the setup wizard. You should then see the Playrunner product app and can continue into the workflow editor.

---

## Next steps

Now that everything is running, continue with:

➡️ [Create Your First Workflow](./02-create-your-first-workflow)
