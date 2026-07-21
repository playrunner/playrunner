---
sidebar_position: 9
sidebar_label: OpenAI
title: OpenAI Integration
description: Generate text and structured output with OpenAI models from Playrunner workflows.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="OpenAI"
packageName="@playrunner/openai"
description="Generate, analyze, classify, and structure text with OpenAI models from Playrunner workflows."
icon="openai"
installCommand="npm install @playrunner/openai"
npmUrl="https://www.npmjs.com/package/@playrunner/openai"
badges={['Action node', 'API key', 'Structured output']}
facts={[
{ label: 'Node type', value: 'Action' },
{ label: 'Auth path', value: 'users/{uid}/integrations/openai' },
{ label: 'API', value: 'Responses API' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Connection and node settings">
    Exports `openaiIntegration`, `OpenAISettingsModal`, and
    `OpenAIConfigPanel` for API-key setup and workflow node configuration.
  </IntegrationCard>

  <IntegrationCard eyebrow="Orchestrator" title="Package-owned execution">
    Exports `openaiOrchestratorContribution`, which calls the OpenAI Responses
    API and returns text or structured JSON as node output.
  </IntegrationCard>

  <IntegrationCard eyebrow="Output" title="Composable workflow data">
    Successful runs expose the response data, model, response ID when present,
    and numeric usage information to connected downstream nodes.
  </IntegrationCard>

  <IntegrationCard eyebrow="Icon" title="Theme-adaptive mark">
    The package exports an inline `OpenAIIcon` that uses `currentColor`, matching
    GitHub's pattern so the monochrome mark follows the active theme.
  </IntegrationCard>
</IntegrationGrid>

:::important Build-time installation only

The install command on this page is for building a Playrunner deployment. The
OpenAI package declares frontend, API, and Orchestrator surfaces in its own
manifest. It must be a direct production dependency of every app or runner that
uses one of those surfaces.

A running workflow never downloads or installs this package. Adding, removing,
or upgrading it requires rebuilding and redeploying the affected frontend, API,
and Orchestrator artifacts.

:::

## Connect OpenAI

1. Create an API key from the
   [OpenAI API keys page](https://platform.openai.com/api-keys).
2. In Playrunner, open **Integrations** and select **OpenAI**.
3. Paste the API key and select **Save API key**.
4. Add an OpenAI action node to a workflow and configure its prompt.

The settings screen never displays an existing saved key. Entering another key
replaces the stored credential. Disconnecting removes the saved OpenAI
integration data.

## Node configuration

| Field                     | Description                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| **Model**                 | Model sent to the Responses API. Defaults to `gpt-5.6`.                                           |
| **Prompt**                | Input text for the model. Supports Playrunner workflow and upstream-node template variables.      |
| **Response format**       | Returns plain text or validates the response against a strict JSON Schema.                        |
| **JSON Schema**           | Required for structured JSON. Must be an object schema whose top-level `type` is `object`.        |
| **Reasoning effort**      | One of `none`, `low`, `medium`, `high`, `xhigh`, or `max`. Defaults to `medium`.                  |
| **Verbosity**             | One of `low`, `medium`, or `high`. Defaults to `medium`.                                          |
| **Maximum output tokens** | Optional integer from `1` to `128000`. Leave blank to use the model's default output-token limit. |

If the prompt is blank, the executor rejects the node before making a provider
request. The default prompt is:

```text
Summarize {{workflow.definition.name}}.
```

## Exports

```ts
import openaiIntegration, {
  OpenAIConfigPanel,
  OpenAIIcon,
  OpenAISettingsModal,
  openaiIconUrl,
} from '@playrunner/openai';
import openaiApiContribution, { openaiRouter } from '@playrunner/openai/api';
import openaiOrchestratorContribution from '@playrunner/openai/orchestrator';
```

The default exports are the build-composition contract. Named exports remain
available for package consumers that need an individual component or router.

## Frontend

The frontend contribution owns the integration metadata, connection modal,
theme-adaptive icon, and action-node configuration panel. It accesses
Playrunner authentication, persistence, and shared UI primitives through
`@playrunner/integration-sdk`; it does not import private frontend application
modules.

The API key is stored at `users/{uid}/integrations/openai`. The Orchestrator
receives only the OpenAI settings for an OpenAI node, rather than receiving
credentials belonging to other providers.

## API

The API entrypoint default-exports `openaiApiContribution` with the stable ID
`openai`, the `/api/openai` mount path, and `openaiRouter`. The router currently
has no provider proxy routes because workflow execution calls OpenAI from the
Orchestrator with the saved API key.

## Orchestrator

The `@playrunner/openai/orchestrator` subpath registers one default executor for
persisted nodes whose `nodeType` is `openai`. The package uses the versioned
`@playrunner/integration-sdk/orchestrator` contract, while the host remains
responsible for workflow lifecycle, state transitions, timeouts, cancellation,
and event publication.

During execution, the OpenAI executor:

1. Validates the API key and node configuration.
2. Renders the prompt with the host-provided template renderer.
3. Sends a `POST` request to the OpenAI Responses API with `store: false`.
4. Passes the host `AbortSignal` to the request so stopping the node cancels the
   in-flight call.
5. Extracts response text and, for structured output, parses it as a JSON
   object.
6. Returns a safe success result to the host, which publishes the node output
   and continues the workflow.

### Output shape

Plain-text responses expose the generated text under `result.data.text`:

```json
{
  "result": {
    "status": "success",
    "data": {
      "text": "Generated response"
    },
    "model": "gpt-5.6",
    "responseId": "resp_example",
    "usage": {
      "input_tokens": 24,
      "output_tokens": 12,
      "total_tokens": 36
    }
  }
}
```

For structured output, `result.data` is the parsed JSON object described by the
node's schema rather than an object containing `text`. The response ID and usage
fields are included only when OpenAI returns them.

## Failure modes

| Failure                    | Behavior                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Missing API key            | Fails before making the OpenAI request.                                                  |
| Invalid node configuration | Reports a validation error for the prompt, effort, verbosity, token limit, or schema.    |
| OpenAI HTTP error          | Reports the status and a sanitized provider error code when one is safe to expose.       |
| Invalid or empty response  | Fails without exposing the raw provider response.                                        |
| Invalid structured output  | Fails when the returned text cannot be parsed as a JSON object.                          |
| Host cancellation          | Cancels the in-flight request and reports that the OpenAI request was cancelled.         |
| Unexpected request failure | Reports `OpenAI request failed.` without including credentials or raw provider payloads. |

API keys, authorization headers, and raw OpenAI error bodies are excluded from
node output and user-visible execution errors.

## Assets

The raw SVG lives at `packages/openai/assets/openai.svg` and is exported from
`@playrunner/openai/assets/openai.svg`. Product UI uses the separately exported
`OpenAIIcon` React component, whose inline SVG has `fill="currentColor"`. This
allows the monochrome mark to follow the active theme without a CSS mask or a
duplicate public asset.
