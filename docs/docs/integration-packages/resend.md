---
sidebar_position: 12
sidebar_label: Resend
title: Resend Integration
description: Send email or wait for inbound messages, verification codes, and attachments in Playrunner workflows.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="Resend"
packageName="@playrunner/resend"
description="Send email or pause a workflow until a matching inbound message arrives, then extract verification codes, content, and attachment links."
icon="resend"
installCommand="npm install @playrunner/resend"
npmUrl="https://www.npmjs.com/package/@playrunner/resend"
badges={['Action node', 'OAuth', 'Inbound email']}
facts={[
{ label: 'Node type', value: 'Action' },
{ label: 'Auth path', value: 'users/{uid}/integrations/resend' },
{ label: 'Backend mount', value: '/api/resend' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="One node" title="Two operations">
    Choose **Send Email** or **Wait for Email** from the node's **Operation**
    dropdown. The configuration form changes for the selected operation while
    the workflow keeps the stable `resend` node type.
  </IntegrationCard>

  <IntegrationCard eyebrow="Authentication" title="OAuth or API key">
    Connect with Resend OAuth or save a full-access API key. Receiving routes
    require full access; a send-only key cannot run **Wait for Email**.
  </IntegrationCard>

  <IntegrationCard eyebrow="Inbound email" title="Durable polling">
    **Wait for Email** polls Resend's Receiving API. It can match messages that
    arrived during a brief Playrunner interruption and does not require a
    Resend webhook.
  </IntegrationCard>

  <IntegrationCard eyebrow="Workflow data" title="Codes and attachments">
    Matching messages return text, HTML, headers, sender and recipient data,
    deterministic verification-code extraction, and optional temporary
    attachment download URLs.
  </IntegrationCard>
</IntegrationGrid>

:::important Build-time installation only

Resend declares frontend, API, Orchestrator, and E2E surfaces in its package
manifest. It must be a direct production dependency of each Playrunner app or
runner that consumes those surfaces. Installing or upgrading the package
requires rebuilding and redeploying the affected artifacts.

:::

## Setup

You need a [Resend account](https://resend.com). The same Playrunner connection
supports sending and receiving; the operation is selected on each workflow
node.

### Connect Resend

OAuth is the recommended connection method:

1. In Playrunner, open **Integrations** and select **Resend**.
2. Leave **OAuth** selected and optionally enter the default receiving address
   you want shown when configuring **Wait for Email**.
3. Select **Connect with Resend**.
4. Review and approve the `full_access` permission in the Resend popup.
5. Wait for Playrunner to show **Resend Connected Successfully**.

Playrunner uses Resend's OAuth 2.1 flow with PKCE and refreshes expiring access
tokens. Full access is requested because Resend requires it for Receiving API
routes. See Resend's official
[OAuth client guide](https://resend.com/docs/guides/building-a-resend-oauth-client)
for the provider's scopes and authorization behavior.

To use an API key instead:

1. Create a key in Resend with **Full access** permission. Resend documents the
   available permissions in its official
   [API key guide](https://resend.com/docs/dashboard/api-keys/introduction).
2. In Playrunner's **Connect to Resend** dialog, select **API key**.
3. Paste the key, optionally enter a default receiving address, and select
   **Save API key**.

The settings dialog never displays a saved secret. Entering new credentials
replaces the stored connection, and **Disconnect** removes it.

### Configure sending

For production sending, add and verify a domain you control in Resend. The
`From` address on the Playrunner node must use a domain that Resend permits your
account to send from. Follow Resend's official
[domain setup documentation](https://resend.com/docs/dashboard/domains/introduction)
for the required DNS records and verification status.

After the domain is verified, add a Resend node to a workflow and leave its
operation set to **Send Email**.

### Configure receiving

1. Choose a Resend-managed `*.resend.app` receiving domain, or configure a
   custom receiving domain.
2. For a custom domain, enable receiving and add the MX record supplied by
   Resend. Prefer a dedicated subdomain when the root domain already receives
   mail elsewhere.
3. Enter an address on that domain as the Playrunner connection's optional
   default receiving address.
4. Add a Resend node to the workflow and select **Wait for Email**.
5. Set **Recipient** to the exact address that will receive the message. Use a
   unique templated address when concurrent workflow runs need isolation.

Follow Resend's official
[receiving guide](https://resend.com/docs/dashboard/receiving/introduction) or
[custom receiving domain guide](https://resend.com/docs/dashboard/receiving/custom-domains)
for provider-side domain and MX configuration.

You do not need to configure an `email.received` webhook for this integration.
Playrunner polls Resend's durable Receiving API and retrieves the full message
and attachment details after it finds a match.

## Send Email configuration

| Field                    | Description                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **From**                 | Required sender address accepted by Resend. A display name such as `Playrunner <automation@example.com>` works. |
| **To**                   | Required recipients separated by commas or new lines, with a maximum of 50.                                     |
| **Subject**              | Required subject line.                                                                                          |
| **Content**              | Send text and/or HTML, or use a published Resend template.                                                      |
| **Template ID or alias** | Required in template mode.                                                                                      |
| **Template variables**   | Optional JSON object rendered before it is sent to Resend.                                                      |
| **CC / BCC / Reply to**  | Optional recipient lists.                                                                                       |
| **Idempotency key**      | Optional override. Playrunner defaults to the execution ID and node ID.                                         |
| **Tags**                 | Optional JSON object converted to Resend name/value tags.                                                       |
| **Custom headers**       | Optional JSON object sent as email headers.                                                                     |

See Resend's official
[Send Email API reference](https://resend.com/docs/api-reference/emails/send-email)
for provider request behavior and limits.

A successful operation returns:

```json
{
  "result": {
    "status": "success",
    "emailId": "provider-email-id"
  }
}
```

## Wait for Email configuration

| Field                          | Description                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Recipient**                  | Required exact recipient address used to correlate the message to this workflow run.                       |
| **Timeout**                    | How long to poll, from 5 to 240 seconds. Defaults to 120 seconds.                                          |
| **Look back**                  | Includes messages received shortly before the node started, from 0 to 300 seconds. Defaults to 30 seconds. |
| **Sender**                     | Optional exact sender or domain suffix such as `@example.com`.                                             |
| **Subject contains**           | Optional case-insensitive subject filter.                                                                  |
| **Body contains**              | Optional case-insensitive filter applied to plain text and text extracted from HTML.                       |
| **Extract**                    | Extract a verification code, run a custom regular expression, or disable extraction.                       |
| **Regular expression / group** | Custom extraction pattern and capture group.                                                               |
| **Attachments**                | Retrieve metadata and temporary download URLs, or skip attachment links.                                   |

Playrunner checks uninspected messages that meet the time, recipient, sender,
and subject filters, then fetches the full email to apply the body filter and
extraction. The default extractor returns a value only when it finds one
unambiguous 4- to 8-character verification-code candidate.

A successful match returns this shape:

```json
{
  "result": {
    "status": "matched",
    "email": {
      "id": "received-email-id",
      "from": "security@example.com",
      "to": ["login@example.resend.app"],
      "subject": "Your verification code",
      "createdAt": "2026-08-04T01:02:03.000Z",
      "text": "Your code is 123456",
      "html": "<p>Your code is 123456</p>",
      "headers": {},
      "messageId": "<message-id@example.com>"
    },
    "extraction": {
      "type": "verification_code",
      "status": "matched",
      "value": "123456"
    },
    "attachments": [
      {
        "id": "attachment-id",
        "filename": "receipt.pdf",
        "contentType": "application/pdf",
        "size": 12345,
        "downloadUrl": "https://temporary-download-url.example",
        "expiresAt": "2026-08-04T01:07:03.000Z"
      }
    ]
  }
}
```

Attachment URLs are temporary. A downstream node should download the file
before the returned expiry time. Resend's official receiving documentation
explains that message bodies and attachments are fetched separately from their
metadata.

## Exports

```ts
import resendIntegration, {
  ResendConfigPanel,
  ResendIcon,
  ResendSettingsModal,
  resendIconUrl,
} from '@playrunner/resend';
import resendApiContribution, { resendRouter } from '@playrunner/resend/api';
import resendOrchestratorContribution from '@playrunner/resend/orchestrator';
import resendE2EContribution, {
  createResendE2EData,
  ResendE2EPom,
} from '@playrunner/resend/e2e';
```

The default exports are the build-composition contracts. The package manifest
declares each surface so consuming applications generate static imports at
build time without a shared provider registry.
