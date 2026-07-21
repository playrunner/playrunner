---
sidebar_position: 10
sidebar_label: Hugging Face
title: Hugging Face Integration
description: Run hosted open-source models through Hugging Face Inference Providers from Playrunner workflows.
hide_title: true
---

import {
IntegrationCard,
IntegrationGrid,
IntegrationHero,
} from '@site/src/components/IntegrationPage';

<IntegrationHero
name="Hugging Face"
packageName="@playrunner/huggingface"
description="Run text generation, text classification, and feature extraction through Hugging Face Inference Providers."
icon="huggingface"
installCommand="npm install @playrunner/huggingface"
npmUrl="https://www.npmjs.com/package/@playrunner/huggingface"
badges={['Action node', 'Access token', 'Inference Providers']}
facts={[
{ label: 'Node type', value: 'Action' },
{ label: 'Auth path', value: 'users/{uid}/integrations/huggingface' },
{ label: 'Client', value: '@huggingface/inference' },
]}
/>

<IntegrationGrid>
  <IntegrationCard eyebrow="Frontend" title="Connection and node settings">
    Exports `huggingFaceIntegration`, `HuggingFaceSettingsModal`, and
    `HuggingFaceConfigPanel` for token setup and inference configuration.
  </IntegrationCard>

  <IntegrationCard eyebrow="Orchestrator" title="Package-owned execution">
    Exports `huggingFaceOrchestratorContribution`, which calls Hugging Face
    Inference Providers and returns the provider response as workflow data.
  </IntegrationCard>

  <IntegrationCard eyebrow="Tasks" title="Three inference modes">
    Supports text generation, text classification, and feature extraction with
    task-specific defaults and optional JSON parameters.
  </IntegrationCard>

  <IntegrationCard eyebrow="Providers" title="Automatic or explicit routing">
    Select `auto` to use your Hugging Face provider order, or choose a supported
    provider explicitly for the workflow node.
  </IntegrationCard>
</IntegrationGrid>

:::important Build-time installation only

The install command on this page is for building a Playrunner deployment. The
Hugging Face package declares frontend and Orchestrator surfaces in its own
manifest. It must be a direct production dependency of every app or runner that
uses one of those surfaces.

A running workflow never downloads or installs this package. Adding, removing,
or upgrading it requires rebuilding and redeploying the affected frontend and
Orchestrator artifacts.

:::

## Connect Hugging Face

1. Open the [Hugging Face access tokens page](https://huggingface.co/settings/tokens)
   and create a token that can call Inference Providers.
2. In Playrunner, open **Integrations** and select **Hugging Face**.
3. Paste the token and select **Save access token**.
4. Add a Hugging Face action node to a workflow and configure its task, model,
   provider, and input.

For provider setup, billing, and routing details, see the official
[Hugging Face Inference Providers documentation](https://huggingface.co/docs/inference-providers/).

The settings screen never displays an existing saved token. Entering another
token replaces the stored credential. Disconnecting removes the saved Hugging
Face integration data.

## Node configuration

| Field                  | Description                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Task**               | `text-generation`, `text-classification`, or `feature-extraction`. Defaults to text generation.                    |
| **Inference provider** | `auto` uses the provider order configured in Hugging Face. An explicit supported provider can be selected instead. |
| **Model**              | A Hugging Face Hub model ID in `owner/model` format. The default changes with the selected task.                   |
| **Input**              | Text sent to the model. Supports Playrunner workflow and upstream-node template variables.                         |
| **Parameters**         | Optional JSON object containing parameters supported by the selected task and model.                               |

The task defaults are:

| Task                | Default model                                                |
| ------------------- | ------------------------------------------------------------ |
| Text generation     | `google/gemma-2-2b-it`                                       |
| Text classification | `distilbert/distilbert-base-uncased-finetuned-sst-2-english` |
| Feature extraction  | `thenlper/gte-large`                                         |

If the input is blank, the executor rejects the node before making a provider
request.

## Exports

```ts
import huggingFaceIntegration, {
  HuggingFaceConfigPanel,
  HuggingFaceSettingsModal,
  huggingFaceIconUrl,
} from '@playrunner/huggingface';
import huggingFaceOrchestratorContribution from '@playrunner/huggingface/orchestrator';
```

The default exports are the build-composition contract. Named exports remain
available for package consumers that need an individual component.

## Frontend

The frontend contribution owns the integration metadata, connection modal,
icon, and action-node configuration panel. It accesses Playrunner
authentication, persistence, and shared UI primitives through
`@playrunner/integration-sdk`; it does not import private frontend application
modules.

The access token is stored at `users/{uid}/integrations/huggingface`. The
Orchestrator receives only the Hugging Face settings for a Hugging Face node,
rather than receiving credentials belonging to other providers.

## API

This integration does not add a Playrunner API route. Workflow execution calls
Hugging Face from the Orchestrator with the saved access token, so a provider
proxy endpoint is not required.

## Orchestrator

The `@playrunner/huggingface/orchestrator` subpath registers one default
executor for persisted nodes whose `nodeType` is `huggingface`. The package uses
the versioned `@playrunner/integration-sdk/orchestrator` contract, while the
host remains responsible for workflow lifecycle, state transitions, timeouts,
cancellation, logs, and event publication.

During execution, the Hugging Face executor:

1. Validates the access token and node configuration.
2. Renders the input with the host-provided template renderer.
3. Calls the selected task through `@huggingface/inference`.
4. Passes the host `AbortSignal` to the request so stopping the node cancels the
   in-flight call.
5. Records safe start and completion messages through the host workflow logger.
6. Returns the provider result to the host, which publishes the node output and
   continues the workflow.

### Output shape

The provider response is exposed under `result.data`. Its exact shape depends
on the selected task and model:

```json
{
  "result": {
    "status": "success",
    "data": {
      "generated_text": "Generated response"
    },
    "task": "text-generation",
    "model": "google/gemma-2-2b-it",
    "provider": "auto"
  }
}
```

## Failure modes

| Failure                    | Behavior                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| Missing access token       | Fails before making the Hugging Face request.                                                  |
| Missing input              | Fails before making the Hugging Face request.                                                  |
| Invalid node configuration | Reports a validation error for the task, provider, model ID, or parameters JSON.               |
| Routing failure            | Reports that no compatible inference provider is available for the selected model and task.    |
| Hub or provider rejection  | Reports a sanitized message directing the user to check token permissions or node settings.    |
| Invalid provider response  | Fails without exposing the raw provider response.                                              |
| Host cancellation          | Cancels the in-flight request and reports that the inference request was cancelled.            |
| Unexpected request failure | Reports `Hugging Face inference request failed.` without credentials or raw provider payloads. |

Access tokens, authorization headers, and raw provider error bodies are excluded
from node output and user-visible execution errors.

## Assets

The SVG lives at `packages/huggingface/assets/huggingface.svg` and is exported
from `@playrunner/huggingface/assets/huggingface.svg`. The frontend contribution
exports `huggingFaceIconUrl` for product UI.
