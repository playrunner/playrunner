import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { captureAuthenticationState } from './authentication-capture.js';

const VERSION = '0.2.0';
const DEFAULT_URL = 'https://playrunner.cloud';
const POLL_TIMEOUT_MS = 25_000;

type DeviceCredentials = {
  deviceId: string;
  privateKey: string;
  publicKey: string;
  refreshToken: string;
  url: string;
};

type CompanionDependencies = {
  env: NodeJS.ProcessEnv;
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
  stderr: (line: string) => void;
  stdout: (line: string) => void;
};

function configDirectory(env: NodeJS.ProcessEnv) {
  if (process.platform === 'win32') {
    return path.join(env.APPDATA || os.homedir(), 'Playrunner');
  }
  return path.join(
    env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'playrunner',
  );
}

function credentialPath(env: NodeJS.ProcessEnv) {
  return path.join(configDirectory(env), 'companion.json');
}

async function writeCredentials(
  credentials: DeviceCredentials,
  env: NodeJS.ProcessEnv,
) {
  const directory = configDirectory(env);
  await fs.mkdir(directory, { mode: 0o700, recursive: true });
  const target = credentialPath(env);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(credentials)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(temporary, target);
  await fs.chmod(target, 0o600).catch(() => undefined);
}

async function readCredentials(env: NodeJS.ProcessEnv) {
  try {
    return JSON.parse(
      await fs.readFile(credentialPath(env), 'utf8'),
    ) as DeviceCredentials;
  } catch {
    return null;
  }
}

async function removeCredentials(env: NodeJS.ProcessEnv) {
  await fs.rm(credentialPath(env), { force: true });
}

function normalizedUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('The Playrunner URL must use HTTP or HTTPS.');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

async function jsonResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw Object.assign(
      new Error(
        typeof payload.error === 'string'
          ? payload.error
          : `Playrunner Cloud returned HTTP ${response.status}.`,
      ),
      { code: payload.code, statusCode: response.status },
    );
  }
  return payload;
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Cancelled.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    timer.unref();
  });
}

function openBrowser(url: string) {
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '', url] }
        : { file: 'xdg-open', args: [url] };
  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function requestSignature(args: {
  body: string;
  method: string;
  pathname: string;
  privateKey: string;
  nonce: string;
  timestamp: string;
}) {
  const digest = crypto.createHash('sha256').update(args.body).digest('hex');
  const message = [
    args.method.toUpperCase(),
    args.pathname,
    args.timestamp,
    args.nonce,
    digest,
  ].join('\n');
  return crypto
    .sign(null, Buffer.from(message), args.privateKey)
    .toString('base64');
}

