---
sidebar_position: 12
sidebar_label: Webhooks
title: Webhooks Integration
description: Receive inbound workflow triggers and send outbound HTTPS requests.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="Webhooks"
packageName="@playrunner/webhooks"
description="Receive external events as workflow triggers or send templated HTTPS requests from a workflow."
icon="webhooks"
installCommand="npm install @playrunner/webhooks"
npmUrl="https://www.npmjs.com/package/@playrunner/webhooks"
badges={['Inbound triggers', 'Outbound requests', 'Opt-in tunnel']}
facts={[
{ label: 'Node type', value: 'Trigger or action' },
{ label: 'Integration id', value: 'webhooks' },
{ label: 'Backend mount', value: '/api/webhooks' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Inbound" title="Secret workflow endpoints">
    Create, rotate, disable, and copy a unique endpoint for each saved Webhooks
    node.
  </IntegrationCard>

  <IntegrationCard eyebrow="Public access" title="Explicit exposure">
    Keep endpoints local, provide an existing public HTTPS URL, or explicitly
    start a temporary Cloudflare quick tunnel.
  </IntegrationCard>

  <IntegrationCard eyebrow="Outbound" title="Templated HTTPS requests">
    Configure the method, headers, body, bearer token, and retry count for a
    public HTTPS target.
  </IntegrationCard>

  <IntegrationCard eyebrow="Runtime" title="Three package surfaces">
    The package contributes its node UI, authenticated and public API routes,
    and the trusted Orchestrator executor.
  </IntegrationCard>
</IntegrationGrid>

## Setup

```bash
npm install @playrunner/webhooks
```

The frontend, API, and Orchestrator applications must include the package as a
direct production dependency because all three consume a declared contribution
surface.

## Receive an inbound webhook

1. Add a **Webhooks** node to a workflow.
2. Select **Receive an inbound trigger**.
3. Save the workflow.
4. Select **Create endpoint**.
5. Copy the local or public endpoint URL.

Send a JSON request to the generated URL:

```bash
curl --request POST \
  --header 'content-type: application/json' \
  --data '{"event":"incident.created","id":"evt_123"}' \
  'https://playrunner.example.com/api/webhooks/inbound/ENDPOINT_ID/SECRET'
```

A valid request starts the saved workflow and returns HTTP `202`:

```json
{
  "executionId": "113aa590-3995-48f3-ab3f-4819df900ae7",
  "status": "started"
}
```

The request is available to workflow templates at
`workflow.trigger.webhook`:

```json
{
  "method": "POST",
  "headers": {
    "content-type": "application/json"
  },
  "query": {},
  "body": {
    "event": "incident.created",
    "id": "evt_123"
  },
  "receivedAt": "2026-07-26T00:00:00.000Z"
}
```

Playrunner parses JSON and URL-encoded form bodies. Other content types are
provided as text. Only the `content-type`, `user-agent`, and `x-request-id`
headers are passed into the workflow.

### Endpoint security and limits

- Each saved Webhooks node has a random endpoint ID and a 32-byte secret.
- The stored secret is encrypted, and request matching uses its SHA-256 hash.
- Rotating the secret invalidates the previous URL.
- Disabling an endpoint stops new requests without deleting its configuration.
- Invalid, disabled, or unknown endpoint URLs return `404`.
- Request bodies are limited to 1 MiB.
- Each client IP and endpoint combination is limited to 60 requests per minute.

Treat the complete endpoint URL as a secret. Rotate it if it appears in logs,
screenshots, or another untrusted location.

## Expose a local endpoint

Inbound endpoints stay private until the user chooses an exposure mode in
**Webhooks settings**.

### Existing public HTTPS URL

Select **Use configured public URL** and enter the HTTPS base URL of the reverse
proxy, ingress, or tunnel that already routes to the Playrunner API. Playrunner
uses that base URL when it displays the public endpoint; it does not configure
the external proxy.

### Managed Cloudflare tunnel

Select **Managed Cloudflare Tunnel**, then select **Start tunnel**. This is
opt-in: viewing or enabling an endpoint never starts Cloudflare automatically.

The local machine must have `cloudflared` available on `PATH`. Playrunner starts
a Cloudflare quick tunnel to the local API, displays its temporary URL, and
shows recent startup output while it waits for the route to become reachable.
Select **Stop tunnel** when it is no longer needed.

Quick tunnel URLs can change whenever the tunnel or local API restarts. Use an
operator-managed hostname and ingress for stable environments.

## Send an outbound webhook

Select **Send an outbound request**, then configure:

| Field         | Behavior                                                     |
| ------------- | ------------------------------------------------------------ |
| Target URL    | Public HTTPS URL; workflow templates are supported.          |
| Method        | `POST`, `PUT`, `PATCH`, `DELETE`, or `GET`.                  |
| Retries       | Zero to three retries for failures and `5xx` responses.      |
| Headers       | JSON object containing string header values.                 |
| Body template | Optional templated request body; omitted for `GET` requests. |

Example body template:

```json
{
  "status": "{{workflow.run.status}}"
}
```

Set the optional default bearer token in **Webhooks settings**. The executor
adds it as an `Authorization: Bearer ...` header. The headers field cannot
override `authorization`, `cookie`, or `host`.

Outbound requests:

- Only connect to public HTTPS targets.
- Reject localhost and private IPv4 targets.
- Do not follow redirects.
- Use a 10-second default timeout.
- Capture at most 64 KiB of response text.

Successful node output contains the HTTP status and response body:

```json
{
  "body": "{\"accepted\":true}",
  "status": 202
}
```

## Exports

```ts
import webhooksIntegration, {
  WebhooksConfigPanel,
  WebhooksSettingsModal,
} from '@playrunner/webhooks';
import webhooksApiContribution from '@playrunner/webhooks/api';
import webhooksOrchestratorContribution from '@playrunner/webhooks/orchestrator';
```

The package manifest declares the `webhooks` integration ID and all three
contribution surfaces. Application builds discover them from installed direct
dependencies and generate static imports.
