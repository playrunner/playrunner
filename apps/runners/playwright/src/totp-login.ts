import { chromium } from 'playwright';
import { generate } from 'otplib';
import {
  normalizeTotpCredentials,
  normalizeTotpSettings,
  type TotpLogin,
} from '../../shared/totp-profile';

/** Runs outside the test recorder: no traces, videos, screenshots or raw errors. */
export async function captureTotpSession(login: TotpLogin) {
  let stage = 'configuration';
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    // Playwright debug output can include fill values even without test traces.
    if (process.env.DEBUG || process.env.PWDEBUG)
      throw new Error('Disable debug logging before credential sign-in');
    const settings = normalizeTotpSettings(login.settings);
    const credentials = normalizeTotpCredentials(login.credentials);
    stage = 'browser startup';
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const trusted = () => {
      if (!settings.allowedOrigins.includes(new URL(page.url()).origin))
        throw new Error('Unexpected login origin');
    };
    const fill = async (selector: string, value: string) => {
      await page.locator(selector).waitFor({ state: 'visible' });
      trusted();
      await page.locator(selector).fill(value);
    };
    stage = 'username';
    await page.goto(login.startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await fill(settings.usernameSelector, credentials.username);
    if (settings.usernameSubmitSelector) {
      trusted();
      await page.locator(settings.usernameSubmitSelector).click();
    }
    stage = 'password';
    await fill(settings.passwordSelector, credentials.password);
    trusted();
    await page.locator(settings.submitSelector).click();
    stage = 'authenticator code';
    await page
      .locator(settings.totpSelector)
      .first()
      .waitFor({ state: 'visible' });
    trusted();
    const remaining = settings.period - ((Date.now() / 1000) % settings.period);
    if (remaining < 5)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.ceil(remaining * 1000) + 100),
      );
    const code = await generate({
      secret: credentials.secret,
      digits: settings.digits,
      period: settings.period,
      algorithm: settings.algorithm,
    });
    const inputs = page.locator(settings.totpSelector);
    const count = await inputs.count();
    if (count === 1) await fill(settings.totpSelector, code);
    else if (count === settings.digits) {
      for (let index = 0; index < count; index++) {
        trusted();
        await inputs.nth(index).fill(code[index]);
      }
    } else throw new Error('Unexpected code inputs');
    trusted();
    await page.locator(settings.totpSubmitSelector).click();
    stage = 'success verification';
    const success = login.successCondition;
    if (success.type === 'element_visible')
      await page.locator(success.value).waitFor({ state: 'visible' });
    else
      await page.waitForURL(
        (url) =>
          success.type === 'url_exact'
            ? url.href === success.value
            : url.href.startsWith(success.value),
        { timeout: 30_000 },
      );
    if (new URL(page.url()).origin !== new URL(login.startUrl).origin)
      throw new Error('Not returned to application');
    return await context.storageState({ indexedDB: true });
  } catch {
    throw new Error(
      `TOTP sign-in failed at ${stage}. Check the profile settings and credentials; sensitive details were suppressed.`,
    );
  } finally {
    await browser?.close();
  }
}

export async function materializeAuthenticationState(
  value: unknown,
): Promise<unknown> {
  const state = value as {
    kind?: string;
    profiles?: Array<{ state: unknown }>;
  };
  if (state?.kind === 'totp_login')
    return captureTotpSession(value as TotpLogin);
  if (Array.isArray(state?.profiles)) {
    const profiles = [];
    // Sequential login avoids simultaneous use of a provider's single-use code.
    for (const profile of state.profiles)
      profiles.push({
        ...profile,
        state: await materializeAuthenticationState(profile.state),
      });
    return { ...state, profiles };
  }
  return value;
}
