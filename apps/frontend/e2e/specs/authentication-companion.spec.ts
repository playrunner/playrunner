import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from '../fixtures';
import { authenticatedApi } from '../support/authenticatedApi';

// Real browser/API/database; the device driver speaks the published CLI protocol.
test('pairs a local device, captures state and rejects replay and revoked sessions', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.skip(
    process.env.PLAYRUNNER_AUTHENTICATION_MODE !== 'companion',
    'Requires companion mode',
  );
  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const keys = crypto.generateKeyPairSync('ed25519');
  const base = 'http://127.0.0.1:4173';
  const created = await request.post(
    `${base}/api/auth-companion/device-codes`,
    {
      data: {
        publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
        deviceName: `Laptop ${suffix}`,
        platform: 'test',
        cliVersion: '0.2.6',
        capabilities: ['authentication_profile_capture_v1'],
      },
    },
  );
  expect(created.status()).toBe(201);
  const pairing = await created.json();
  expect(new URL(pairing.verificationUri).pathname).toBe('/connect/device');
  expect(new URL(pairing.verificationUri).origin).toBe(base);
  const exchangeUrl = `${base}/api/auth-companion/device-codes/${pairing.deviceCode}/token`;
  expect((await request.post(exchangeUrl)).status()).toBe(428);
  expect(
    (
      await request.post(`${base}/api/auth-companion/device-codes/approve`, {
        data: { userCode: pairing.userCode },
      })
    ).status(),
  ).toBe(401);
  await page.goto(`/connect/device?code=${pairing.userCode}`);
  await page.getByRole('button', { name: 'Approve device' }).click();
  await expect(
    page.getByRole('heading', { name: 'Device paired' }),
  ).toBeVisible();
  const exchanged = await request.post(exchangeUrl);
  expect(exchanged.status()).toBe(200);
  const device = await exchanged.json();
  expect((await request.post(exchangeUrl)).status()).toBe(410);
  const configDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'playrunner-companion-e2e-'),
  );
  try {
    const directory = path.join(
      configDirectory,
      process.platform === 'win32' ? 'Playrunner' : 'playrunner',
    );
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(
      path.join(directory, 'companion.json'),
      JSON.stringify({
        ...device,
        url: base,
        privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
        publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
      }),
      { mode: 0o600 },
    );
    const output = execFileSync(
      process.execPath,
      [
        path.resolve('../api/node_modules/playrunner/dist/cli.js'),
        'auth',
        'status',
      ],
      {
        env: {
          ...process.env,
          XDG_CONFIG_HOME: configDirectory,
          APPDATA: configDirectory,
        },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    expect(output).toContain('online');
  } finally {
    await fs.rm(configDirectory, { recursive: true, force: true });
  }
  const signed = (pathname: string, body?: unknown) => {
    const method = body === undefined ? 'GET' : 'POST';
    const data = body === undefined ? '' : JSON.stringify(body);
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const message = [
      method,
      pathname,
      timestamp,
      nonce,
      crypto.createHash('sha256').update(data).digest('hex'),
    ].join('\n');
    return {
      method,
      ...(body === undefined ? {} : { data }),
      headers: {
        Authorization: `Bearer ${device.refreshToken}`,
        'content-type': 'application/json',
        'x-playrunner-device-id': device.deviceId,
        'x-playrunner-device-nonce': nonce,
        'x-playrunner-device-timestamp': timestamp,
        'x-playrunner-device-signature': crypto
          .sign(null, Buffer.from(message), keys.privateKey)
          .toString('base64'),
      },
    };
  };
  const deviceRequest = (pathname: string, body?: unknown) =>
    request.fetch(`${base}${pathname}`, signed(pathname, body));
  const statusPath = '/api/auth-companion/devices/me';
  const replay = signed(statusPath);
  expect((await request.fetch(`${base}${statusPath}`, replay)).status()).toBe(
    200,
  );
  expect((await request.fetch(`${base}${statusPath}`, replay)).status()).toBe(
    409,
  );
  const tampered = signed(statusPath);
  tampered.headers['x-playrunner-device-signature'] = 'invalid';
  expect((await request.fetch(`${base}${statusPath}`, tampered)).status()).toBe(
    401,
  );
  await page.goto('/authentication-profiles');
  await expect(
    page.getByRole('heading', { name: 'Paired devices' }),
  ).toBeVisible();
  await expect(page.getByLabel('Device for authentication')).toHaveValue(
    device.deviceId,
  );
  await expect(
    page.getByText(`npx playrunner@0.2.6 login --url ${base}`, { exact: true }),
  ).toBeVisible();
  const environmentId = `companion-env-${suffix}`;
  expect(
    (
      await authenticatedApi(page, `/api/store/environments/${environmentId}`, {
        method: 'PUT',
        body: { name: 'Companion E2E', variables: [] },
      })
    ).status,
  ).toBe(201);
  const createdProfile = await authenticatedApi(
    page,
    '/api/authentication-profiles',
    {
      method: 'POST',
      body: {
        environmentId,
        name: `Companion ${suffix}`,
        startUrl: `http://127.0.0.1:4013/login?ticket=${suffix}`,
        successCondition: {
          type: 'element_visible',
          value: '[data-testid="authenticated-app"]',
        },
      },
    },
  );
  expect(createdProfile.status).toBe(201);
  const profile = createdProfile.payload.profile;
  await page.reload();
  const card = page.getByRole('article').filter({ hasText: profile.name });
  await expect(card.getByRole('button', { name: 'Test session' })).toHaveCount(
    0,
  );
  const started = page.waitForResponse((response) =>
    response
      .url()
      .endsWith(`/authentication-profiles/${profile.id}/authenticate`),
  );
  await card.getByRole('button', { name: 'Authenticate', exact: true }).click();
  expect((await started).status()).toBe(202);
  const polled = await deviceRequest(
    '/api/auth-companion/commands?cursor=0&timeout=0',
  );
  expect(polled.status()).toBe(200);
  const command = (await polled.json()).commands.find(
    (item: { profileId: string }) => item.profileId === profile.id,
  );
  expect(command).toBeTruthy();
  const sessionPath = `/api/auth-companion/sessions/${command.sessionId}`;
  expect((await deviceRequest(`${sessionPath}/ack`, {})).status()).toBe(200);
  expect(
    (
      await deviceRequest(`${sessionPath}/status`, { status: 'awaiting_user' })
    ).status(),
  ).toBe(200);
  expect(
    (
      await deviceRequest(`${sessionPath}/status`, { status: 'completed' })
    ).status(),
  ).toBe(409);
  const localContext = await browser.newContext();
  let state;
  try {
    const localPage = await localContext.newPage();
    await localPage.goto(command.startUrl);
    await expect(localPage.getByTestId('authenticated-app')).toBeVisible();
    state = await localContext.storageState({ indexedDB: true });
  } finally {
    await localContext.close();
  }
  const upload = {
    state,
    nonce: command.uploadNonce,
    uploadToken: command.uploadToken,
  };
  expect(
    (
      await deviceRequest(`${sessionPath}/state`, { ...upload, nonce: 'wrong' })
    ).status(),
  ).toBe(409);
  expect((await deviceRequest(`${sessionPath}/state`, upload)).status()).toBe(
    204,
  );
  expect((await deviceRequest(`${sessionPath}/state`, upload)).status()).toBe(
    409,
  );
  await expect(card.getByText('Authenticated', { exact: true })).toBeVisible();
  const profiles = await authenticatedApi(page, '/api/authentication-profiles');
  expect(JSON.stringify(profiles.payload)).not.toContain('demo_auth');
  expect(JSON.stringify(profiles.payload)).not.toContain('encryptedState');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('paired-device-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle('Collapse Sidebar', { exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('main')
        .evaluate((element) => element.getBoundingClientRect().left),
    )
    .toBeLessThan(100);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('paired-device-mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  const start = async () => {
    const response = await authenticatedApi(
      page,
      `/api/authentication-profiles/${profile.id}/authenticate`,
      { method: 'POST', body: { deviceId: device.deviceId } },
    );
    expect(response.status).toBe(202);
    return response.payload.session.id as string;
  };
  const cancelled = await start();
  expect(
    (
      await authenticatedApi(
        page,
        `/api/authentication-profiles/sessions/${cancelled}/cancel`,
        { method: 'POST' },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await deviceRequest(`/api/auth-companion/sessions/${cancelled}/ack`, {})
    ).status(),
  ).toBe(409);
  const pending = await start();
  await page.getByRole('button', { name: `Revoke Laptop ${suffix}` }).click();
  await expect(page.getByText('No paired devices yet.')).toBeVisible();
  expect((await deviceRequest(statusPath)).status()).toBe(401);
  const cancelledByRevoke = await authenticatedApi(
    page,
    `/api/authentication-profiles/sessions/${pending}`,
  );
  expect(cancelledByRevoke.payload.session.status).toBe('cancelled');
  expect(
    (
      await authenticatedApi(
        page,
        `/api/authentication-profiles/${profile.id}/authenticate`,
        { method: 'POST', body: { deviceId: device.deviceId } },
      )
    ).status,
  ).toBe(404);
});