async function companionRequest(
  credentials: DeviceCredentials,
  pathname: string,
  init: RequestInit,
  dependencies: CompanionDependencies,
) {
  const method = (init.method || 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : '';
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${credentials.refreshToken}`);
  headers.set('content-type', 'application/json');
  headers.set('x-playrunner-device-id', credentials.deviceId);
  headers.set('x-playrunner-device-nonce', nonce);
  headers.set('x-playrunner-device-timestamp', timestamp);
  headers.set(
    'x-playrunner-device-signature',
    requestSignature({
      body,
      method,
      nonce,
      pathname,
      privateKey: credentials.privateKey,
      timestamp,
    }),
  );
  return jsonResponse(
    await dependencies.fetch(`${credentials.url}${pathname}`, {
      ...init,
      headers,
      signal: dependencies.signal,
    }),
  );
}

async function login(args: string[], dependencies: CompanionDependencies) {
  const urlIndex = args.indexOf('--url');
  const url = normalizedUrl(
    urlIndex >= 0
      ? String(args[urlIndex + 1] || '')
      : dependencies.env.PLAYRUNNER_URL || DEFAULT_URL,
  );
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const created = await jsonResponse(
    await dependencies.fetch(`${url}/api/auth-companion/device-codes`, {
      body: JSON.stringify({
        capabilities: ['authentication_profile_capture_v1'],
        cliVersion: VERSION,
        deviceName: os.hostname().slice(0, 120),
        platform: `${process.platform}/${process.arch}`,
        publicKey: publicKeyPem,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: dependencies.signal,
    }),
  );
  const deviceCode = String(created.deviceCode || '');
  const userCode = String(created.userCode || '');
  const verificationUri = String(created.verificationUri || '');
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error('Playrunner Cloud returned an invalid device code.');
  }
  dependencies.stdout(`Pairing code: ${userCode}`);
  dependencies.stdout(`Open ${verificationUri} to approve this device.`);
  openBrowser(verificationUri);

  const deadline = Date.now() + Number(created.expiresIn || 600) * 1_000;
  while (Date.now() < deadline) {
    await wait(Number(created.interval || 3) * 1_000, dependencies.signal);
    const response = await dependencies.fetch(
      `${url}/api/auth-companion/device-codes/${encodeURIComponent(deviceCode)}/token`,
      { method: 'POST', signal: dependencies.signal },
    );
    if (response.status === 428) continue;
    const token = await jsonResponse(response);
    const credentials: DeviceCredentials = {
      deviceId: String(token.deviceId || ''),
      privateKey: privateKeyPem,
      publicKey: publicKeyPem,
      refreshToken: String(token.refreshToken || ''),
      url,
    };
    if (!credentials.deviceId || !credentials.refreshToken) {
      throw new Error('Playrunner Cloud returned invalid device credentials.');
    }
    await writeCredentials(credentials, dependencies.env);
    dependencies.stdout(
      `Paired ${os.hostname()} with Playrunner Cloud. Run "playrunner auth connect" to accept authentication requests.`,
    );
    return 0;
  }
  throw new Error('The pairing code expired. Run playrunner login again.');
}

async function promptForCapture(stdout: (line: string) => void) {
  stdout(
    'Complete sign-in in the visible browser, leave it open, then press Enter here.',
  );
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    await prompt.question('');
  } finally {
    prompt.close();
  }
}

async function processCommand(
  credentials: DeviceCredentials,
  command: Record<string, unknown>,
  dependencies: CompanionDependencies,
) {
  const sessionId = String(command.sessionId || '');
  const pathPrefix = `/api/auth-companion/sessions/${encodeURIComponent(sessionId)}`;
  await companionRequest(
    credentials,
    `${pathPrefix}/ack`,
    { body: '{}', method: 'POST' },
    dependencies,
  );
  await companionRequest(
    credentials,
    `${pathPrefix}/status`,
    { body: JSON.stringify({ status: 'awaiting_user' }), method: 'POST' },
    dependencies,
  );
  try {
    const state = await captureAuthenticationState({
      confirm: () => promptForCapture(dependencies.stdout),
      env: dependencies.env,
      startUrl: String(command.startUrl || ''),
      successCondition: command.successCondition as {
        type: 'element_visible' | 'url_exact' | 'url_prefix';
        value: string;
      },
    });
    await companionRequest(
      credentials,
      `${pathPrefix}/state`,
      {
        body: JSON.stringify({
          nonce: command.uploadNonce,
          state,
          uploadToken: command.uploadToken,
        }),
        method: 'POST',
      },
      dependencies,
    );
    dependencies.stdout('Authentication Profile capture completed.');
  } catch (error) {
    await companionRequest(
      credentials,
      `${pathPrefix}/status`,
      {
        body: JSON.stringify({
          errorCode: 'capture_failed',
          status: 'failed',
        }),
        method: 'POST',
      },
      dependencies,
    ).catch(() => undefined);
    throw error;
  }
}

async function connect(dependencies: CompanionDependencies) {
  const credentials = await readCredentials(dependencies.env);
  if (!credentials) {
    throw new Error('This device is not paired. Run playrunner login first.');
  }
  dependencies.stdout('Playrunner authentication companion is connected.');
  let cursor = '0';
  while (!dependencies.signal.aborted) {
    try {
      const pathname = `/api/auth-companion/commands?cursor=${encodeURIComponent(cursor)}&timeout=${POLL_TIMEOUT_MS}`;
      const payload = await companionRequest(
        credentials,
        pathname,
        { method: 'GET' },
        dependencies,
      );
      cursor = String(payload.nextCursor || cursor);
      const commands = Array.isArray(payload.commands) ? payload.commands : [];
      for (const command of commands) {
        await processCommand(
          credentials,
          command as Record<string, unknown>,
          dependencies,
        );
      }
    } catch (error) {
      if (dependencies.signal.aborted) break;
      dependencies.stderr(
        `Companion connection interrupted: ${error instanceof Error ? error.message : 'unknown error'}. Retrying…`,
      );
      await wait(2_000, dependencies.signal).catch(() => undefined);
    }
  }
  return 0;
}

function serviceDefinition(env: NodeJS.ProcessEnv) {
  const executable = process.argv[1] || 'playrunner';
  const directory = configDirectory(env);
  if (process.platform === 'darwin') {
    const target = path.join(
      os.homedir(),
      'Library',
      'LaunchAgents',
      'cloud.playrunner.auth-companion.plist',
    );
    return {
      target,
      contents: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>cloud.playrunner.auth-companion</string><key>ProgramArguments</key><array><string>${process.execPath}</string><string>${executable}</string><string>auth</string><string>connect</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${directory}/companion.log</string><key>StandardErrorPath</key><string>${directory}/companion-error.log</string></dict></plist>\n`,
      start: ['launchctl', ['bootstrap', `gui/${process.getuid?.()}`, target]],
    } as const;
  }
  if (process.platform === 'win32') {
    return {
      target: path.join(directory, 'companion.cmd'),
      contents: `@echo off\r\n"${process.execPath}" "${executable}" auth connect\r\n`,
      start: [
        'schtasks',
        [
          '/Create',
          '/F',
          '/SC',
          'ONLOGON',
          '/TN',
          'Playrunner Authentication Companion',
          '/TR',
          `"${process.execPath}" "${executable}" auth connect`,
        ],
      ],
    } as const;
  }
  const target = path.join(
    os.homedir(),
    '.config',
    'systemd',
    'user',
    'playrunner-auth-companion.service',
  );
  return {
    target,
    contents: `[Unit]\nDescription=Playrunner Authentication Companion\nAfter=network-online.target\n\n[Service]\nExecStart=${process.execPath} ${executable} auth connect\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`,
    start: [
      'systemctl',
      ['--user', 'enable', '--now', 'playrunner-auth-companion.service'],
    ],
  } as const;
}

