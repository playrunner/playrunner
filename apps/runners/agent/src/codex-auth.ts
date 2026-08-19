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
  return { ...environment, CODEX_API_KEY: apiKey };
}
