import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  companionRequest,
  readCredentials,
  waitForCompanionPoll,
  type CompanionDependencies,
} from './companion.js';
import { VERSION } from './version.js';

type WorkerJob = {
  id: string;
  cpu: number;
  memory: number;
  source: string;
  payload: { data: Record<string, unknown>; [key: string]: unknown };
};

const image = `playrunner-local-typescript:${VERSION}`;
const run = (command: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error
        ? reject(
            new Error(
              `${command} failed. Check that it is installed and available.`,
            ),
          )
        : resolve(stdout.trim()),
    );
  });
function option(args: string[], name: string, fallback = '') {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--'))
    throw new Error(`${name} needs a value.`);
  return args[index + 1];
}
export function localWorkerDockerArgs(
  job: Pick<WorkerJob, 'id' | 'cpu' | 'memory' | 'source'>,
  workspace: string | undefined,
  containerName: string,
  imageName: string,
) {
  if (
    !/^[a-f0-9]{64}$/.test(job.id) ||
    !Number.isFinite(job.cpu) ||
    job.cpu < 1 ||
    job.cpu > 32 ||
    !Number.isFinite(job.memory) ||
    job.memory < 1 ||
    job.memory > 64
  )
    throw new Error('Invalid worker assignment.');
  const args = [
    'run',
    '--rm',
    '-i',
    '--init',
    '--name',
    containerName,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '512',
    '--user',
    'pwuser',
    '--cpus',
    String(job.cpu),
    '--memory',
    `${job.memory}g`,
    '--shm-size',
    '1g',
    '--add-host',
    'host.docker.internal:host-gateway',
  ];
  if (job.source === 'workspace') {
    if (!workspace || /[,\r\n]/.test(workspace))
      throw new Error('An explicitly connected local workspace is required.');
    args.push(
      '--mount',
      `type=bind,source=${workspace},target=/playrunner-workspace,readonly`,
    );
  } else if (job.source !== 'workflow') throw new Error('Invalid test source.');
  args.push(imageName);
  return args;
}

async function registry() {
  return JSON.parse(
    await fs.readFile(
      new URL('./runner/versions.json', import.meta.url),
      'utf8',
    ),
  ) as {
    defaultTag: string;
    versions: Array<{ tag: string; npmVersion: string; pythonVersion: string }>;
  };
}

