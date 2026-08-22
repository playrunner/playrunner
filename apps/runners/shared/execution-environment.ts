export const EXECUTION_ENVIRONMENT_LIMITS = Object.freeze({
  keyBytes: 255,
  totalBytes: 512 * 1024,
  valueBytes: 64 * 1024,
  variables: 100,
});

export function assertBoundedExecutionEnvironment(
  environment: Readonly<Record<string, string>>,
  label = 'Injected Environment',
): void {
  const entries = Object.entries(environment);
  if (entries.length > EXECUTION_ENVIRONMENT_LIMITS.variables) {
    throw new Error(
      `${label} contains ${entries.length} variables; the limit is ${EXECUTION_ENVIRONMENT_LIMITS.variables}.`,
    );
  }

  let totalBytes = 0;
  for (const [key, value] of entries) {
    if (value.includes('\0')) {
      throw new Error(`${label} variable ${key} contains a NUL character.`);
    }
    const keyBytes = Buffer.byteLength(key, 'utf8');
    const valueBytes = Buffer.byteLength(value, 'utf8');
    if (keyBytes > EXECUTION_ENVIRONMENT_LIMITS.keyBytes) {
      throw new Error(
        `${label} variable name ${key.slice(0, 100)} exceeds ${EXECUTION_ENVIRONMENT_LIMITS.keyBytes} UTF-8 bytes.`,
      );
    }
    if (valueBytes > EXECUTION_ENVIRONMENT_LIMITS.valueBytes) {
      throw new Error(
        `${label} variable ${key} exceeds ${EXECUTION_ENVIRONMENT_LIMITS.valueBytes} UTF-8 bytes. Store large inputs as workflow artifacts instead.`,
      );
    }
    totalBytes += keyBytes + valueBytes + 2;
    if (totalBytes > EXECUTION_ENVIRONMENT_LIMITS.totalBytes) {
      throw new Error(
        `${label} exceeds ${EXECUTION_ENVIRONMENT_LIMITS.totalBytes} UTF-8 bytes in total. Store large inputs as workflow artifacts instead.`,
      );
    }
  }
}

export function selectExecutionEnvironment(
  keys: readonly unknown[],
  values: Readonly<Record<string, unknown>>,
  label = 'Injected Environment',
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const value of new Set(keys)) {
    if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      throw new Error(`${label} variable name is invalid: ${String(value)}`);
    }
    if (
      /^(?:CODEX_HOME|DOCKER_.+|GCP_PROJECT|HOME|NODE_OPTIONS|PATH|PAYLOAD|PLAYRUNNER_.+|PUBSUB_EMULATOR_HOST)$/i.test(
        value,
      )
    ) {
      throw new Error(`${label} variable name is reserved: ${value}`);
    }
    const selected = values[value];
    environment[value] =
      selected === undefined || selected === null ? '' : String(selected);
  }
  assertBoundedExecutionEnvironment(environment, label);
  return environment;
}
