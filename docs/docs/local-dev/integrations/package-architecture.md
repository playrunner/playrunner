---
sidebar_position: 2
title: Package Architecture
description: Declare self-contained frontend, API, and Orchestrator integration surfaces through package metadata.
---

# Package Architecture

An integration owns its provider-specific code and declares its public
Playrunner surfaces in its own package manifest. It does not add imports or
provider details to a shared registry.

## Package manifest

The `playrunner.integration` object gives the package one stable integration ID
and maps each implemented surface to an exported entrypoint:

```json
{
  "name": "@playrunner/example",
  "type": "module",
  "playrunner": {
    "integration": {
      "id": "example",
      "frontend": ".",
      "api": "./api",
      "orchestrator": "./orchestrator"
    }
  },
  "exports": {
    ".": {
      "types": "./src/frontend/index.tsx",
      "import": "./src/frontend/index.tsx",
      "require": "./src/frontend/index.tsx",
      "default": "./src/frontend/index.tsx"
    },
    "./api": {
      "types": "./src/api/index.ts",
      "import": "./src/api/index.ts",
      "require": "./src/api/index.ts",
      "default": "./src/api/index.ts"
    },
    "./orchestrator": {
      "types": "./src/orchestrator/index.ts",
      "import": "./src/orchestrator/index.ts",
      "require": "./src/orchestrator/index.ts",
      "default": "./src/orchestrator/index.ts"
    }
  }
}
```

Omit a surface that the package does not implement. A surface value must be
`.` or an exact exported subpath beginning with `./`, and that export must have
a runtime target. Each declared entrypoint must default-export its contribution.
Named exports can remain available for tests and package consumers.

The integration ID must begin with a lowercase letter and can contain lowercase
letters, numbers, dots, underscores, and hyphens. The contribution exported by
each surface must use the same ID as the manifest.

## Package ownership and artifact selection

Package authors change only their package's manifest, exports, source, assets,
and tests. They do not register the provider in
`@playrunner/integration-registry` or edit a handwritten host allowlist.

The deployment or distribution build still decides which trusted package
versions are included. It adds the package to the `dependencies` or
`optionalDependencies` of every consuming artifact and commits the resulting
lockfile. For example, a package with all three surfaces must be selected by:

- `apps/frontend` for its frontend contribution;
- `apps/api` for its API contribution; and
- `apps/runners/orchestrator` for its Orchestrator contribution.

This is artifact selection, not provider registration. A package does not
become executable merely because it exists elsewhere in the repository or is a
transitive dependency.

## Static composition

`infra/scripts/generate-integration-composition.mjs` performs the same build
step for the `frontend`, `api`, and `orchestrator` surfaces:

1. Read the consuming app's direct `dependencies` and
   `optionalDependencies`. `devDependencies` and transitive dependencies are
   not candidates.
2. Locate each installed direct dependency. An absent required dependency is an
   error; an absent optional dependency is skipped.
3. Read `playrunner.integration` and ignore packages that do not declare the
   requested surface.
4. Validate the integration ID, entrypoint, and matching runtime export.
5. Reject duplicate integration IDs, sort entries by package name, and write a
   generated TypeScript module containing normal static imports.

The generated entry for a surface contains the package name, manifest ID, and
default-imported contribution. The host then validates the contribution's
runtime shape and confirms that its ID matches the manifest.

The generated modules are build output and must not be edited by hand:

```text
apps/frontend/src/integrations/generated-package-contributions.ts
apps/api/src/integrations/generated-package-contributions.ts
apps/runners/orchestrator/src/generated/package-contributions.ts
```

## Runtime boundary

Static composition means the selected code is already part of the frontend,
API image, or Orchestrator bundle before the process starts. Runtime behavior is
limited to registering and configuring that bundled code:

- the frontend presents its metadata, settings, and node configuration UI;
- the API mounts its prebuilt router during server startup; and
- the Orchestrator resolves its prebuilt executors while running the workflow.

Changing package code, package versions, manifest surfaces, or the selected
dependency set requires regenerating the composition and rebuilding every
affected artifact.

## Trust boundary

An integration selected this way is trusted application code. Its frontend and
API modules run inside their host processes, and its Orchestrator executor runs
inside the workflow engine under the capabilities exposed by the SDK. Static
composition does not sandbox an untrusted package.

Only approved package versions should become production dependencies. A future
marketplace can manage that build selection, but it must still produce and
deploy new artifacts; it cannot turn an untrusted package into runtime-loaded
code.
