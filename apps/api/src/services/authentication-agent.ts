import crypto from 'node:crypto';
import {
  closeNativeAuthenticationBrowser,
  createNativeBrowserProfile,
  launchNativeAuthenticationBrowser,
  removeNativeBrowserProfile,
  type NativeAuthenticationBrowser,
} from './native-authentication-browser';
import {
  recordAuthenticationProfileAudit,
  requireOwnedAuthenticationProfile,
  resolveAuthenticationState,
  setAuthenticationProfileStatus,
  storeAuthenticationState,
  type AuthenticationSuccessConditionType,
} from './authentication-profiles';

type AuthenticationSessionStatus =
  | 'browser_launched'
  | 'cancelled'
  | 'capturing'
  | 'completed'
  | 'failed'
  | 'started'
  | 'timed_out';

type AuthenticationSession = {
  actorId: string;
  browser?: { close: () => Promise<void> };
  capturePhase?: string;
  continueCapture?: () => void;
  createdAt: string;
  error?: string;
  id: string;
  mode: 'authenticate' | 'test';
  nativeBrowser?: NativeAuthenticationBrowser;
  nativeBrowserClosing?: boolean;
  previousProfileStatus?:
    | 'authenticated'
    | 'expired'
    | 'needs_reauth'
    | 'revoked'
    | 'unauthenticated';
  profileDirectory?: string;
  profileId: string;
  status: AuthenticationSessionStatus;
  updatedAt: string;
};

type AuthenticationProfileRecord = Awaited<
  ReturnType<typeof requireOwnedAuthenticationProfile>
>;

const SESSION_TIMEOUT_MS = 10 * 60 * 1_000;
const CAPTURE_TIMEOUT_MS = 60_000;
const SESSION_RETENTION_MS = 60 * 60 * 1_000;
const ACTIVE_SESSION_STATUSES: AuthenticationSessionStatus[] = [
  'started',
  'browser_launched',
  'capturing',
];

function safeSession(session: AuthenticationSession) {
  return {
    createdAt: session.createdAt,
    capturePhase: session.capturePhase,
    error: session.error,
    id: session.id,
    mode: session.mode,
    profileId: session.profileId,
    status: session.status,
    updatedAt: session.updatedAt,
  };
}

function safeAuthenticationError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/timeout/i.test(message)) {
    return 'Authentication did not reach the success condition before the session timed out.';
  }
  if (
    /closed|target page|browser has been closed|native browser exited/i.test(
      message,
    )
  ) {
    return 'The authentication browser was closed before authentication completed.';
  }
  if (/could not be launched/i.test(message)) {
    return 'Google Chrome or Chromium could not be launched. Install Chrome or configure the browser executable path.';
  }
  return 'Authentication could not be completed. Try again from the profile.';
}

function isEnabled() {
  const configured = process.env.PLAYRUNNER_LOCAL_AUTHENTICATION_ENABLED;
  if (configured !== undefined) return configured === 'true';
  return !process.env.K_SERVICE;
}

function isHeadlessTestMode() {
  return process.env.PLAYRUNNER_AUTHENTICATION_HEADLESS === 'true';
}

async function launchPlaywrightBrowser() {
  const { chromium } = await import('playwright');
  const executablePath =
    process.env.PLAYRUNNER_AUTHENTICATION_BROWSER_EXECUTABLE_PATH?.trim();
  const channel =
    process.env.PLAYRUNNER_AUTHENTICATION_BROWSER_CHANNEL?.trim() || 'chrome';
  if (executablePath) {
    return chromium.launch({
      executablePath,
      headless: isHeadlessTestMode(),
    });
  }
  try {
    return await chromium.launch({ channel, headless: isHeadlessTestMode() });
  } catch (channelError) {
    if (process.env.PLAYRUNNER_AUTHENTICATION_BROWSER_CHANNEL) {
      throw channelError;
    }
    return chromium.launch({ headless: isHeadlessTestMode() });
  }
}

