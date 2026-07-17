---
sidebar_position: 4
title: API Contributions
description: Contribute package-owned Express routes through the build-time integration composition.
---

# API Contributions

An API contribution exposes provider-specific HTTP endpoints, such as OAuth
token exchange, token refresh, or provider metadata requests. It is separate
from the Orchestrator contribution that executes workflow nodes.

## Declare and export the surface

Declare the API entrypoint in the package manifest and export it as a runtime
subpath:

```json
{
  "playrunner": {
    "integration": {
      "id": "example",
      "api": "./api"
    }
  },
  "exports": {
    "./api": {
      "types": "./src/api/index.ts",
      "import": "./src/api/index.ts",
      "require": "./src/api/index.ts",
      "default": "./src/api/index.ts"
    }
  }
}
```

The entrypoint must default-export an API contribution with a stable ID, an
absolute mount path, and an Express router. The SDK helper preserves that
contract while leaving the router type generic:

```ts
import { Router } from "express";
import { createApiContribution } from "@playrunner/integration-sdk/api";

const exampleRouter = Router();

exampleRouter.get("/projects", async (_req, res) => {
  res.json({ projects: [] });
});

export const exampleApiContribution = createApiContribution({
  id: "example",
  mountPath: "/api/example",
  router: exampleRouter,
});

export default exampleApiContribution;
```

With this example, the route is available at `GET /api/example/projects` after
the API starts.

## Startup validation and mounting

The API build generates static imports from the API app's installed direct
production dependencies. At startup,
`apps/api/src/integrations/package-registry.ts` checks that:

- the default export is an object;
- its ID matches `playrunner.integration.id`;
- `mountPath` begins with `/`;
- `router` is an Express router function; and
- no two contributions use the same ID or mount path.

The host then mounts each validated router with
`app.use(contribution.mountPath, contribution.router)`.

The package owns provider request and response handling inside its router. The
host continues to own application-wide middleware, startup, and the server
lifecycle. Package routes must not be used as a substitute for Orchestrator
execution or for the runner messaging transport.

## Build-time boundary

`apps/api` runs `build:integrations` during its production Docker build. That
command generates the composition and imports the package registry to validate
the contributions. The production `start:cloud` command starts the already
built selection; it does not install packages or regenerate the registry.

Local API startup also rebuilds the integration composition before starting the
watch process. Restart the API after adding or removing a package, changing an
API export, or changing its mount path. Production changes require rebuilding
and replacing the API image.
