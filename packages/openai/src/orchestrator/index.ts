import type {
  NodeExecutionContext,
  NodeExecutionResult,
  OrchestratorIntegrationContribution,
} from '@playrunner/integration-sdk/orchestrator';

const RESPONSES_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.6';
const DEFAULT_PROMPT = 'Summarize {{workflow.definition.name}}.';
const REASONING_EFFORTS = new Set([
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
const VERBOSITY_LEVELS = new Set(['low', 'medium', 'high']);

class OpenAIExecutionError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function safeProviderCode(value: unknown): string | undefined {
  const code = optionalString(value);
  return code && /^[a-z0-9_.-]{1,100}$/i.test(code) ? code : undefined;
}

function parseJsonSchema(value: unknown): Record<string, unknown> {
  let schema: unknown = value;
  if (typeof value === 'string') {
    try {
      schema = JSON.parse(value);
    } catch {
      throw new OpenAIExecutionError(
        'Structured output schema must be valid JSON.',
      );
    }
  }

  if (!isRecord(schema) || schema.type !== 'object') {
    throw new OpenAIExecutionError(
      'Structured output schema must be a JSON Schema object with type "object".',
    );
  }

  return schema;
}

function extractOutputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  if (!Array.isArray(response.output)) return '';

  return response.output
    .flatMap((item) =>
      isRecord(item) && Array.isArray(item.content) ? item.content : [],
    )
    .filter(
      (content): content is Record<string, unknown> =>
        isRecord(content) &&
        content.type === 'output_text' &&
        typeof content.text === 'string',
    )
    .map((content) => String(content.text))
    .join('');
}

function responseUsage(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;

  const usage = Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function buildRequestBody(context: NodeExecutionContext) {
  const config = context.node.config;
  const model = optionalString(config.model) ?? DEFAULT_MODEL;
  const prompt = context.renderTemplate(
    optionalString(config.prompt) ?? DEFAULT_PROMPT,
  );
  if (!prompt) {
    throw new OpenAIExecutionError('Prompt is required.');
  }

  const reasoningEffort = optionalString(config.reasoningEffort) ?? 'medium';
  if (!REASONING_EFFORTS.has(reasoningEffort)) {
    throw new OpenAIExecutionError('Reasoning effort is invalid.');
  }

  const verbosity = optionalString(config.verbosity) ?? 'medium';
  if (!VERBOSITY_LEVELS.has(verbosity)) {
    throw new OpenAIExecutionError('Verbosity is invalid.');
  }

  const maxOutputTokens = boundedInteger(config.maxOutputTokens, 1, 128000);
  if (
    config.maxOutputTokens !== undefined &&
    config.maxOutputTokens !== '' &&
    maxOutputTokens === undefined
  ) {
    throw new OpenAIExecutionError(
      'Maximum output tokens must be an integer between 1 and 128000.',
    );
  }

  const text: Record<string, unknown> = { verbosity };
  if (config.responseFormat === 'json_schema') {
    text.format = {
      type: 'json_schema',
      name: 'playrunner_output',
      strict: true,
      schema: parseJsonSchema(config.jsonSchema),
    };
  }

  return {
    model,
    input: prompt,
    store: false,
    reasoning: { effort: reasoningEffort },
    text,
    ...(maxOutputTokens === undefined
      ? {}
      : { max_output_tokens: maxOutputTokens }),
  };
}

function providerFailure(
  status: number,
  responseBody: unknown,
): OpenAIExecutionError {
  const error =
    isRecord(responseBody) && isRecord(responseBody.error)
      ? responseBody.error
      : undefined;
  const code = safeProviderCode(error?.code) ?? safeProviderCode(error?.type);
  return new OpenAIExecutionError(
    `OpenAI API returned ${status}: ${code ? `request failed (${code})` : 'request failed'}.`,
  );
}

async function executeOpenAI(
  context: NodeExecutionContext,
): Promise<NodeExecutionResult> {
  const apiKey = optionalString(context.settings.apiKey);
  if (!apiKey) {
    throw new Error(
      'OpenAI credentials missing. Add an API key before running.',
    );
  }

  try {
    const requestBody = buildRequestBody(context);
    await context.log(
      `Requesting OpenAI model ${requestBody.model}...`,
      'info',
    );

    const response = await fetch(RESPONSES_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: context.signal,
    });

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = undefined;
    }

    if (!response.ok) {
      throw providerFailure(response.status, responseBody);
    }
    if (!isRecord(responseBody)) {
      throw new OpenAIExecutionError('OpenAI returned an invalid response.');
    }

    const outputText = extractOutputText(responseBody);
    if (!outputText) {
      throw new OpenAIExecutionError('OpenAI returned no text output.');
    }

    let data: Record<string, unknown>;
    if (context.node.config.responseFormat === 'json_schema') {
      try {
        const parsed: unknown = JSON.parse(outputText);
        if (!isRecord(parsed)) {
          throw new Error('not an object');
        }
        data = parsed;
      } catch {
        throw new OpenAIExecutionError(
          'OpenAI returned invalid structured output.',
        );
      }
    } else {
      data = { text: outputText };
    }

    await context.log('OpenAI response received successfully.', 'info');

    return {
      outcome: 'success',
      output: {
        result: {
          status: 'success',
          data,
          model: optionalString(responseBody.model) ?? requestBody.model,
          ...(optionalString(responseBody.id)
            ? { responseId: optionalString(responseBody.id) }
            : {}),
          ...(responseUsage(responseBody.usage)
            ? { usage: responseUsage(responseBody.usage) }
            : {}),
        },
      },
    };
  } catch (error) {
    const message =
      error instanceof OpenAIExecutionError
        ? error.message
        : context.signal.aborted
          ? 'OpenAI request was cancelled.'
          : 'OpenAI request failed.';
    throw new Error(`OpenAI action failed: ${message}`);
  }
}

export const openaiOrchestratorContribution = {
  contractVersion: 1,
  id: 'openai',
  executors: [
    {
      nodeType: 'openai',
      default: true,
      execute: executeOpenAI,
    },
  ],
} satisfies OrchestratorIntegrationContribution;

export default openaiOrchestratorContribution;