async function waitForSuccess(args: {
  page: any;
  timeout: number;
  type: AuthenticationSuccessConditionType;
  value: string;
}) {
  if (args.type === 'element_visible') {
    await args.page.locator(args.value).waitFor({
      state: 'visible',
      timeout: args.timeout,
    });
    return;
  }
  await args.page.waitForURL(
    (url: URL) =>
      args.type === 'url_exact'
        ? url.toString() === args.value
        : url.toString().startsWith(args.value),
    { timeout: args.timeout },
  );
}

async function successAlreadyReached(args: {
  page: any;
  type: AuthenticationSuccessConditionType;
  value: string;
}) {
  if (args.type === 'element_visible') {
    return args.page
      .locator(args.value)
      .isVisible()
      .catch(() => false);
  }
  const currentUrl = args.page.url();
  return args.type === 'url_exact'
    ? currentUrl === args.value
    : currentUrl.startsWith(args.value);
}

class LocalAuthenticationAgent {
  private readonly sessions = new Map<string, AuthenticationSession>();

  availability() {
    return {
      available: isEnabled(),
      capability: 'interactive_auth_v2',
      interaction: 'native_browser_handoff',
      method: 'local_agent',
    };
  }

  async start(
    actorId: string,
    profileId: string,
    mode: 'authenticate' | 'test',
  ) {
    if (!isEnabled()) {
      throw Object.assign(
        new Error(
          'Local interactive authentication is unavailable on this Playrunner API.',
        ),
        { code: 'authentication_agent_unavailable', statusCode: 503 },
      );
    }
    const profile = await requireOwnedAuthenticationProfile(actorId, profileId);
    const active = [...this.sessions.values()].find(
      (session) =>
        session.actorId === actorId &&
        session.profileId === profileId &&
        ACTIVE_SESSION_STATUSES.includes(session.status),
    );
    if (active) return safeSession(active);
    if (mode === 'test') {
      await resolveAuthenticationState(actorId, profileId);
    }

    const now = new Date().toISOString();
    const session: AuthenticationSession = {
      actorId,
      createdAt: now,
      id: crypto.randomUUID(),
      mode,
      previousProfileStatus:
        profile.revokedAt || profile.status === 'revoked'
          ? 'revoked'
          : profile.encryptedState
            ? profile.expiresAt && profile.expiresAt.getTime() <= Date.now()
              ? 'expired'
              : 'authenticated'
            : 'unauthenticated',
      profileId,
      status: 'started',
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    if (mode === 'authenticate') {
      await setAuthenticationProfileStatus(
        actorId,
        profileId,
        'authenticating',
      );
    }
    await recordAuthenticationProfileAudit({
      action:
        mode === 'authenticate' ? 'authentication_started' : 'test_started',
      actorId,
      outcome: 'started',
      profileId,
      sessionId: session.id,
    });
    void this.run(session, profile).catch(() => undefined);
    const retention = setTimeout(
      () => this.sessions.delete(session.id),
      SESSION_RETENTION_MS,
    );
    retention.unref();
    return safeSession(session);
  }

  get(actorId: string, sessionId: string) {
    return safeSession(this.requireSession(actorId, sessionId));
  }

  async complete(actorId: string, sessionId: string) {
    const session = this.requireSession(actorId, sessionId);
    if (session.mode !== 'authenticate') {
      throw Object.assign(
        new Error('Only authentication sessions require a browser handoff.'),
        { code: 'authentication_handoff_not_required', statusCode: 409 },
      );
    }
    if (session.status === 'capturing' || session.status === 'completed') {
      return safeSession(session);
    }
    if (session.status !== 'browser_launched') {
      throw Object.assign(
        new Error('The native authentication browser is not ready.'),
        { code: 'authentication_browser_not_ready', statusCode: 409 },
      );
    }
    this.update(session, 'capturing');
    session.capturePhase = 'handoff_requested';
    await recordAuthenticationProfileAudit({
      action: 'authentication_handoff_started',
      actorId,
      outcome: 'started',
      profileId: session.profileId,
      sessionId,
    });
    session.continueCapture?.();
    return safeSession(session);
  }

  async cancel(actorId: string, sessionId: string) {
    const session = this.requireSession(actorId, sessionId);
    if (!ACTIVE_SESSION_STATUSES.includes(session.status)) {
      return safeSession(session);
    }
    this.update(session, 'cancelled');
    session.continueCapture?.();
    await this.closeSessionBrowsers(session);
    if (session.mode === 'authenticate') {
      await setAuthenticationProfileStatus(
        actorId,
        session.profileId,
        session.previousProfileStatus || 'unauthenticated',
      );
    }
    await recordAuthenticationProfileAudit({
      action:
        session.mode === 'authenticate'
          ? 'authentication_cancelled'
          : 'test_cancelled',
      actorId,
      outcome: 'cancelled',
      profileId: session.profileId,
      sessionId,
    });
    return safeSession(session);
  }

  async stopAll() {
    await Promise.allSettled(
      [...this.sessions.values()].map((session) =>
        this.cancel(session.actorId, session.id),
      ),
    );
  }

  async cancelProfile(actorId: string, profileId: string) {
    await Promise.allSettled(
      [...this.sessions.values()]
        .filter(
          (session) =>
            session.actorId === actorId && session.profileId === profileId,
        )
        .map((session) => this.cancel(actorId, session.id)),
    );
  }

  private requireSession(actorId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.actorId !== actorId) {
      throw Object.assign(new Error('Authentication session not found.'), {
        code: 'authentication_session_not_found',
        statusCode: 404,
      });
    }
    return session;
  }