async function install(dependencies: CompanionDependencies) {
  if (!(await readCredentials(dependencies.env))) {
    throw new Error('This device is not paired. Run playrunner login first.');
  }
  const service = serviceDefinition(dependencies.env);
  await fs.mkdir(path.dirname(service.target), {
    mode: 0o700,
    recursive: true,
  });
  await fs.writeFile(service.target, service.contents, { mode: 0o600 });
  await new Promise<void>((resolve, reject) => {
    execFile(service.start[0], [...service.start[1]], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  dependencies.stdout('Installed and started the authentication companion.');
  return 0;
}

async function status(dependencies: CompanionDependencies) {
  const credentials = await readCredentials(dependencies.env);
  if (!credentials) {
    dependencies.stdout('Not paired.');
    return 1;
  }
  const payload = await companionRequest(
    credentials,
    '/api/auth-companion/devices/me',
    { method: 'GET' },
    dependencies,
  );
  dependencies.stdout(
    `${payload.revokedAt ? 'Revoked' : 'Paired'}: ${String(payload.name || credentials.deviceId)}${payload.online ? ' (online)' : ' (offline)'}`,
  );
  return payload.revokedAt ? 1 : 0;
}

async function disconnect(dependencies: CompanionDependencies) {
  const credentials = await readCredentials(dependencies.env);
  if (credentials) {
    await companionRequest(
      credentials,
      '/api/auth-companion/devices/me/revoke',
      { body: '{}', method: 'POST' },
      dependencies,
    ).catch(() => undefined);
  }
  await removeCredentials(dependencies.env);
  dependencies.stdout('Disconnected this device from Playrunner Cloud.');
  return 0;
}

export async function runCompanionCommand(
  args: string[],
  dependencies: CompanionDependencies,
) {
  if (args[0] === 'login') return login(args.slice(1), dependencies);
  if (args[0] !== 'auth') return null;
  if (args[1] === 'connect') return connect(dependencies);
  if (args[1] === 'install') return install(dependencies);
  if (args[1] === 'status') return status(dependencies);
  if (args[1] === 'disconnect') return disconnect(dependencies);
  dependencies.stdout(
    'Usage: playrunner auth <connect|install|status|disconnect>',
  );
  return args[1] === '--help' || args[1] === '-h' ? 0 : 1;
}
