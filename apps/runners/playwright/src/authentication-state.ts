import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AUTHENTICATION_ENVELOPE_MAX_BYTES,
  createAuthenticationEnvelopeKeyPair,
  openAuthenticationEnvelope,
  type AuthenticationEnvelope,
} from '../../shared/authentication-envelope';

const MAX_AUTHENTICATION_STATE_BYTES = 5 * 1024 * 1024;

export type PreparedAuthenticationState = {
  cleanup: () => void;
  configPath?: string;
  environment: NodeJS.ProcessEnv;
  pythonPlugin?: string;
  statePath: string;
};

export async function fetchAuthenticationState(args: {
  editorApiUrl: string;
  executionId: string;
  executionToken: string;
  fetcher?: typeof fetch;
  nodeId: string;
}) {
  const keys = createAuthenticationEnvelopeKeyPair();
  const fetcher = args.fetcher || fetch;
  const response = await fetcher(
    `${args.editorApiUrl.replace(/\/+$/, '')}/api/outputs/${encodeURIComponent(args.executionId)}/${encodeURIComponent(args.nodeId)}/authentication-state`,
    {
      body: JSON.stringify({ recipientPublicKey: keys.publicKey }),
      headers: {
        'Content-Type': 'application/json',
        'x-execution-token': args.executionToken,
      },
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Authentication Profile delivery failed with status ${response.status}.`,
    );
  }
  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (responseBytes.length > AUTHENTICATION_ENVELOPE_MAX_BYTES) {
    throw new Error('Authentication Profile delivery response is too large.');
  }
  let envelope: AuthenticationEnvelope;
  try {
    envelope = JSON.parse(responseBytes.toString('utf8')).envelope;
  } catch {
    throw new Error('Authentication Profile delivery response is invalid.');
  }
  const plaintext = openAuthenticationEnvelope({
    envelope,
    executionId: args.executionId,
    nodeId: args.nodeId,
    recipientPrivateKey: keys.privateKey,
  });
  try {
    return JSON.parse(plaintext.toString('utf8')) as unknown;
  } finally {
    plaintext.fill(0);
  }
}

function assertAuthenticationState(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Authentication Profile state is invalid.');
  }
  const state = value as Record<string, unknown>;
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error('Authentication Profile state is invalid.');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_AUTHENTICATION_STATE_BYTES) {
    throw new Error('Authentication Profile state is too large.');
  }
  return serialized;
}

function writeProtectedFile(filePath: string, contents: string) {
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
    0o600,
  );
  try {
    fs.writeFileSync(descriptor, contents, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function findTypescriptConfig(workingDir: string) {
  return [
    'playwright.service.config.ts',
    'playwright.config.ts',
    'playwright.config.mts',
    'playwright.config.cts',
    'playwright.config.js',
    'playwright.config.mjs',
    'playwright.config.cjs',
  ].find((candidate) => fs.existsSync(path.join(workingDir, candidate)));
}

function createTypescriptConfig(workingDir: string, statePath: string) {
  const baseConfig = findTypescriptConfig(workingDir);
  const fileName = `.playrunner-auth-${crypto.randomUUID()}.config.ts`;
  const configPath = path.join(workingDir, fileName);
  const stateLiteral = JSON.stringify(statePath);
  const contents = baseConfig
    ? `import baseConfig from ${JSON.stringify(`./${baseConfig}`)};

const sharedUse = { ...(baseConfig.use || {}), storageState: ${stateLiteral} };
const projects = Array.isArray(baseConfig.projects)
  ? baseConfig.projects.map((project) => ({
      ...project,
      use: {
        ...(baseConfig.use || {}),
        ...(project.use || {}),
        storageState: ${stateLiteral},
      },
    }))
  : undefined;

export default {
  ...baseConfig,
  use: sharedUse,
  ...(projects ? { projects } : {}),
};
`
    : `export default {
  testDir: '.',
  use: { storageState: ${stateLiteral} },
};
`;
  writeProtectedFile(configPath, contents);
  return configPath;
}

function createPythonPlugin(directory: string) {
  const moduleName = `playrunner_auth_${crypto.randomUUID().replaceAll('-', '_')}`;
  const pluginPath = path.join(directory, `${moduleName}.py`);
  writeProtectedFile(
    pluginPath,
    `import os
import pytest

@pytest.fixture
def browser_context_args(browser_context_args):
    return {
        **browser_context_args,
        "storage_state": os.environ["PLAYRUNNER_AUTH_STATE_PATH"],
    }
`,
  );
  return moduleName;
}

export function prepareAuthenticationState(args: {
  runtime: 'python' | 'typescript';
  state: unknown;
  workingDir: string;
}): PreparedAuthenticationState {
  const serialized = assertAuthenticationState(args.state);
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-auth-state-'),
  );
  fs.chmodSync(directory, 0o700);
  const statePath = path.join(directory, 'storage-state.json');
  writeProtectedFile(statePath, serialized);

  let configPath: string | undefined;
  let pythonPlugin: string | undefined;
  try {
    if (args.runtime === 'typescript') {
      configPath = createTypescriptConfig(args.workingDir, statePath);
    } else {
      pythonPlugin = createPythonPlugin(directory);
    }
  } catch (error) {
    fs.rmSync(directory, { force: true, recursive: true });
    throw error;
  }

  return {
    cleanup: () => {
      if (configPath) fs.rmSync(configPath, { force: true });
      fs.rmSync(directory, { force: true, recursive: true });
    },
    configPath,
    environment: {
      PLAYRUNNER_AUTH_STATE_PATH: statePath,
      ...(pythonPlugin
        ? {
            PYTHONPATH: [directory, process.env.PYTHONPATH]
              .filter(Boolean)
              .join(path.delimiter),
          }
        : {}),
    },
    pythonPlugin,
    statePath,
  };
}
