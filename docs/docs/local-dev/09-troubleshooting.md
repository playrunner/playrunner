---
sidebar_position: 9
title: Troubleshooting
---

# Troubleshooting

> **Local development only.** Common issues and how to resolve them.

---

## Orchestrator won't start

**Symptom:** The API terminal shows an error from `docker run`, or the Editor shows "Runner is not running."

**Causes & fixes:**

1. **The `playrunner-orchestrator` image hasn't been built.**
   ```bash
   docker build -t playrunner-orchestrator ./apps/runners/orchestrator
   ```

2. **Port 3002 is already in use.**
   Find and kill the process using the port:
   ```bash
   lsof -i :3002
   kill -9 <PID>
   ```

3. **Docker socket permission issue.**
   On Linux, the API process may not have permission to access `/var/run/docker.sock`. Add your user to the `docker` group:
   ```bash
   sudo usermod -aG docker $USER
   ```

---

## Pub/Sub messages not appearing in the log panel

**Symptom:** Workflows run but no log messages appear in the editor's log panel.

**Causes & fixes:**

1. **PostgreSQL is not running or `DATABASE_URL` is wrong.**
   ```bash
   docker compose up -d postgres
   docker ps  # confirm postgres is up
   ```

2. **`DATABASE_URL` is missing in the API's environment.**
   Confirm `apps/api/.env` contains:
   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/playrunner?schema=public
   ```
   Restart the API after changing `.env`.

3. **No editor presence SSE client connected.**  
   The Orchestrator only stays alive while at least one browser tab has the Editor open and subscribed to `GET /api/presence/stream`. Check the API terminal for "Editor presence SSE connected" messages.

---

## Playwright tests fail with "git clone failed"

**Symptom:** The log panel shows a clone error.

**Causes & fixes:**

1. **GitHub token missing or not injected.**
   - Confirm the GitHub integration is connected in the app's Integrations page.
   - The Orchestrator logs a warning: `[Orchestrator WARNING] No GitHub accessToken found in settings`
   - Token auto-refresh happens via `/api/github/refresh`. Check the API terminal for any refresh errors.

2. **Repository name is wrong.**  
   The `repository` field must be `owner/repo` (e.g. `myorg/my-tests`), not a full URL.

3. **Branch doesn't exist.**  
   Confirm the branch name in the node config matches an existing branch in the repo.

---

## `host.docker.internal` not resolving inside containers

**Symptom:** Containers can't reach the API; connection refused errors.

**Fix (Linux only):**
Docker Desktop on Mac/Windows provides `host.docker.internal` automatically. On Linux, pass the flag when running containers:

```bash
docker run --add-host host.docker.internal:host-gateway ...
```

For the Orchestrator (spawned by the API), you would need to modify `apps/api/src/routes/runners.ts` to add this flag to the `docker run` arguments.

---

## Web App changes not reflected

**Symptom:** After editing source files, the browser doesn't update.

The Vite dev server uses HMR (Hot Module Replacement) by default. If HMR is disabled (`DISABLE_HMR=true`), you'll need to manually refresh the browser.

Check whether HMR is disabled:
```bash
echo $DISABLE_HMR
```

---

## API fails to start with "Cannot find module"

**Symptom:** The API crashes on startup with a module-not-found error.

```bash
cd apps/api && npm install
```

---

## `concurrently` not found

**Symptom:** `start-local.sh` fails with `command not found: concurrently`.

The script auto-installs it, but if that fails:

```bash
npm install -g concurrently
```

---

## Viewing Orchestrator and Playwright Logs

The Orchestrator container inherits the API process's stdio (`stdio: 'inherit'`), so its logs appear directly in the `API` terminal pane.

To view Playwright runner container logs as they run:

```bash
# List running containers
docker ps

# Tail logs for a specific container
docker logs -f <container-id>
```

---

## Rebuilding After Code Changes

| Changed code location | Action required |
|---|---|
| `apps/api/src/**` | Restart the API (`Ctrl+C` then re-run `start-local.sh` or `npm start`) |
| `apps/frontend/src/**` | Vite HMR handles this automatically |
| `apps/runners/orchestrator/src/**` | `docker build -t playrunner-orchestrator ./apps/runners/orchestrator`, then reopen the Editor tab |
| `apps/runners/playwright/src/**` | Rebuild the configured Playwright runner images, for example via `./start-local.sh` |
