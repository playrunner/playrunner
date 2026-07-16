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
   ./infra/scripts/rebuild-orchestrator.sh
   ```

   The helper uses the repository root as the Docker build context so local
   integration packages and the static executor registry can be bundled. The
   equivalent image-only command is:

   ```bash
   docker build \
     --build-arg BASE_PATH=. \
     -f apps/runners/orchestrator/Dockerfile \
     -t playrunner-orchestrator \
     .
   ```

2. **Port 3012 is already in use.**
   Find and kill the process using the port:

   ```bash
   lsof -i :3012
   kill -9 <PID>
   ```

3. **A stale Orchestrator container is answering `/health`.**
   Current local runners also expose `/runtime` with Pub/Sub metadata. Check it:

   ```bash
   curl http://localhost:3012/runtime
   ```

   If it returns `404` or does not show `"runnerControl":"pubsub"`, reopen the
   editor or call `/api/runners/start`. The API should stop the stale container
   bound to port `3012` and start a fresh `playrunner-orchestrator-local`
   container. You can also stop it manually:

   ```bash
   docker ps --filter publish=3012
   docker stop <container-id>
   ```

   If the Pub/Sub fields are current but `orchestratorContributions` is missing
   or incomplete, rebuild with `./infra/scripts/rebuild-orchestrator.sh`. That
   helper removes the running container; reopen the Editor tab to start the new
   image.

4. **Docker socket permission issue.**
   On Linux, the API process may not have permission to access `/var/run/docker.sock`. Add your user to the `docker` group:
   ```bash
   sudo usermod -aG docker $USER
   ```

---

## Workflow start returns `500` with a local Pub/Sub fetch error

**Symptom:** The browser console reports `POST /api/workflows/start 500`, and
the response or Editor error contains:

```text
Failed to configure local Pub/Sub event transport: fetch failed
```

This error occurs before the workflow is sent to the Orchestrator. The API
cannot create the execution topic/subscription through the host-facing Pub/Sub
emulator endpoint, even if the Compose container appears to be running.

The default port boundary is:

- API on the host: `127.0.0.1:8084`
- Docker Compose host mapping: `8084:8085`
- Pub/Sub emulator inside its container: `0.0.0.0:8085`
- Orchestrator and Playwright containers: `host.docker.internal:8084`

Check the exact endpoint used by the host API:

```bash
curl --fail http://127.0.0.1:8084/v1/projects/playrunner-local/topics
```

For a healthy emulator, this returns HTTP `200`; a newly created emulator with
no topics returns `{}`. If the request fails, recreate the Pub/Sub service so
the current internal listener and port mapping are applied:

```bash
docker compose up -d --force-recreate pubsub
curl --fail http://127.0.0.1:8084/v1/projects/playrunner-local/topics
```

If you changed `PUBSUB_EMULATOR_PORT` or `LOCAL_PUBSUB_PROJECT_ID` in
`.env.local`, rerun `./start-local.sh` so those values are exported before
Compose starts the service, and substitute them in the check. Restart the API
after any `.env.local` change, then try the workflow again.

---

## Workflow reports an executor is not installed or registered

**Symptom:** The workflow event stream reports an error beginning with:

```text
Orchestrator executor not installed/registered for node type ...
```

The Orchestrator never downloads marketplace code at runtime. It can only run
package executors present in the static registry bundled into its image. Inspect
the running image's registered contributions and actions:

```bash
curl http://localhost:3012/runtime
```

Check `orchestratorContributions` for the node's exact persisted `nodeType` and
optional `config.action`. Resolution does not use the display label. If the
source registry is correct but the contribution is missing from `/runtime`, the
running image is stale:

```bash
./infra/scripts/rebuild-orchestrator.sh
```

Reopen the Editor tab to start a fresh local container, then retry the workflow.
For a GCP Orchestrator, rebuild, push, and redeploy the Orchestrator-only image:

```bash
./infra/gcp/scripts/push-runners.sh --target orchestrator --yes
```

---

## Execution log messages not appearing in the log panel

**Symptom:** Workflows run but no log messages appear in the editor's log panel.

**Causes & fixes:**

1. **PostgreSQL is not running or `DATABASE_URL` is wrong.**

   ```bash
   docker compose up -d postgres pubsub
   docker ps  # confirm postgres and pubsub are up
   ```

2. **`DATABASE_URL` is missing in the API's environment.**
   Confirm `apps/api/.env` contains:

   ```
   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<POSTGRES_PORT>/playrunner?schema=public
   ```

   If you changed the local Postgres port, confirm the repo-root `.env.local` matches it as well. Restart the API after changing `.env.local`.

3. **The API cannot pull execution events from the Pub/Sub emulator.**
   Confirm `PUBSUB_EMULATOR_HOST` points to the emulator from the host, usually `127.0.0.1:8084`, and that `PUBSUB_EMULATOR_HOST_DOCKER` points to the same emulator from inside Docker, usually `host.docker.internal:8084` on Docker Desktop. Restart the API and Orchestrator after changing these values.

---

## Postgres port 5432 is already allocated

**Symptom:** `./start-local.sh` or `./start-local.sh --setup` fails with a Docker error saying the bind for `0.0.0.0:5432` failed because the port is already allocated.

**Fix:**

1. Edit the repo-root `.env.local`.
2. Set `POSTGRES_PORT` to an available local port:
   ```dotenv
   POSTGRES_PORT=<free-local-port>
   ```
3. Re-run `./start-local.sh --setup` or `./start-local.sh`.

The setup wizard default database URL and the Docker Postgres bind will both follow the new `POSTGRES_PORT` value automatically.

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

For the Orchestrator (spawned by the API), you would need to modify `apps/api/src/runtime/orchestrator-runner.ts` to add this flag to the `docker run` arguments.

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

| Changed code location                                                                | Action required                                                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `apps/api/src/**`                                                                    | Restart the API (`Ctrl+C` then re-run `start-local.sh` or `npm start`)              |
| `apps/frontend/src/**`                                                               | Vite HMR handles this automatically                                                 |
| `apps/runners/orchestrator/src/**`                                                   | Run `./infra/scripts/rebuild-orchestrator.sh`, then reopen the Editor tab           |
| `packages/*/src/orchestrator/**` or `packages/integration-registry/src/orchestrator` | Run `./infra/scripts/rebuild-orchestrator.sh`, then reopen the Editor tab           |
| `apps/runners/playwright/src/**`                                                     | Rebuild the configured Playwright runner images, for example via `./start-local.sh` |
