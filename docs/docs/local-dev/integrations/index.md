---
sidebar_position: 1
sidebar_label: Overview
title: Integrations
description: Build self-contained Playrunner integration packages for the frontend, API, and Orchestrator.
---

# Integration Development

Playrunner integrations are self-contained packages selected when an
application or runner artifact is built. A package can contribute to three
independent surfaces:

| Surface      | Package contribution                        | Host behavior                                      |
| ------------ | ------------------------------------------- | -------------------------------------------------- |
| Frontend     | `Integration` metadata and React components | Adds the integration to the product UI             |
| API          | An ID, mount path, and Express router       | Mounts package-owned HTTP routes                   |
| Orchestrator | Versioned node executors                    | Runs package-owned workflow actions inside the DAG |

Every surface follows the same composition rule: declare the surface in the
package's own `package.json`, export it from that package, and make it the
entrypoint's default export. The consuming artifact generates static imports
from its installed direct production dependencies. There is no common provider
list for a package author to edit.

## Build time, not workflow runtime

Installing, upgrading, or removing an integration changes the artifact and
therefore requires a rebuild. A running Playrunner deployment never invokes a
package manager, discovers new packages from `node_modules`, downloads
marketplace code, or dynamically imports an integration.

After a package has been bundled, users can connect credentials, add its node
to a workflow, connect that node to other nodes, and configure its action. Those
operations update settings and workflow data only; they do not install code.

## Development guides

- [Package architecture](./package-architecture) explains the manifest-driven
  composition model and package boundary.
- [Frontend contributions](./frontend-contributions) covers integration
  metadata, configuration UI, and the frontend SDK host.
- [API contributions](./api-contributions) covers package-owned Express routes.
- [Orchestrator contributions](./orchestrator-contributions.md) covers executable
  workflow actions and the host-owned execution lifecycle.
- [OAuth and connection development](./oauth-and-connections.md) covers
  credentials, callbacks, and connection persistence.
- [Build, validation, and deployment](./build-validation-deployment) lists the
  checks and rebuild commands for each affected artifact.

The top-level [Integration Reference](../../integration-packages/) section is
the operator and user reference for integrations currently shipped with
Playrunner. This section is for people developing integration packages and the
artifacts that consume them.
