import {
  InferenceClient,
  InferenceClientHubApiError,
  InferenceClientInputError,
  InferenceClientProviderApiError,
  InferenceClientProviderOutputError,
  InferenceClientRoutingError,
} from '@huggingface/inference';
import type {
  NodeExecutionContext,
  NodeExecutionResult,
  OrchestratorIntegrationContribution,
} from '@playrunner/integration-sdk/orchestrator';

const TASK_DEFAULTS = {
  'text-generation': 'google/gemma-2-2b-it',
  'text-classification':
    'distilbert/distilbert-base-uncased-finetuned-sst-2-english',
  'feature-extraction': 'thenlper/gte-large',
} as const;

type HuggingFaceTask = keyof typeof TASK_DEFAULTS;

interface InferenceClientLike {
  textGeneration: (args: unknown, options?: unknown) => Promise<unknown>;
  textClassification: (args: unknown, options?: unknown) => Promise<unknown>;
  featureExtraction: (args: unknown, options?: unknown) => Promise<unknown>;
}

export type HuggingFaceClientFactory = (
  accessToken: string,
) => InferenceClientLike;

class HuggingFaceExecutionError extends Error {}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function selectedTask(value: unknown): HuggingFaceTask {
  if (value === undefined || value === null || value === '') {
    return 'text-generation';
  }
  if (typeof value === 'string' && value in TASK_DEFAULTS) {
    return value as HuggingFaceTask;
  }
  throw new HuggingFaceExecutionError(
    'The selected inference task is invalid.',
  );
}

function selectedProvider(value: unknown): string {
  const provider = optionalString(value) ?? 'auto';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider)) {
    throw new HuggingFaceExecutionError(
      'The selected inference provider is invalid.',
    );
  }
  return provider;
}

function selectedModel(value: unknown, task: HuggingFaceTask): string {
  const model = optionalString(value) ?? TASK_DEFAULTS[task];
  if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(model)) {
    throw new HuggingFaceExecutionError(
      'Model must be a Hugging Face Hub model ID such as owner/model.',
    );
  }
  return model;
}

function parseParameters(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new HuggingFaceExecutionError(
        'Inference parameters must be valid JSON.',
      );
    }
  }

  if (!isRecord(parsed)) {
    throw new HuggingFaceExecutionError(
      'Inference parameters must be a JSON object.',
    );
  }
  return parsed;
}

function createClient(accessToken: string): InferenceClientLike {
  return new InferenceClient(accessToken) as unknown as InferenceClientLike;
}

function safeFailureMessage(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) {
    return 'Hugging Face inference request was cancelled.';
  }
  if (error instanceof HuggingFaceExecutionError) {
    return error.message;
  }
  if (error instanceof InferenceClientRoutingError) {
    return 'No compatible inference provider is available for this model and task.';
  }
  if (error instanceof InferenceClientInputError) {
    return 'Hugging Face rejected the inference configuration.';
  }
  if (error instanceof InferenceClientHubApiError) {
    return 'Hugging Face rejected the request. Check the access token permissions.';
  }
  if (error instanceof InferenceClientProviderApiError) {
    return 'The inference provider rejected the request. Check the model, provider, and token.';
  }
  if (error instanceof InferenceClientProviderOutputError) {
    return 'The inference provider returned an invalid response.';
  }
  return 'Hugging Face inference request failed.';
}

export async function executeHuggingFace(
  context: NodeExecutionContext,
  clientFactory: HuggingFaceClientFactory = createClient,
): Promise<NodeExecutionResult> {
  const accessToken = optionalString(context.settings.accessToken);
  if (!accessToken) {
    throw new Error(
      'Hugging Face credentials missing. Add an access token before running.',
    );
  }

  try {
    const task = selectedTask(context.node.config.action);
    const provider = selectedProvider(context.node.config.provider);
    const model = selectedModel(context.node.config.model, task);
    const input = context.renderTemplate(
      optionalString(context.node.config.input) ?? '',
    );
    if (!input) {
      throw new HuggingFaceExecutionError('Inference input is required.');
    }
    const parameters = parseParameters(context.node.config.parameters);
    const request = {
      model,
      provider,
      inputs: input,
    };
    const requestOptions = {
      fetch: (resource: RequestInfo | URL, init?: RequestInit) =>
        fetch(resource, { ...init, signal: context.signal }),
    };

    await context.log(
      `Requesting Hugging Face ${task} with ${model} via ${provider}...`,
      'info',
    );

    const client = clientFactory(accessToken);
    let data: unknown;
    switch (task) {
      case 'text-generation':
        data = await client.textGeneration(
          { ...request, ...(parameters ? { parameters } : {}) },
          requestOptions,
        );
        break;
      case 'text-classification':
        data = await client.textClassification(
          { ...request, ...(parameters ? { parameters } : {}) },
          requestOptions,
        );
        break;
      case 'feature-extraction':
        data = await client.featureExtraction(
          { ...request, ...parameters },
          requestOptions,
        );
        break;
    }

    if (data === undefined) {
      throw new HuggingFaceExecutionError(
        'The inference provider returned no output.',
      );
    }

    await context.log('Hugging Face inference completed successfully.', 'info');

    return {
      outcome: 'success',
      output: {
        result: {
          status: 'success',
          data,
          task,
          model,
          provider,
        },
      },
    };
  } catch (error) {
    throw new Error(
      `Hugging Face action failed: ${safeFailureMessage(error, context.signal)}`,
    );
  }
}

export const huggingFaceOrchestratorContribution = {
  contractVersion: 1,
  id: 'huggingface',
  executors: [
    {
      nodeType: 'huggingface',
      default: true,
      execute: executeHuggingFace,
    },
  ],
} satisfies OrchestratorIntegrationContribution;

export default huggingFaceOrchestratorContribution;
