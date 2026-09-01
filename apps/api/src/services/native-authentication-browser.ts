import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type NativeAuthenticationBrowser = {
  executablePath: string;
  process: ChildProcess;
  profileDirectory: string;
};

const NATIVE_BROWSER_CLOSE_TIMEOUT_MS = 5_000;

export function createNativeBrowserProfile() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'playrunner-native-auth-'),
  );
  fs.chmodSync(directory, 0o700);
  const defaultProfile = path.join(directory, 'Default');
  fs.mkdirSync(defaultProfile, { mode: 0o700 });
  fs.writeFileSync(
    path.join(defaultProfile, 'Preferences'),
    JSON.stringify({
      profile: { exit_type: 'Normal' },
      session: { restore_on_startup: 1 },
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  return directory;
}

export function nativeBrowserArguments(args: {
  headless?: boolean;
  profileDirectory: string;
  startUrl: string;
}) {
  return [
    `--user-data-dir=${args.profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--new-window',
    ...(args.headless ? ['--headless=new'] : []),
    args.startUrl,
  ];
}

export function nativeBrowserExecutableCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  const configured =
    env.PLAYRUNNER_AUTHENTICATION_BROWSER_EXECUTABLE_PATH?.trim();
  if (configured) return [configured];

  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  if (platform === 'win32') {
    return [
      env.LOCALAPPDATA &&
        path.join(
          env.LOCALAPPDATA,
          'Google',
          'Chrome',
          'Application',
          'chrome.exe',
        ),
      env.PROGRAMFILES &&
        path.join(
          env.PROGRAMFILES,
          'Google',
          'Chrome',
          'Application',
          'chrome.exe',
        ),
      env['PROGRAMFILES(X86)'] &&
        path.join(
          env['PROGRAMFILES(X86)'],
          'Google',
          'Chrome',
          'Application',
          'chrome.exe',
        ),
    ].filter((candidate): candidate is string => Boolean(candidate));
  }
  return [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ];
}

function launchCandidate(executablePath: string, args: string[]) {
  return new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn(executablePath, args, {
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      windowsHide: false,
    });
    const onError = (error: Error) => {
      child.off('spawn', onSpawn);
      reject(error);
    };
    const onSpawn = () => {
      child.off('error', onError);
      resolve(child);
    };
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}

export async function launchNativeAuthenticationBrowser(args: {
  env?: NodeJS.ProcessEnv;
  headless?: boolean;
  profileDirectory: string;
  startUrl: string;
}) {
  const launchArgs = nativeBrowserArguments(args);
  const candidates = nativeBrowserExecutableCandidates(args.env);
  let lastError: unknown;
  for (const executablePath of candidates) {
    if (path.isAbsolute(executablePath) && !fs.existsSync(executablePath)) {
      continue;
    }
    try {
      return {
        executablePath,
        process: await launchCandidate(executablePath, launchArgs),
        profileDirectory: args.profileDirectory,
      } satisfies NativeAuthenticationBrowser;
    } catch (error) {
      lastError = error;
    }
  }
  throw Object.assign(
    new Error(
      'Google Chrome or Chromium could not be launched for native authentication.',
      { cause: lastError },
    ),
    { code: 'native_authentication_browser_unavailable', statusCode: 503 },
  );
}

export async function closeNativeAuthenticationBrowser(
  browser: NativeAuthenticationBrowser,
) {
  const pid = browser.process.pid;
  if (!pid) return;

  const isRunning = () => {
    try {
      process.kill(process.platform === 'win32' ? pid : -pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitForExit = async (timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (isRunning() && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        timer.unref();
      });
    }
    return !isRunning();
  };
  const signalTree = async (force: boolean) => {
    if (process.platform !== 'win32') {
      try {
        if (force) process.kill(-pid, 'SIGKILL');
        else browser.process.kill('SIGTERM');
      } catch {
        browser.process.kill(force ? 'SIGKILL' : 'SIGTERM');
      }
      return;
    }
    await new Promise<void>((resolve) => {
      const taskkill = spawn(
        'taskkill',
        ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
        { stdio: 'ignore', windowsHide: true },
      );
      taskkill.once('error', () => resolve());
      taskkill.once('exit', () => resolve());
    });
  };

  if (!isRunning()) return;
  await signalTree(false);
  if (!(await waitForExit(NATIVE_BROWSER_CLOSE_TIMEOUT_MS))) {
    await signalTree(true);
    await waitForExit(1_000);
  }
}

export function removeNativeBrowserProfile(profileDirectory: string) {
  fs.rmSync(profileDirectory, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 100,
  });
}
