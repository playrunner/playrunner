interface GenerationClient {
  textGeneration: (args: unknown, options?: unknown) => Promise<unknown>;
  chatCompletion: (args: unknown, options?: unknown) => Promise<unknown>;
}

export class HuggingFaceConfigurationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CHAT_PARAMETERS = new Set([
  'max_new_tokens',
  'max_tokens',
  'return_full_text',
  'temperature',
  'top_p',
  'stop',
  'seed',
  'frequency_penalty',
  'presence_penalty',
  'response_format',
]);

export async function generateText(
  client: GenerationClient,
  request: { model: string; provider: string; inputs: string },
  parameters: Record<string, unknown> | undefined,
  accessToken: string,
  options: { fetch: typeof fetch },
): Promise<unknown> {
  // Resolve the advertised task before inference: instruction models are often
  // served only through chat completion, even though their Hub pipeline is text generation.
  const response = await options.fetch(
    `https://huggingface.co/api/models/${request.model}?expand[]=inferenceProviderMapping`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new HuggingFaceConfigurationError(
      'Unable to look up model providers. Check the model and access token permissions.',
    );
  }
  const info: unknown = await response.json();
  const mapping = isRecord(info) ? info.inferenceProviderMapping : undefined;
  const providers: Record<string, unknown>[] = Array.isArray(mapping)
    ? mapping.filter(isRecord)
    : isRecord(mapping)
      ? Object.entries(mapping).flatMap(([provider, entry]) =>
          isRecord(entry) ? [{ ...entry, provider }] : [],
        )
      : [];
  const selected = providers.find(
    (entry) =>
      entry.status === 'live' &&
      typeof entry.provider === 'string' &&
      (request.provider === 'auto' || entry.provider === request.provider) &&
      (entry.task === 'text-generation' || entry.task === 'conversational'),
  );
  if (!selected) {
    throw new HuggingFaceConfigurationError(
      'No compatible live text generation provider is available for this model. Choose another model or provider.',
    );
  }
  const provider = String(selected.provider);
  if (selected.task === 'text-generation') {
    return client.textGeneration(
      { ...request, provider, ...(parameters ? { parameters } : {}) },
      options,
    );
  }

  if (Object.keys(parameters ?? {}).some((key) => !CHAT_PARAMETERS.has(key))) {
    throw new HuggingFaceConfigurationError(
      'This model uses chat completion. Use chat parameters such as max_tokens, temperature, top_p, stop, and seed; max_new_tokens and return_full_text are also supported.',
    );
  }
  const {
    max_new_tokens: maxNewTokens,
    return_full_text: returnFullText,
    ...chatParameters
  } = parameters ?? {};
  if (returnFullText !== undefined && typeof returnFullText !== 'boolean') {
    throw new HuggingFaceConfigurationError(
      'return_full_text must be a boolean.',
    );
  }
  const result = await client.chatCompletion(
    {
      ...chatParameters,
      ...(chatParameters.max_tokens === undefined && maxNewTokens !== undefined
        ? { max_tokens: maxNewTokens }
        : {}),
      model: request.model,
      provider,
      messages: [{ role: 'user', content: request.inputs }],
    },
    options,
  );
  const choice =
    isRecord(result) && Array.isArray(result.choices)
      ? result.choices[0]
      : undefined;
  const message = isRecord(choice) ? choice.message : undefined;
  if (
    !isRecord(message) ||
    typeof message.content !== 'string' ||
    !message.content.trim()
  ) {
    throw new HuggingFaceConfigurationError(
      'The inference provider returned no generated text.',
    );
  }
  // Preserve the existing workflow output contract for downstream nodes.
  return {
    generated_text:
      (returnFullText === true ? request.inputs : '') + message.content,
  };
}