async function prepare(dependencies: CompanionDependencies) {
  await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  const versions = await registry();
  const selected = versions.versions.find(
    (version) => version.tag === versions.defaultTag,
  )!;
  dependencies.stdout(
    `Building the local Playwright image (${selected.tag}). Docker may download the browser image and dependencies.`,
  );
  const directory = fileURLToPath(new URL('./runner/', import.meta.url));
  const child = spawn(
    'docker',
    [
      'build',
      '-t',
      image,
      '--build-arg',
      `PLAYWRIGHT_VERSION=${selected.tag}`,
      '--build-arg',
      `PLAYWRIGHT_NPM_VERSION=${selected.npmVersion}`,
      '-f',
      path.join(directory, 'playwright/Dockerfile.typescript'),
      directory,
    ],
    { stdio: 'inherit', signal: dependencies.signal },
  );
  return await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

export async function runWorkerCommand(
  args: string[],
  dependencies: CompanionDependencies,
): Promise<number | null> {
  if (args[0] !== 'worker') return null;
  if (args[1] === 'prepare') return prepare(dependencies);
  if (args[1] !== 'connect') {
    dependencies.stdout(
      'Usage: playrunner worker prepare | worker connect --url <server> [--workspace <directory>] [--cpu 2] [--memory 4]',
    );
    return args.includes('--help') ? 0 : 1;
  }
  const allowed = new Set(['--url', '--workspace', '--cpu', '--memory']);
  for (let index = 2; index < args.length; index += 2)
    if (!allowed.has(args[index]) || !args[index + 1])
      throw new Error('Unknown or incomplete worker option.');
  const credentials = await readCredentials(dependencies.env);
  if (!credentials)
    throw new Error('Pair this device with playrunner login first.');
  const requestedUrl = option(args, '--url');
  if (
    !requestedUrl ||
    new URL(requestedUrl).origin !== new URL(credentials.url).origin
  )
    throw new Error('Specify --url matching this device pairing.');
  if (
    !/^https:/.test(credentials.url) &&
    !['localhost', '127.0.0.1'].includes(new URL(credentials.url).hostname)
  )
    throw new Error('Remote worker connections require HTTPS.');
  await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  await run('docker', ['image', 'inspect', image]).catch(() => {
    throw new Error(
      'Local runner image is missing. Run playrunner worker prepare first.',
    );
  });
  const workspaceInput = option(args, '--workspace');
  const workspace = workspaceInput
    ? await fs.realpath(path.resolve(workspaceInput))
    : undefined;
  if (
    workspace &&
    (!(await fs.stat(workspace)).isDirectory() ||
      workspace === path.parse(workspace).root ||
      /[,\r\n]/.test(workspace))
  )
    throw new Error('Choose a project directory for the workspace.');
  const cpu = Number(option(args, '--cpu', '2'));
  const memory = Number(option(args, '--memory', '4'));
  if (
    !Number.isInteger(cpu) ||
    cpu < 1 ||
    cpu > 32 ||
    !Number.isInteger(memory) ||
    memory < 1 ||
    memory > 64
  )
    throw new Error('CPU must be 1–32 and memory 1–64 GiB.');
  const version = (await registry()).defaultTag;
  const sessionId = crypto.randomUUID();
  const route = `/api/local-workers/sessions/${sessionId}`;
  const lease = new AbortController();
  const request = (pathname: string, method = 'POST', body: unknown = {}) =>
    companionRequest(
      credentials,
      pathname,
      { method, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) },
      {
        ...dependencies,
        signal: AbortSignal.any([
          dependencies.signal,
          lease.signal,
          AbortSignal.timeout(30_000),
        ]),
      },
    );
  const metadata: Record<string, unknown> = {
    workspace: Boolean(workspace),
    version,
    cpu,
    memory,
  };
  if (workspace) {
    metadata.commit = await run('git', [
      '-C',
      workspace,
      'rev-parse',
      'HEAD',
    ]).catch(() => '');
    metadata.dirty = Boolean(
      await run('git', ['-C', workspace, 'status', '--porcelain']).catch(
        () => 'unknown',
      ),
    );
  }
  await request('/api/local-workers/sessions', 'POST', { sessionId, metadata });
  dependencies.stdout(
    `Local test worker connected to ${new URL(credentials.url).origin}; one test step at a time, ${cpu} CPU / ${memory} GiB.${workspace ? ' The selected checkout is available read-only.' : ''}`,
  );
  dependencies.stdout(
    'For an application running on this computer, use http://host.docker.internal:<port> as its test base URL.',
  );
  let active: { id: string; container: string; stop: () => void } | undefined;
  let heartbeatRunning = false;
  let lastHeartbeat = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastHeartbeat > 40_000) {
      active?.stop();
      lease.abort(new Error('Worker connection lost. Reconnect explicitly.'));
    }
  }, 1_000);
  const heartbeat = setInterval(() => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;
    void request(`${route}/heartbeat`)
      .then(async () => {
        lastHeartbeat = Date.now();
        if (active) {
          const job = await request(
            `/api/local-workers/jobs/${active.id}`,
            'GET',
          );
          if (['cancelled', 'expired', 'failed'].includes(String(job.status)))
            active.stop();
        }
      })
      .catch(() => {
        if (Date.now() - lastHeartbeat > 40_000) active?.stop();
      })
      .finally(() => {
        heartbeatRunning = false;
      });
  }, 10_000);
  const stop = () => active?.stop();
  dependencies.signal.addEventListener('abort', stop, { once: true });
  try {
    while (!dependencies.signal.aborted) {
      if (Date.now() - lastHeartbeat > 40_000)
        throw new Error(
          'Worker connection lost. Tests stopped; reconnect explicitly.',
        );
      const result = await request(`${route}/claim`);
      const job = result.job as WorkerJob | null;
      if (!job) {
        await waitForCompanionPoll(2_000, dependencies.signal);
        continue;
      }
      if (workspace && job.source === 'workspace') {
        job.payload.data.localSource = {
          commit: await run('git', [
            '-C',
            workspace,
            'rev-parse',
            'HEAD',
          ]).catch(() => null),
          dirty: Boolean(
            await run('git', ['-C', workspace, 'status', '--porcelain']).catch(
              () => 'unknown',
            ),
          ),
          platform: `${process.platform}/${process.arch}`,
        };
      }
      const container = `playrunner-device-${sessionId}-${job.id.slice(0, 12)}`;
      const dockerArgs = localWorkerDockerArgs(
        job,
        workspace,
        container,
        image,
      );
      // Transport credentials remain in stdin, never process arguments or host environment.
      const child = spawn('docker', dockerArgs, {
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      let stopping = false;
      const stopContainer = () => {
        if (stopping) return;
        stopping = true;
        void run('docker', ['rm', '-f', container]).catch(() => undefined);
      };
      active = { id: job.id, container, stop: stopContainer };
      const finished = new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => resolve(code ?? 1));
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(JSON.stringify(job.payload));
      dependencies.stdout(
        `Running local test step ${job.payload.data.nodeId}.`,
      );
      try {
        const code = await finished;
        await request(`/api/local-workers/jobs/${job.id}`, 'POST', {
          status: code === 0 && !stopping ? 'finished' : 'failed',
        });
        dependencies.stdout(
          code === 0 && !stopping
            ? 'Local step finished; inspect Cloud results for test outcomes.'
            : 'Local step interrupted or failed; inspect Cloud results.',
        );
      } finally {
        stopContainer();
        active = undefined;
      }
    }
  } finally {
    clearInterval(heartbeat);
    clearInterval(watchdog);
    dependencies.signal.removeEventListener('abort', stop);
    active?.stop();
    // Shutdown gets its own bounded signal so Ctrl-C can still disconnect the session.
    await companionRequest(
      credentials,
      route,
      { method: 'DELETE', body: '{}' },
      { ...dependencies, signal: AbortSignal.timeout(5_000) },
    ).catch(() => undefined);
  }
  return 0;
}
