---
sidebar_position: 7
title: Build, Validation, and Deployment
description: Validate integration packages and rebuild every frontend, API, and Orchestrator artifact they affect.
---

# Build, Validation, and Deployment

Integration installation is an artifact-build operation. Determine which
surfaces changed, select the package as a direct production dependency of each
corresponding consumer, update its lockfile, and rebuild those artifacts.

| Changed surface | Consuming artifact          | Generated composition                                               |
| --------------- | --------------------------- | ------------------------------------------------------------------- |
| Frontend        | `apps/frontend`             | `apps/frontend/src/integrations/generated-package-contributions.ts` |
| API             | `apps/api`                  | `apps/api/src/integrations/generated-package-contributions.ts`      |
| Orchestrator    | `apps/runners/orchestrator` | `apps/runners/orchestrator/src/generated/package-contributions.ts`  |

A package that declares more than one surface must be selected and rebuilt in
every affected artifact. Selecting it for the frontend does not implicitly
select it for the API or Orchestrator.

## Package checks

Run the package-local checks first:

```bash
npm --prefix packages/<integration-id> run format:check
npm --prefix packages/<integration-id> run lint
npm --prefix packages/<integration-id> run typecheck
```

Then verify the shared composition generator and each changed consumer:

```bash
node --test infra/scripts/generate-integration-composition.test.mjs

npm --prefix apps/frontend run typecheck
npm --prefix apps/frontend run build

npm --prefix apps/api run build:integrations

npm --prefix apps/runners/orchestrator test
npm --prefix apps/runners/orchestrator run build
```

When the package declares an E2E contribution, run its tagged scenarios from
the repository root:

```bash
npm run test:e2e:mock -- --grep @<integration-id>
```

The root command forwards arguments to Playwright. Keep the `--` separator
before `--grep`; without it, npm consumes the option and Playwright interprets
the tag as a test-file pattern. See [Testing](../../testing/index.md) for setup,
reports, and debugging.

Run only the consumer blocks relevant to the surfaces you changed. Finish with:

```bash
git diff --check
```

The generator fails for invalid IDs, invalid or missing runtime exports,
missing required direct dependencies, and duplicate integration IDs. The
frontend and API hosts then validate their surface-specific runtime shapes; the
Orchestrator registry validates its contract version, executor keys, actions,
and defaults.

## Local dependency and rebuild flow

After changing the selected dependency set or lockfiles, install the workspace's
local packages and app dependencies:

```bash
./install-local.sh
```

The installer discovers local packages carrying `playrunner.integration`
metadata; there is no hardcoded provider install list.

`install-local.sh` installs what each consuming app selects in its own
`package.json`; it does not automatically replace every published
`@playrunner/*` dependency with a workspace package. When testing changes across
package boundaries, use `file:` dependencies for every changed package in every
affected consumer and confirm the resulting `node_modules` entries are
symlinks.

Frontend development, builds, and typechecking generate the frontend
composition automatically. Restart the Vite process after changing the package
selection, dependency target, or export map, then hard-refresh the browser.
Local API startup runs `build:integrations`; restart the API so a changed route
selection or package API implementation is loaded. Reconnecting an OAuth
provider changes saved credentials only; it does not reload either artifact.

Orchestrator code is bundled into a Docker image. Rebuild the local image and
remove the existing container with:

```bash
./infra/scripts/rebuild-orchestrator.sh
```

The next time the editor starts a runner, the API creates a new Orchestrator
container from that image. Merely reconnecting credentials or restarting an
existing workflow does not rebuild it.

## GCP images

For a changed API surface, build, push, and redeploy the API image with:

```bash
./infra/gcp/scripts/push-runners.sh --target api --yes
```

For a changed Orchestrator contribution, build, push, and redeploy the
Orchestrator image with:

```bash
./infra/gcp/scripts/push-runners.sh --target orchestrator --yes
```

Run both commands when both surfaces changed. `--target all` rebuilds and
deploys the API and Orchestrator and also rebuilds the Playwright runner images,
so use it only when all of those artifacts are intended to change.

Frontend contributions must also be rebuilt and released through the frontend
delivery path used by the deployment. A successful package publish or API image
push does not change an already-deployed frontend bundle.

These commands are deployment operations. Review their resolved GCP project,
region, service names, and image URIs before running them against shared
environments.
