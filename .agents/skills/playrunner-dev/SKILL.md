---
name: playrunner-dev
description: Development rules for working in the Playrunner repo, including integration package development under packages/*. Use whenever making code changes in this repository to govern package structure, documentation boundaries, verification, and operational handoff.
---

# Playrunner Dev

## Overview

Rules that govern day-to-day code changes in the Playrunner repo, separate from styling/design concerns. Apply these to any code edit, regardless of language or app.

## Rules

- When making a change to code, do not update the docs as part of that change. Wait until the user explicitly asks for the docs to be updated.
- When you finish the current code block of work, ask the user whether they have tested the change and are happy with it, and offer to update the docs once they confirm.
- Do not deploy, push container images, run Terraform apply, delete/recreate cloud resources, consume Pub/Sub messages, or otherwise mutate live cloud state unless the user has explicitly asked for that exact action or has confirmed a direct deployment/mutation prompt. Local builds, lint, typecheck, and read-only cloud inspection are acceptable.
- For cloud runtime fixes, stop after implementing and locally verifying the code. Tell the user the exact deploy command separately and ask whether they want it run.
- For GCP workflow, Cloud Run, orchestrator, or Playwright runner fixes, close out with the operational handoff the user needs to test the change: tell them to restart the local API so package/API runtime changes are loaded, tell them to try the workflow again in the editor, and state whether pushed runner images are needed. If pushed images are needed, give the exact command without running it unless the user confirms: `./infra/gcp/scripts/push-runners.sh --target orchestrator --yes` for orchestrator-only changes, `./infra/gcp/scripts/push-runners.sh --target playwright --yes` for Playwright runner image changes, or `./infra/gcp/scripts/push-runners.sh --target both --yes` when both images changed.
- Do not duplicate local-runner and cloud-runner protocol code. When local and GCP share behaviour such as Pub/Sub event transport, runner control/status signalling, node state transitions, or output-event publication, implement the shared protocol once and vary only the environment/configuration needed by each runtime.
- Do not send runner messages through API event callbacks. Logs, node state, runner control/status, and output events must go through the runner's messaging transport: local development defaults to the Pub/Sub emulator, GCP uses GCP Pub/Sub, and future AWS/Azure runners should use their provider-native messaging.

## Package Development

When building or extending packages under `packages/*`, follow the package shape already implemented by `packages/playwright`, `packages/gcp`, `packages/jira`, `packages/environment`, and `packages/github`.

- Use a publishable scoped package named `@playrunner/<id>` with `type: "module"`, the repo license reference, the existing author value, `files`, and the current `publishConfig` pattern. Do not change package publishing visibility unless the user explicitly asks.
- Expose the same subpath contract: `.` and `./frontend` point at `src/frontend/index.tsx`, `./api` points at `src/api/index.ts`, provider-owned assets are exported from `./assets/<name>.svg`, and runtime packages such as GCP add `./api-runtime`.
- Include `import`, `require`, `default`, and `types` export conditions for TypeScript source subpaths. The API app can fail under `tsx` when a package only exposes `import`.
- Keep the package layout consistent: `package.json`, `tsconfig.json`, package-local `.prettierrc.json`, `eslint.config.mjs`, `src/frontend/index.tsx`, `src/api/index.ts`, optional `src/api-runtime`, package-owned `assets/`, and any settings/config/token-refresh modules owned by the package.
- Add package-local scripts for `lint`, `lint:fix`, `format`, `format:check`, and `typecheck`; do not rely only on root tooling.
- Match the package TypeScript baseline: ES2022 target, ESNext module, Bundler module resolution, `jsx: "react-jsx"`, strict mode, declarations, no emit, and local `paths` for `@playrunner/integration-sdk` plus sibling package imports.
- Match the package ESLint/Prettier baseline from the implemented packages: React version `19.0`, frontend/browser rules for `src/frontend`, node rules for `src/api` and `src/api-runtime`, explicit `react-refresh/only-export-components` allowlists for exported package symbols, and Prettier-compatible lint config.
- Use `@playrunner/integration-sdk` as the frontend boundary. Package UI should get auth, store, and UI primitives through `useIntegrationHost` and shared SDK helpers, not imports from `apps/frontend/src`.
- In provider connection or settings dialogs, render manual credential/config fields with `IntegrationConnectionInput` and include `IntegrationConnectionAutofillGuard` for custom modals. Do not use raw `Input` for Client ID, Client Secret, API key, token, project, or region fields in connection dialogs, and do not give those inputs credential-like `name` or `id` values such as `client-secret`, `password`, `token`, or `username`.
- Keep provider setup inside package-owned settings/config components, and use the shared integration persistence model through the SDK host. OAuth-capable providers should prefer OAuth; webhooks are secondary unless the package is explicitly the generic Webhooks integration.
- Export an integration object from `src/frontend/index.tsx` with the existing `Integration` contract. Preserve established ids unless the user asks to rename them; for example, `@playrunner/playwright` uses id `playwright`, GitHub uses `github`, and Environment uses `environment`.
- Export an API contribution from `src/api/index.ts` with a stable `id`, `mountPath`, and Express router, then wire it through `packages/integration-registry/src/api/index.ts` when it must be registered by the API app.
- Add frontend registry wiring through `packages/integration-registry/src/frontend/index.ts` when the integration should be active in the product. Keep marketplace/optional integrations out of the active array unless that is part of the request.
- Add the package as a `file:` dependency in the consuming app package manifests and update Vite/TS aliases when local app development needs to resolve package source directly.
- Update `install-local.sh` and `start-local.sh` whenever the new package must participate in local install, lint, typecheck, or startup checks.
- Prefer package-owned SVG/logo assets for integrations that need brand media. Follow the implemented asset export pattern instead of depending only on duplicated app public assets.
- If docs are explicitly in scope, update `docs/docs/integration-packages` and its index to match the implemented packages. Otherwise, leave docs unchanged and mention them as a follow-up per the repo docs rule above.
- Verify package work with the narrowest relevant bundle: package `typecheck`, package `lint`, targeted `format:check` or Prettier on touched files, frontend typecheck/build when registry or UI changes, API import/runtime checks when API routes or `api-runtime` exports change, and `git diff --check`.
