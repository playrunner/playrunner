import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';

// Explicitly opt in: all data is isolated in a new schema and removed afterward.
test(
  'companion persistence enforces ownership, expiry, revocation and atomic encrypted uploads',
  {
    skip: process.env.PLAYRUNNER_COMPANION_DATABASE_TESTS !== 'true',
  },
  async () => {
    loadEnv({ path: '.env', quiet: true });
    const url = new URL(process.env.DATABASE_URL!);
    const schema = `companion_test_${crypto.randomBytes(8).toString('hex')}`;
    url.searchParams.delete('schema');
    const pool = new Pool({ connectionString: url.toString() });
    url.searchParams.set('schema', schema);
    process.env.DATABASE_URL = url.toString();
    process.env.PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEY_VERSION = '1';
    process.env.PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEYS = JSON.stringify({
      1: Buffer.alloc(32, 9).toString('base64'),
    });
    let database: { $disconnect: () => Promise<void> } | undefined;
    try {
      execFileSync('./node_modules/.bin/prisma', ['db', 'push'], {
        env: process.env,
        stdio: 'pipe',
      });
      const { prisma } = await import('../lib/prisma');
      database = prisma;
      const store = await import('./authentication-companion-store');
      const profiles = await import('./authentication-profiles');
      await prisma.environment.create({
        data: {
          id: 'env',
          userId: 'owner',
          name: 'Environment',
          variables: [],
        },
      });
      const profile = await profiles.createAuthenticationProfile('owner', {
        environmentId: 'env',
        name: 'Profile',
        startUrl: 'https://example.com',
        successCondition: { type: 'url_prefix', value: 'https://example.com' },
      });
      const deviceId = 'device';
      await prisma.authenticationDevice.create({
        data: {
          id: deviceId,
          owner_user_id: 'owner',
          display_name: 'Laptop',
          public_key: 'test-key',
          credential_hash: 'test-hash',
          platform: 'test',
          cli_version: '0.2.4',
          capabilities: ['authentication_profile_capture_v1'],
          last_seen_at: new Date(),
        },
      });
      const create = (userId = 'owner') =>
        store.createAuthenticationSession({
          id: `companion.${crypto.randomUUID()}`,
          userId,
          deviceId,
          profileId: profile.id,
          mode: 'authenticate',
          nonce: 'nonce',
          uploadTokenHash: 'upload-hash',
          expiresAt: new Date(Date.now() + 600_000),
        });
      assert.equal(await create('other-user'), null);
      const active = await create();
      assert.ok(active);
      assert.equal(
        await store.getAuthenticationSessionForUser({
          sessionId: active.id,
          userId: 'other-user',
        }),
        null,
      );
      assert.equal(
        await store.cancelAuthenticationSessionForUser({
          sessionId: active.id,
          userId: 'other-user',
        }),
        null,
      );
      assert.equal(
        await store.revokeAuthenticationDevice({
          deviceId,
          userId: 'other-user',
        }),
        false,
      );
      assert.equal(
        (
          await store.getAuthenticationSessionForUser({
            sessionId: active.id,
            userId: 'owner',
          })
        ).status,
        'queued',
      );
      const acknowledge = (sessionId: string) =>
        store.updateAuthenticationSessionStatus({
          sessionId,
          deviceId,
          status: 'acknowledged',
          errorCode: undefined,
        });
      await acknowledge(active.id);
      const state = {
        cookies: [],
        origins: [
          {
            origin: 'https://example.com',
            localStorage: [{ name: 'session', value: 'private-session-value' }],
          },
        ],
      };
      const upload = (sessionId: string) =>
        store.commitAuthenticationSessionUpload({
          sessionId,
          deviceId,
          uploadTokenHash: 'upload-hash',
          nonce: 'nonce',
          state,
        });
      assert.deepEqual(
        (await Promise.all([upload(active.id), upload(active.id)])).sort(),
        [false, true],
      );
      const stored = await prisma.authenticationProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });
      assert.ok(stored.encryptedState);
      assert.ok(!stored.encryptedState.includes('private-session-value'));
      assert.deepEqual(
        (await profiles.resolveAuthenticationState('owner', profile.id)).state,
        state,
      );
      const expired = await create();
      await prisma.authenticationSession.update({
        where: { id: expired.id },
        data: { expires_at: new Date(0) },
      });
      assert.equal(await acknowledge(expired.id), null);
      assert.equal(await upload(expired.id), false);
      assert.equal(
        (
          await store.getAuthenticationSessionForUser({
            sessionId: expired.id,
            userId: 'owner',
          })
        ).status,
        'expired',
      );
      const revokedProfile = await create();
      await acknowledge(revokedProfile.id);
      await profiles.revokeAuthenticationProfile('owner', profile.id);
      await assert.rejects(upload(revokedProfile.id), /profile changed/);
      assert.equal(
        (
          await prisma.authenticationProfile.findUniqueOrThrow({
            where: { id: profile.id },
          })
        ).encryptedState,
        null,
      );
      const deviceRevoked = await create();
      await acknowledge(deviceRevoked.id);
      assert.equal(
        await store.revokeAuthenticationDevice({ deviceId, userId: 'owner' }),
        true,
      );
      assert.equal(await upload(deviceRevoked.id), false);
      assert.equal(await create(), null);
      assert.equal(
        (
          await store.getAuthenticationSessionForUser({
            sessionId: deviceRevoked.id,
            userId: 'owner',
          })
        ).status,
        'cancelled',
      );
      await store.createAuthenticationDeviceCode({
        capabilities: [],
        cliVersion: '0.2.4',
        deviceCodeHash: 'expired-code',
        deviceName: 'Expired',
        expiresAt: new Date(0),
        platform: 'test',
        publicKey: 'test-key',
        userCode: 'ABCD-EFGH',
      });
      assert.equal(
        await store.approveAuthenticationDeviceCode({
          userCode: 'ABCD-EFGH',
          userId: 'owner',
        }),
        null,
      );
      assert.equal(
        (
          await store.consumeAuthenticationDeviceCode({
            deviceCodeHash: 'expired-code',
            credentialHash: 'unused',
          })
        ).status,
        'expired',
      );
    } finally {
      await database?.$disconnect();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  },
);