  private update(
    session: AuthenticationSession,
    status: AuthenticationSessionStatus,
    error?: string,
  ) {
    session.status = status;
    session.updatedAt = new Date().toISOString();
    session.error = error;
    if (status === 'cancelled' || status === 'completed') {
      session.capturePhase = undefined;
    }
  }

  private waitForNativeHandoff(session: AuthenticationSession) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(
        () => finish(new Error('Native authentication session timed out.')),
        SESSION_TIMEOUT_MS,
      );
      timeout.unref();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        session.continueCapture = undefined;
        if (error) reject(error);
        else resolve();
      };
      session.continueCapture = () => finish();
      session.nativeBrowser?.process.once('exit', () => {
        if (!session.nativeBrowserClosing) {
          finish(new Error('Native browser exited before handoff.'));
        }
      });
    });
  }

  private async runNativeAuthentication(
    session: AuthenticationSession,
    profile: AuthenticationProfileRecord,
  ) {
    session.profileDirectory = createNativeBrowserProfile();
    session.nativeBrowser = await launchNativeAuthenticationBrowser({
      headless: isHeadlessTestMode(),
      profileDirectory: session.profileDirectory,
      startUrl: profile.startUrl,
    });
    if (session.status === 'cancelled') return;
    this.update(session, 'browser_launched');
    await this.waitForNativeHandoff(session);
    if (session.status === 'cancelled') return;

    session.capturePhase = 'closing_native_browser';
    session.nativeBrowserClosing = true;
    const nativeExecutablePath = session.nativeBrowser.executablePath;
    await closeNativeAuthenticationBrowser(session.nativeBrowser);
    session.nativeBrowser = undefined;
    session.nativeBrowserClosing = false;
    if (session.status === 'cancelled') return;

    session.capturePhase = 'opening_capture_browser';
    const { chromium } = await import('playwright');
    const context = await chromium.launchPersistentContext(
      session.profileDirectory,
      {
        args: ['--restore-last-session'],
        executablePath: nativeExecutablePath,
        headless: isHeadlessTestMode(),
        ignoreDefaultArgs: ['--password-store=basic', '--use-mock-keychain'],
        timeout: 15_000,
      },
    );
    session.browser = context;
    session.capturePhase = 'verifying_session';
    const condition = {
      type: profile.successConditionType as AuthenticationSuccessConditionType,
      value: profile.successConditionValue,
    };
    const restoredPages = context.pages();
    let page = restoredPages[0] || (await context.newPage());
    let successful = false;
    for (const candidate of restoredPages) {
      if (await successAlreadyReached({ page: candidate, ...condition })) {
        page = candidate;
        successful = true;
        break;
      }
    }
    if (!successful) {
      await page.goto(profile.startUrl, {
        timeout: CAPTURE_TIMEOUT_MS,
        waitUntil: 'domcontentloaded',
      });
      await waitForSuccess({
        page,
        timeout: CAPTURE_TIMEOUT_MS,
        ...condition,
      });
    }
    if (session.status === 'cancelled') return;
    session.capturePhase = 'storing_state';
    const state = await context.storageState({ indexedDB: true });
    await storeAuthenticationState({
      actorId: session.actorId,
      profileId: session.profileId,
      sessionId: session.id,
      state,
    });
  }

  private async runTestSession(
    session: AuthenticationSession,
    profile: AuthenticationProfileRecord,
  ) {
    const resolved = await resolveAuthenticationState(
      session.actorId,
      session.profileId,
    );
    const browser = await launchPlaywrightBrowser();
    session.browser = browser;
    if (session.status === 'cancelled') return;
    this.update(session, 'browser_launched');
    const context = await (browser as any).newContext({
      storageState: resolved.state,
    });
    const page = await context.newPage();
    await page.goto(profile.startUrl, {
      timeout: Math.min(60_000, SESSION_TIMEOUT_MS),
      waitUntil: 'domcontentloaded',
    });
    await waitForSuccess({
      page,
      timeout: SESSION_TIMEOUT_MS,
      type: profile.successConditionType as AuthenticationSuccessConditionType,
      value: profile.successConditionValue,
    });
    if (session.status === 'cancelled') return;
    await recordAuthenticationProfileAudit({
      action: 'test_completed',
      actorId: session.actorId,
      outcome: 'success',
      profileId: session.profileId,
      sessionId: session.id,
    });
  }

  private async closeSessionBrowsers(session: AuthenticationSession) {
    await session.browser?.close().catch(() => undefined);
    session.browser = undefined;
    if (session.nativeBrowser) {
      session.nativeBrowserClosing = true;
      await closeNativeAuthenticationBrowser(session.nativeBrowser).catch(
        () => undefined,
      );
      session.nativeBrowser = undefined;
      session.nativeBrowserClosing = false;
    }
  }

  private async run(
    session: AuthenticationSession,
    profile: AuthenticationProfileRecord,
  ) {
    try {
      if (session.mode === 'authenticate') {
        await this.runNativeAuthentication(session, profile);
      } else {
        await this.runTestSession(session, profile);
      }
      if (session.status !== 'cancelled') this.update(session, 'completed');
    } catch (error) {
      if (session.status === 'cancelled') return;
      const timedOut = /timeout/i.test(
        error instanceof Error ? error.message : '',
      );
      const safeError = safeAuthenticationError(error);
      this.update(session, timedOut ? 'timed_out' : 'failed', safeError);
      if (session.mode === 'authenticate') {
        await setAuthenticationProfileStatus(
          session.actorId,
          session.profileId,
          session.previousProfileStatus || 'unauthenticated',
        ).catch(() => undefined);
      }
      await recordAuthenticationProfileAudit({
        action:
          session.mode === 'authenticate'
            ? 'authentication_failed'
            : 'test_failed',
        actorId: session.actorId,
        outcome: timedOut ? 'timed_out' : 'failed',
        profileId: session.profileId,
        sessionId: session.id,
      }).catch(() => undefined);
    } finally {
      session.continueCapture = undefined;
      await this.closeSessionBrowsers(session);
      if (session.profileDirectory) {
        removeNativeBrowserProfile(session.profileDirectory);
        session.profileDirectory = undefined;
      }
    }
  }
}

export const localAuthenticationAgent = new LocalAuthenticationAgent();
