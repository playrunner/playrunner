import { readFileSync } from 'node:fs';
const renewalSchema = readFileSync(
  new URL(
    '../../../prisma/migrations/20260929100000_authentication_renewal/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import http from 'node:http';
import { chromium } from 'playwright';
import { renewNextSession } from './runner.mjs';
import {
  encryptSecretPayload,
  decryptSecretPayload,
} from '../credential-crypto.ts';
import { createRenewalStore } from './store.mjs';
const require = createRequire(
  new URL('../../../package.json', import.meta.url),
);
const { Pool } = require('pg');

const databaseUrl = process.env.RENEWAL_TEST_DATABASE_URL;
test(
  'renewal persistence enforces ownership, leases and stale-result protection',
  { skip: !databaseUrl },
  async (t) => {
    const url = new URL(databaseUrl);
    assert.match(url.pathname, /^\/playrunner_renewal_test_/);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    const pool = new Pool({ connectionString: databaseUrl });
    t.after(async () => {
      await pool.query(
        'DROP TABLE IF EXISTS "AuthenticationRenewal", "AuthenticationProfileAudit", "AuthenticationProfile"',
      );
      await pool.end();
    });
    await pool.query(`CREATE TABLE "AuthenticationProfile" (id TEXT PRIMARY KEY, "ownerUserId" TEXT, "authenticationMethod" TEXT DEFAULT 'local_agent', "revokedAt" TIMESTAMP, status TEXT DEFAULT 'authenticated', "encryptedState" TEXT DEFAULT 'original-encrypted-state', "encryptionVersion" INTEGER DEFAULT 1, "startUrl" TEXT DEFAULT 'https://example.test', "successConditionType" TEXT DEFAULT 'url_exact', "successConditionValue" TEXT DEFAULT 'https://example.test/app', "expiresAt" TIMESTAMP DEFAULT '2000-01-01', "authenticatedAt" TIMESTAMP DEFAULT NOW(), "updatedAt" TIMESTAMP DEFAULT NOW());
    CREATE TABLE "AuthenticationProfileAudit" ("profileId" TEXT, "actorId" TEXT, action TEXT, outcome TEXT, "sessionId" TEXT, "createdAt" TIMESTAMP);
    INSERT INTO "AuthenticationProfile" (id, "ownerUserId") VALUES ('profile-a', 'owner-a');`);
    await pool.query(renewalSchema);
    const store = createRenewalStore(pool);
    await assert.rejects(store.get('owner-b', 'profile-a'), {
      statusCode: 404,
    });
    await assert.rejects(
      store.save('owner-a', 'profile-a', { enabled: true, intervalMinutes: 1 }),
      { statusCode: 400 },
    );
    assert.equal(
      (
        await store.save('owner-a', 'profile-a', {
          enabled: true,
          intervalMinutes: 60,
        })
      ).enabled,
      true,
    );
    const claims = await Promise.all([store.claim(), store.claim()]);
    assert.equal(claims.filter(Boolean).length, 1);
    const job = claims.find(Boolean);
    assert.ok(job); // Past cookie expiry does not block validation.
    await store.finish(job, {
      result: 'valid',
      encryptedValue: 'renewed-encrypted-state',
      encryptionVersion: 1,
      cookieExpiryHint: new Date(Date.now() + 60000),
    });
    let profile = (await pool.query('SELECT * FROM "AuthenticationProfile"'))
      .rows[0];
    assert.equal(profile.encryptedState, 'renewed-encrypted-state');
    assert.equal(profile.expiresAt, null);
    assert.equal(profile.status, 'authenticated');
    const saved = await store.get('owner-a', 'profile-a');
    assert.equal(saved.result, 'valid');
    assert.ok(
      new Date(saved.nextCheckAt) - new Date(saved.lastCheckedAt) >= 3599000,
    );
    assert.equal(JSON.stringify(saved).includes('encrypted'), false);
    assert.equal(await store.claim(), null);

    // A one-off check interrupted by a worker restart remains recoverable,
    // even when scheduled renewal is off.
    await store.save('owner-a', 'profile-a', {
      enabled: false,
      intervalMinutes: 60,
    });
    await store.request('owner-a', 'profile-a');
    const abandoned = await store.claim();
    await pool.query(
      `UPDATE "AuthenticationRenewal" SET lease_until = NOW() - INTERVAL '1 second'`,
    );
    const recovered = await store.claim();
    assert.ok(recovered);
    assert.notEqual(recovered.lease_id, abandoned.lease_id);
    assert.equal(
      await store.finish(abandoned, { result: 'needs_reauth' }),
      false,
    );
    await store.finish(recovered, { result: 'needs_reauth' });
    assert.equal(await store.claim(), null);
    await store.save('owner-a', 'profile-a', {
      enabled: true,
      intervalMinutes: 60,
    });

    await store.request('owner-a', 'profile-a');
    const interrupted = await store.claim();
    await store.finish(interrupted, { result: 'error' });
    profile = (await pool.query('SELECT * FROM "AuthenticationProfile"'))
      .rows[0];
    assert.equal(profile.encryptedState, 'renewed-encrypted-state');
    assert.equal(profile.status, 'needs_reauth');

    await store.request('owner-a', 'profile-a');
    const old = await store.claim();
    await pool.query(
      `UPDATE "AuthenticationProfile" SET "encryptedState" = 'manual-login', "updatedAt" = NOW() WHERE id = 'profile-a'`,
    );
    assert.equal(
      await store.finish(old, {
        result: 'valid',
        encryptedValue: 'stale',
        encryptionVersion: 1,
      }),
      false,
    );
    assert.equal(
      (await pool.query('SELECT "encryptedState" FROM "AuthenticationProfile"'))
        .rows[0].encryptedState,
      'manual-login',
    );

    await store.request('owner-a', 'profile-a');
    const disabled = await store.claim();
    await store.save('owner-a', 'profile-a', {
      enabled: false,
      intervalMinutes: 60,
    });
    assert.equal(
      await store.finish(disabled, { result: 'needs_reauth' }),
      false,
    );
    assert.equal(await store.claim(), null);

    await store.request('owner-a', 'profile-a');
    const revoked = await store.claim();
    await pool.query(
      `UPDATE "AuthenticationProfile" SET "revokedAt" = NOW(), status = 'revoked', "updatedAt" = NOW() WHERE id = 'profile-a'`,
    );
    assert.equal(
      await store.finish(revoked, {
        result: 'valid',
        encryptedValue: 'stale',
        encryptionVersion: 1,
      }),
      false,
    );
    await assert.rejects(store.request('owner-a', 'profile-a'), {
      statusCode: 409,
    });

    // Exercise the actual worker unit with encrypted PostgreSQL state and
    // Chromium; only the outbound site is replaced with a controlled fixture.
    process.env.PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEY_VERSION = '1';
    process.env.PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEYS = JSON.stringify({
      1: Buffer.alloc(32, 7).toString('base64'),
    });
    const identity = [
      'owner-a',
      'authentication_profile',
      'browser-profile',
      'storage_state',
    ];
    const encrypted = encryptSecretPayload(
      { cookies: [], origins: [] },
      identity,
    );
    await pool.query(
      `INSERT INTO "AuthenticationProfile" (id, "ownerUserId", "encryptedState", "startUrl", "successConditionType", "successConditionValue") VALUES ('browser-profile', 'owner-a', $1, 'http://renewal.example.test/', 'element_visible', '#account')`,
      [encrypted.encryptedValue],
    );
    const site = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader(
        'Set-Cookie',
        'session=renewed; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax',
      );
      res.end('<h1 id="account">Signed in</h1>');
    });
    await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => site.close(resolve)));
    await store.save('owner-a', 'browser-profile', {
      enabled: true,
      intervalMinutes: 60,
    });
    assert.equal(
      await renewNextSession({
        store,
        chromium,
        proxy: { server: `http://127.0.0.1:${site.address().port}` },
      }),
      true,
    );
    const renewed = (
      await pool.query(
        `SELECT * FROM "AuthenticationProfile" WHERE id = 'browser-profile'`,
      )
    ).rows[0];
    assert.equal(renewed.status, 'authenticated');
    assert.equal(renewed.expiresAt, null);
    const decrypted = decryptSecretPayload(
      renewed.encryptedState,
      renewed.encryptionVersion,
      identity,
    );
    assert.equal(decrypted.cookies[0].value, 'renewed');
    assert.equal(await renewNextSession({ store, chromium, proxy: {} }), false);

    // Real API routes against the same isolated database. Only the identity
    // middleware is supplied here; the owner checks and writes are real.
    process.env.DATABASE_URL = databaseUrl;
    process.env.PLAYRUNNER_SESSION_RENEWAL_ENABLED = 'true';
    const { default: express } = await import('express');
    const { authenticationProfilesRouter } =
      await import('../../routes/authentication-profiles.ts');
    const { stopAuthenticationRenewalConnections } =
      await import('../authentication-renewal.ts');
    t.after(stopAuthenticationRenewalConnections);
    const api = express();
    api.use(express.json());
    api.use((req, _res, next) => {
      req.authUser = { providerUserId: req.get('x-test-user') || 'owner-a' };
      next();
    });
    api.use('/api/authentication-profiles', authenticationProfilesRouter);
    const server = api.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const endpoint = `http://127.0.0.1:${server.address().port}/api/authentication-profiles/browser-profile/renewal`;
    assert.equal(
      (await fetch(endpoint, { headers: { 'x-test-user': 'owner-b' } })).status,
      404,
    );
    let response = await fetch(endpoint);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).renewal.available, true);
    response = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, intervalMinutes: 60 }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).renewal.enabled, false);
    assert.equal(
      (await fetch(`${endpoint}/check`, { method: 'POST' })).status,
      202,
    );
    process.env.PLAYRUNNER_SESSION_RENEWAL_ENABLED = 'false';
    assert.equal(
      (await (await fetch(endpoint)).json()).renewal.available,
      false,
    );
    assert.equal(
      (await fetch(`${endpoint}/check`, { method: 'POST' })).status,
      503,
    );
  },
);
