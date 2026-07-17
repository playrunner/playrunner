---
sidebar_position: 5
sidebar_label: GCP
title: GCP Integration
description: Connect Google Cloud credentials and register GCP runner infrastructure for Playrunner workflows.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="GCP"
packageName="@playrunner/gcp"
description="Connect Google Cloud credentials, configure Cloud Run runner images, and register package-owned GCP workflow runtime backends."
icon="gcp"
installCommand="npm install @playrunner/gcp"
npmUrl="https://www.npmjs.com/package/@playrunner/gcp"
badges={['OAuth', 'Cloud Run', 'GCS', 'Pub/Sub']}
facts={[
{ label: 'Credential path', value: 'users/{uid}/cloud_credentials/gcp' },
{ label: 'Backend mount', value: '/api/gcp' },
{ label: 'Runtime provider', value: 'GCP' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Cloud credential settings">
    Exports `gcpIntegration`, `gcpCloudProvider`, and `GcpSettingsModal`.
    The modal writes OAuth tokens, selected project, Cloud Run region, runner
    defaults, and generated image URI templates to the shared cloud credential
    store.
  </IntegrationCard>

  <IntegrationCard eyebrow="Backend" title="OAuth proxy routes">
    Default-exports `gcpApiContribution`, discovered by the API build and
    mounted at `/api/gcp`, for Google OAuth token exchange and refresh calls.
  </IntegrationCard>

  <IntegrationCard eyebrow="Runtime" title="Runner contribution">
    Exports `createGcpApiRuntimeContribution`, which registers the GCP cloud
    provider, Cloud Run workflow execution backend, GCS output proxy/sync, and
    the shared Pub/Sub event-stream manager.
  </IntegrationCard>

  <IntegrationCard eyebrow="Assets" title="Package-owned icon">
    The GCP SVG lives inside the package and the frontend resolves it from the
    package asset export.
  </IntegrationCard>
</IntegrationGrid>

## Exports

```ts
import gcpIntegration, {
  gcpCloudProvider,
  GcpSettingsModal,
} from "@playrunner/gcp";
import gcpApiContribution, { gcpRouter } from "@playrunner/gcp/api";
import {
  createGcpApiRuntimeContribution,
  createGcpPubSubEventStreamManager,
} from "@playrunner/gcp/api-runtime";
```

## Frontend

The frontend entrypoint uses `@playrunner/integration-sdk` for host-provided
auth, cloud credential persistence, and UI primitives. The GCP package declares
its `.` frontend and `./api` surfaces under `playrunner.integration` and
default-exports each contribution. Frontend and API builds discover those
surfaces from installed direct production dependencies and generate static
imports; there is no shared provider registry to update. The frontend edition
module separately imports `gcpCloudProvider` for runner selection. The API host
imports the package's `./api-runtime` surface directly at build time and applies
that contribution during API startup; it is not part of the manifest-generated
frontend/API composition.

## API Runtime

The `./api-runtime` surface is bundled into the API artifact through an explicit
host import. It is never installed or discovered while the API or a workflow is
running.

The API owns persistence, auth, and in-memory execution state. The GCP package
owns GCP-specific behavior and receives those host dependencies through
constructor arguments:

- `executionEvents` for PostgreSQL-backed execution event persistence
- `state` for per-run GCP credentials, bucket names, and cloud provider lookup
- `logTransport` for workflow log publication
- `pubSubEventStreamManager` for local emulator and managed GCP Pub/Sub event ingest

Local and GCP workflow execution both use the same Pub/Sub manager from this
package; the local path changes only by setting `PUBSUB_EMULATOR_HOST`.

The managed GCP path keeps PostgreSQL as the workflow trace source of truth. The
API runtime creates an execution-scoped filtered Pub/Sub subscription, pulls
messages without Pub/Sub long-poll blocking, verifies each execution token,
persists accepted events, and then streams them to the editor with SSE. The
frontend log panel sorts displayed messages by event timestamp so API-side setup
logs and cloud-published runner logs remain chronological.

The API runtime also reconciles the Orchestrator Cloud Run Service before each
run. It keeps at least one warm service instance and sets the container resource
policy to always-allocated CPU so the orchestrator can continue the background
DAG run after `/execute` has returned. The service name, min/max instances, and
CPU idle policy are stored with the GCP integration credential and reused by both
`push-runners.sh` and the runtime reconciliation path.

Playwright runner preparation is split from execution. The Orchestrator schedules
Cloud Run Job preparation in the background, leaves Playwright nodes in
`pending`, and sends `runner_control=start` only when DAG traversal reaches the
node. The runner publishes `running` after it receives that start signal.

## Assets

The GCP SVG lives inside the package at `packages/gcp/assets/gcp.svg`.
