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
    The modal writes selected project, OAuth tokens, Cloud Run region, and image
    URI templates to the shared cloud credential store.
  </IntegrationCard>

  <IntegrationCard eyebrow="Backend" title="OAuth proxy routes">
    Exports `gcpApiContribution`, mounted by the package registry at `/api/gcp`,
    for Google OAuth token exchange and refresh calls.
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
import {
  gcpCloudProvider,
  gcpIntegration,
  GcpSettingsModal,
} from "@playrunner/gcp";
import { gcpApiContribution, gcpRouter } from "@playrunner/gcp/api";
import {
  createGcpApiRuntimeContribution,
  createGcpPubSubEventStreamManager,
} from "@playrunner/gcp/api-runtime";
```

## Frontend

The frontend entrypoint uses `@playrunner/integration-sdk` for host-provided
auth, cloud credential persistence, and UI primitives. The host app registers
the integration through `@playrunner/integration-registry` and exposes the GCP
runner through the edition runtime.

## API Runtime

The API owns persistence, auth, and in-memory execution state. The GCP package
owns GCP-specific behavior and receives those host dependencies through
constructor arguments:

- `executionEvents` for PostgreSQL-backed execution event persistence
- `state` for per-run GCP credentials, bucket names, and cloud provider lookup
- `logTransport` for workflow log publication
- `pubSubEventStreamManager` for local emulator and managed GCP Pub/Sub event ingest

Local and GCP workflow execution both use the same Pub/Sub manager from this
package; the local path changes only by setting `PUBSUB_EMULATOR_HOST`.

## Assets

The GCP SVG lives inside the package at `packages/gcp/assets/gcp.svg`.
