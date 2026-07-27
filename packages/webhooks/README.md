# @playrunner/webhooks

Inbound workflow triggers and outbound HTTP actions for Playrunner.

## Features

- Create a secret inbound endpoint for a saved Webhooks workflow node.
- Start workflows from JSON, form-encoded, or text requests.
- Keep inbound endpoints local, provide an existing public HTTPS base URL, or
  explicitly start a temporary Cloudflare quick tunnel.
- Send outbound HTTPS requests with templates, headers, an optional shared
  bearer token, and up to three retries.

## Install

```bash
npm install @playrunner/webhooks
```

The package contributes frontend, API, and Orchestrator surfaces. A Playrunner
build must include it as a direct dependency of each app that consumes those
surfaces.

## Inbound webhooks

Add a Webhooks node, select **Receive an inbound trigger**, and save the
workflow. Create the endpoint from the node configuration. Playrunner displays
the local URL and endpoint path with copy controls.

An inbound JSON request can look like this:

```bash
curl --request POST \
  --header 'content-type: application/json' \
  --data '{"event":"incident.created","id":"evt_123"}' \
  'https://playrunner.example.com/api/webhooks/inbound/ENDPOINT_ID/SECRET'
```

A successful request returns HTTP `202`:

```json
{
  "executionId": "113aa590-3995-48f3-ab3f-4819df900ae7",
  "status": "started"
}
```

The workflow receives the sanitized request at `workflow.trigger.webhook`:

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

Only `content-type`, `user-agent`, and `x-request-id` headers are forwarded into
the workflow. Requests are limited to 1 MiB and 60 requests per minute for each
client IP and endpoint.

Rotating the endpoint secret invalidates the previous URL. Disabling the
endpoint makes it return `404` without deleting its configuration.

### Public exposure

Inbound endpoints remain private unless the user chooses a public exposure mode
in **Webhooks settings**:

- **No public exposure** keeps the local endpoint private.
- **Use configured public URL** displays a URL based on an existing public HTTPS
  reverse proxy or ingress.
- **Managed Cloudflare Tunnel** lets the user explicitly start and stop a
  temporary Cloudflare quick tunnel. Playrunner never starts it automatically.

Managed tunnel mode requires `cloudflared` on `PATH`. Its temporary URL can
change whenever the tunnel or API restarts. The settings panel displays startup
status and recent `cloudflared` output.

## Outbound webhooks

Select **Send an outbound request** and configure:

- A public HTTPS target URL.
- `POST`, `PUT`, `PATCH`, `DELETE`, or `GET`.
- A JSON object of string headers.
- An optional body template.
- Zero to three retries.

The target URL and body use Playrunner workflow templates. For example:

```json
{
  "status": "{{workflow.run.status}}"
}
```

Configure the optional default bearer token in **Webhooks settings**. Playrunner
adds it as the `Authorization: Bearer ...` header. User-supplied
`authorization`, `cookie`, and `host` headers are ignored.

Outbound requests only allow public HTTPS targets, do not follow redirects, and
capture at most 64 KiB of response text. The node output contains:

```json
{
  "body": "{\"accepted\":true}",
  "status": 202
}
```

## Package exports

```ts
import webhooksIntegration, {
  WebhooksConfigPanel,
  WebhooksSettingsModal,
} from '@playrunner/webhooks';
import webhooksApiContribution from '@playrunner/webhooks/api';
import webhooksOrchestratorContribution from '@playrunner/webhooks/orchestrator';
```
