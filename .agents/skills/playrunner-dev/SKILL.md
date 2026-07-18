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

## Documentation and Code Snippets

- Format every fenced executable code example with the repository Prettier baseline in `docs/.prettierrc.json`: `semi: true`, `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 80`, and `tabWidth: 2`.
- Keep every code example syntactically valid for its declared language. JSON examples must remain valid JSON and therefore use double-quoted property names and string values even though JavaScript and TypeScript examples use single quotes.
- Add an appropriate language tag to every fenced code block, such as `ts`, `tsx`, `json`, `bash`, or `yaml`.
- Do not use Markdown emphasis markers around language keywords or other source tokens inside code examples. Code fences must contain plain, executable source text.
- Validate changed documentation and its snippets with the narrowest relevant Markdown, documentation-build, and Prettier checks before handing the work back.

## Package Development

When building or extending packages under `packages/*`, follow the package shape already implemented by `packages/playwright`, `packages/gcp`, `packages/jira`, `packages/environment`, and `packages/github`.

- Use a publishable scoped package named `@playrunner/<id>` with `type: "module"`, the repo license reference, the existing author value, `files`, and the current `publishConfig` pattern. Do not change package publishing visibility unless the user explicitly asks.
- Declare a package-owned `playrunner.integration` object in `package.json` with a stable `id` and an entrypoint for every surface the package supplies: `frontend`, `api`, and/or `orchestrator`. Each entrypoint must name a matching package export. Adding or changing an integration must be self-contained in its own package; do not add provider-specific imports, ids, or contribution lists to a shared registry.
- Expose the declared surface subpaths: `.` and `./frontend` point at `src/frontend/index.tsx`, `./api` points at `src/api/index.ts`, and `./orchestrator` points at `src/orchestrator/index.ts`. Provider-owned assets are exported from `./assets/<name>.svg`, and runtime packages such as GCP may add package-specific subpaths such as `./api-runtime`.
- Include `import`, `require`, `default`, and `types` export conditions for TypeScript source subpaths. The API app can fail under `tsx` when a package only exposes `import`.
- Keep the package layout consistent: `package.json`, `tsconfig.json`, package-local `.prettierrc.json`, `eslint.config.mjs`, declared surface entrypoints under `src/frontend/index.tsx`, `src/api/index.ts`, and optionally `src/orchestrator/index.ts`, optional package-specific runtime code such as `src/api-runtime`, package-owned `assets/`, and any settings/config/token-refresh modules owned by the package.
- Add package-local scripts for `lint`, `lint:fix`, `format`, `format:check`, and `typecheck`; do not rely only on root tooling.
- Match the package TypeScript baseline: ES2022 target, ESNext module, Bundler module resolution, `jsx: "react-jsx"`, strict mode, declarations, no emit, and local `paths` for `@playrunner/integration-sdk` plus sibling package imports.
- Match the package ESLint/Prettier baseline from the implemented packages: React version `19.0`, frontend/browser rules for `src/frontend`, node rules for `src/api`, `src/orchestrator`, and package-specific runtimes such as `src/api-runtime`, explicit `react-refresh/only-export-components` allowlists for exported package symbols, and Prettier-compatible lint config.
- Use `@playrunner/integration-sdk` as the frontend boundary. Package UI should get auth, store, and UI primitives through `useIntegrationHost` and shared SDK helpers, not imports from `apps/frontend/src`.
- In provider connection or settings dialogs, render manual credential/config fields with `IntegrationConnectionInput` and include `IntegrationConnectionAutofillGuard` for custom modals. Do not use raw `Input` for Client ID, Client Secret, API key, token, project, or region fields in connection dialogs, and do not give those inputs credential-like `name` or `id` values such as `client-secret`, `password`, `token`, or `username`.
- Keep provider setup inside package-owned settings/config components, and use the shared integration persistence model through the SDK host. OAuth-capable providers should prefer OAuth; webhooks are secondary unless the package is explicitly the generic Webhooks integration.
- Default-export the frontend integration object from `src/frontend/index.tsx` using the existing `Integration` contract. Preserve established ids unless the user asks to rename them; for example, `@playrunner/playwright` uses id `playwright`, GitHub uses `github`, and Environment uses `environment`.
- Default-export the API contribution from `src/api/index.ts` with a stable `id`, `mountPath`, and Express router.
- When a package owns workflow execution, default-export its `OrchestratorIntegrationContribution` from `src/orchestrator/index.ts` using the versioned `@playrunner/integration-sdk/orchestrator` contract. Keep scheduling, lifecycle, state, transport, timeouts, cancellation, and cleanup in the orchestrator host.
- Select a package for a surface by adding its published npm version as a direct production `dependency` or `optionalDependency` of the consuming frontend, API, or orchestrator app. Do not rely on a transitive or development dependency, and do not add provider-specific Vite or TypeScript aliases. Use a local `file:` dependency only as an explicit package-development override, with symlink preservation where required.
- Let each consuming app generate its static contribution imports from installed direct dependencies at build time with `infra/scripts/generate-integration-composition.mjs`. Do not install packages, discover providers, or modify contribution composition at workflow runtime. The orchestrator host owns provider-agnostic contribution validation and executor resolution in `apps/runners/orchestrator/src/runtime/orchestrator-registry.ts`.
- `install-local.sh` discovers package directories dynamically from `playrunner.integration` metadata. Do not add new integration package names to a handwritten install list or update `start-local.sh` merely to register a provider; change those scripts only when their generic install/start behaviour itself must change.
- Prefer package-owned SVG/logo assets for integrations that need brand media. Follow the implemented asset export pattern instead of depending only on duplicated app public assets.
- If docs are explicitly in scope, update the provider reference under `docs/docs/integration-packages` and the package-authoring guidance under `docs/docs/local-dev/integrations` as applicable. Otherwise, leave docs unchanged and mention them as a follow-up per the repo docs rule above.
- Verify package work with the narrowest relevant bundle: package `typecheck`, package `lint`, targeted `format:check` or Prettier on touched files, frontend typecheck/build when generated composition or UI changes, API import/runtime checks when API routes or `api-runtime` exports change, orchestrator typecheck/build when orchestrator contributions change, and `git diff --check`.
