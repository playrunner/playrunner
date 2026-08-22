const CODEX_CREDENTIAL_VARIABLES = [
  'CODEX_ACCESS_TOKEN',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'PLAYRUNNER_AGENT_BOOTSTRAP',
] as const;

export function createCredentialFreeEnvironment(
  config: Record<string, unknown>,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result = { ...environment };
  const apiKeyEnvVar = String(config.apiKeyEnvVar || '').trim();
  for (const key of [...CODEX_CREDENTIAL_VARIABLES, apiKeyEnvVar]) {
    if (key) delete result[key];
  }
  return result;
}

export function createCodexEnvironment(
  config: Record<string, unknown>,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const apiKeyEnvVar = String(config.apiKeyEnvVar || '').trim();
  const apiKey = apiKeyEnvVar ? environment[apiKeyEnvVar] : undefined;
  if (!apiKey) {
    throw new Error(
      `Codex CLI API key Environment variable ${apiKeyEnvVar || '(not configured)'} is missing or empty.`,
    );
  }
  const codexEnvironment = createCredentialFreeEnvironment(config, environment);
  codexEnvironment.CODEX_API_KEY = apiKey;
  return codexEnvironment;
}
