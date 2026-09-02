import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type AuthenticationSuccessCondition = {
  type: 'element_visible' | 'url_exact' | 'url_prefix';
  value: string;
};

export type NativeAuthenticationBrowser = {
  executablePath: string;
  process: ChildProcess;
  profileDirectory: string;
};

const CLOSE_TIMEOUT_MS = 5_000;

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
  options: { keepProcessAlive?: boolean } = {},
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
      await waitForNativeBrowserClosePoll(50, options.keepProcessAlive);
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
  if (!(await waitForExit(CLOSE_TIMEOUT_MS))) {
    await signalTree(true);
    await waitForExit(1_000);
  }
}

export function waitForNativeBrowserClosePoll(
  milliseconds: number,
  keepProcessAlive = false,
) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    if (!keepProcessAlive) timer.unref();
  });
}

export function removeNativeBrowserProfile(profileDirectory: string) {
  fs.rmSync(profileDirectory, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 100,
  });
}

async function conditionReached(
  page: import('playwright').Page,
  condition: AuthenticationSuccessCondition,
) {
  if (condition.type === 'element_visible') {
    return page
      .locator(condition.value)
      .isVisible()
      .catch(() => false);
  }
  const currentUrl = page.url();
  return condition.type === 'url_exact'
    ? currentUrl === condition.value
    : currentUrl.startsWith(condition.value);
}

async function waitForCondition(
  page: import('playwright').Page,
  condition: AuthenticationSuccessCondition,
  timeout: number,
) {
  if (condition.type === 'element_visible') {
    await page.locator(condition.value).waitFor({
      state: 'visible',
      timeout,
    });
    return;
  }
  await page.waitForURL(
    (url) =>
      condition.type === 'url_exact'
        ? url.toString() === condition.value
        : url.toString().startsWith(condition.value),
    { timeout },
  );
}

export async function testAuthenticationState(args: {
  env?: NodeJS.ProcessEnv;
  startUrl: string;
  state: unknown;
  successCondition: AuthenticationSuccessCondition;
  timeoutMs?: number;
}) {
  if (
    !args.state ||
    typeof args.state !== 'object' ||
    !Array.isArray((args.state as { cookies?: unknown }).cookies) ||
    !Array.isArray((args.state as { origins?: unknown }).origins)
  ) {
    throw new Error('Authentication Profile test state is invalid.');
  }
  type StorageState = Exclude<
    NonNullable<
      Parameters<import('playwright').Browser['newContext']>[0]
    >['storageState'],
    string
  >;
  const { chromium } = await import('playwright');
  const executablePath = nativeBrowserExecutableCandidates(args.env).find(
    (candidate) => !path.isAbsolute(candidate) || fs.existsSync(candidate),
  );
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: args.env?.PLAYRUNNER_AUTHENTICATION_HEADLESS === 'true',
  });
  try {
    const context = await browser.newContext({
      storageState: args.state as StorageState,
    });
    const page = await context.newPage();
    await page.goto(args.startUrl, {
      timeout: args.timeoutMs || 60_000,
      waitUntil: 'domcontentloaded',
    });
    await waitForCondition(
      page,
      args.successCondition,
      args.timeoutMs || 60_000,
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function isChromeRestoreTargetError(error: unknown) {
  return (
    error instanceof Error &&
    /Target\.createTarget|Failed to open a new tab/i.test(error.message)
  );
}

async function waitForRestoredPage(page: import('playwright').Page) {
  await page
    .waitForLoadState('domcontentloaded', { timeout: 15_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.readyState).catch(() => undefined);
}

export async function captureRestoredBrowserStorage(
  context: import('playwright').BrowserContext,
  page: import('playwright').Page,
) {
  await waitForRestoredPage(page);
  try {
    return await context.storageState({ indexedDB: true });
  } catch (error) {
    if (!isChromeRestoreTargetError(error)) throw error;

    // Chrome can still be restoring the native session when Playwright first
    // attaches. During that window storageState may fail to inspect the
    // restored page and then Chrome rejects its fallback temporary tab.
    await page.waitForTimeout(500);
    await waitForRestoredPage(page);
    return context.storageState({ indexedDB: true });
  }
}

export async function captureAuthenticationState(args: {
  confirm: () => Promise<void>;
  env?: NodeJS.ProcessEnv;
  startUrl: string;
  successCondition: AuthenticationSuccessCondition;
  timeoutMs?: number;
}) {
  const profileDirectory = createNativeBrowserProfile();
  let nativeBrowser: NativeAuthenticationBrowser | undefined;
  let context: import('playwright').BrowserContext | undefined;
  try {
    nativeBrowser = await launchNativeAuthenticationBrowser({
      env: args.env,
      profileDirectory,
      startUrl: args.startUrl,
    });
    await args.confirm();
    const executablePath = nativeBrowser.executablePath;
    await closeNativeAuthenticationBrowser(nativeBrowser, {
      keepProcessAlive: true,
    });
    nativeBrowser = undefined;

    const { chromium } = await import('playwright');
    context = await chromium.launchPersistentContext(profileDirectory, {
      args: ['--restore-last-session'],
      executablePath,
      headless: args.env?.PLAYRUNNER_AUTHENTICATION_HEADLESS === 'true',
      ignoreDefaultArgs: ['--password-store=basic', '--use-mock-keychain'],
      timeout: 15_000,
    });
    const pages = context.pages();
    let page = pages[0] || (await context.newPage());
    let successful = false;
    for (const candidate of pages) {
      if (await conditionReached(candidate, args.successCondition)) {
        page = candidate;
        successful = true;
        break;
      }
    }
    if (!successful) {
      await page.goto(args.startUrl, {
        timeout: args.timeoutMs || 60_000,
        waitUntil: 'domcontentloaded',
      });
      await waitForCondition(
        page,
        args.successCondition,
        args.timeoutMs || 60_000,
      );
    }
    return captureRestoredBrowserStorage(context, page);
  } finally {
    if (context) await context.close().catch(() => undefined);
    if (nativeBrowser) {
      await closeNativeAuthenticationBrowser(nativeBrowser, {
        keepProcessAlive: true,
      }).catch(() => undefined);
    }
    removeNativeBrowserProfile(profileDirectory);
  }
}
