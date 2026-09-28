import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { storeAuthenticationState } from './authentication-profiles';

// Keep values parameterized and use Prisma's configured schema, including E2E schemas.
function queryClient(client: Pick<typeof prisma, '$queryRawUnsafe'>) {
  return {
    async query(sql: string, values: unknown[] = []) {
      const rows = await client.$queryRawUnsafe<any[]>(sql, ...values);
      return { rows, rowCount: rows.length };
    },
  };
}
const pool = queryClient(prisma);

export async function createAuthenticationDeviceCode(input) {
  await pool.query(
    `INSERT INTO "AuthenticationDeviceCode"
       ("device_code_hash", "user_code", "public_key", "device_name",
        "platform", "cli_version", "capabilities", "expires_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      input.deviceCodeHash,
      input.userCode,
      input.publicKey,
      input.deviceName,
      input.platform,
      input.cliVersion,
      serializeAuthenticationCapabilities(input.capabilities),
      input.expiresAt,
    ],
  );
}

export function serializeAuthenticationCapabilities(capabilities) {
  return JSON.stringify(capabilities ?? []);
}

export async function approveAuthenticationDeviceCode({ userCode, userId }) {
  const deviceId = crypto.randomUUID();
  const result = await pool.query(
    `UPDATE "AuthenticationDeviceCode"
        SET "approved_by_user_id" = $2, "approved_device_id" = $3,
            "approved_at" = NOW()
      WHERE "user_code" = $1 AND "expires_at" > NOW()
        AND "approved_at" IS NULL AND "consumed_at" IS NULL
      RETURNING "user_code", "device_name", "platform", "cli_version"`,
    [userCode, userId, deviceId],
  );
  return result.rows[0] ? { ...result.rows[0], deviceId } : null;
}

export async function consumeAuthenticationDeviceCode({
  credentialHash,
  deviceCodeHash,
}) {
  return prisma.$transaction(async (tx) => {
    const client = queryClient(tx);
    const result = await client.query(
      `SELECT * FROM "AuthenticationDeviceCode"
        WHERE "device_code_hash" = $1 FOR UPDATE`,
      [deviceCodeHash],
    );
    const code = result.rows[0];
    if (!code || new Date(code.expires_at).getTime() <= Date.now()) {
      return { status: 'expired' };
    }
    if (!code.approved_at) {
      return { status: 'pending' };
    }
    if (code.consumed_at) {
      return { status: 'consumed' };
    }
    await client.query(
      `INSERT INTO "AuthenticationDevice"
         ("id", "owner_user_id", "display_name", "public_key",
          "credential_hash", "platform", "cli_version", "capabilities")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        code.approved_device_id,
        code.approved_by_user_id,
        code.device_name,
        code.public_key,
        credentialHash,
        code.platform,
        code.cli_version,
        serializeAuthenticationCapabilities(code.capabilities),
      ],
    );
    await client.query(
      `UPDATE "AuthenticationDeviceCode"
          SET "consumed_at" = NOW() WHERE "device_code_hash" = $1`,
      [deviceCodeHash],
    );
    return { status: 'approved', deviceId: code.approved_device_id };
  });
}

export async function getAuthenticationDevice(deviceId) {
  const result = await pool.query(
    `SELECT * FROM "AuthenticationDevice" WHERE "id" = $1`,
    [deviceId],
  );
  return result.rows[0] || null;
}

export async function recordAuthenticationDeviceRequest({ deviceId, nonce }) {
  return prisma.$transaction(async (tx) => {
    const client = queryClient(tx);
    await client.query(
      `DELETE FROM "AuthenticationDeviceNonce" WHERE "expires_at" <= NOW()`,
    );
    const inserted = await client.query(
      `INSERT INTO "AuthenticationDeviceNonce"
      ("device_id", "nonce", "expires_at") VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
      ON CONFLICT DO NOTHING RETURNING "nonce"`,
      [deviceId, nonce],
    );
    if (!inserted.rowCount)
      throw Object.assign(
        new Error('The signed request nonce was already used.'),
        {
          statusCode: 409,
          code: 'device_request_replayed',
        },
      );
    await client.query(
      `UPDATE "AuthenticationDevice" SET "last_seen_at" = NOW(), "updated_at" = NOW() WHERE "id" = $1`,
      [deviceId],
    );
  });
}

export async function listAuthenticationDevices(userId) {
  const result = await pool.query(
    `SELECT "id", "display_name", "platform", "cli_version", "capabilities",
            "last_seen_at", "revoked_at", "created_at", "updated_at"
       FROM "AuthenticationDevice"
      WHERE "owner_user_id" = $1 ORDER BY "updated_at" DESC`,
    [userId],
  );
  return result.rows;
}

export async function revokeAuthenticationDevice({ deviceId, userId }) {
  const result = await pool.query(
    `UPDATE "AuthenticationDevice"
        SET "revoked_at" = COALESCE("revoked_at", NOW()), "updated_at" = NOW()
      WHERE "id" = $1 AND "owner_user_id" = $2 RETURNING "id"`,
    [deviceId, userId],
  );
  if (!result.rowCount) return false;
  await pool.query(
    `UPDATE "AuthenticationSession"
        SET "status" = 'cancelled', "safe_error_code" = 'device_revoked',
            "updated_at" = NOW()
      WHERE "device_id" = $1 AND "status" IN
        ('queued', 'acknowledged', 'awaiting_user', 'validating', 'uploading')`,
    [deviceId],
  );
  return Boolean(result.rowCount && result.rowCount > 0);
}

export async function createAuthenticationSession(input) {
  const result = await pool.query(
    `INSERT INTO "AuthenticationSession"
       ("id", "owner_user_id", "profile_id", "device_id", "status", "mode",
        "nonce", "upload_token_hash", "expires_at")
     SELECT $1, $2, profile."id", device."id", 'queued', $5, $6, $7, $8
       FROM "AuthenticationProfile" profile
       JOIN "AuthenticationDevice" device
         ON device."id" = $4 AND device."owner_user_id" = $2
        AND device."revoked_at" IS NULL
        AND device."last_seen_at" > NOW() - INTERVAL '90 seconds'
        AND ($5 <> 'test' OR device."capabilities" @>
          '["authentication_profile_test_v1"]'::jsonb)
      WHERE profile."id" = $3 AND profile."ownerUserId" = $2
        AND profile."authenticationMethod" = 'local_agent'
      RETURNING "id", "sequence"::text, "status", "mode", "expires_at"`,
    [
      input.id,
      input.userId,
      input.profileId,
      input.deviceId,
      input.mode,
      input.nonce,
      input.uploadTokenHash,
      input.expiresAt,
    ],
  );
  return result.rows[0] || null;
}

export async function listAuthenticationCommands({ cursor, deviceId }) {
  await pool.query(
    `UPDATE "AuthenticationSession"
        SET "status" = 'expired', "safe_error_code" = 'session_expired',
            "updated_at" = NOW()
      WHERE "device_id" = $1 AND "expires_at" <= NOW()
        AND "status" IN ('queued', 'acknowledged', 'awaiting_user', 'validating')`,
    [deviceId],
  );
  const result = await pool.query(
    `SELECT session."id", session."sequence"::text, session."profile_id",
            session."mode",
            session."nonce", session."expires_at", profile."startUrl",
            profile."successConditionType", profile."successConditionValue"
       FROM "AuthenticationSession" session
       JOIN "AuthenticationProfile" profile
         ON profile."id" = session."profile_id"
      WHERE session."device_id" = $1 AND session."sequence" > $2::bigint
        AND session."status" = 'queued' AND session."expires_at" > NOW()
      ORDER BY session."sequence" ASC LIMIT 20`,
    [deviceId, cursor],
  );
  return result.rows;
}

export async function updateAuthenticationSessionStatus({
  deviceId,
  errorCode,
  sessionId,
  status,
}) {
  const result = await pool.query(
    `UPDATE "AuthenticationSession"
        SET "status" = $3, "safe_error_code" = $4, "updated_at" = NOW(),
            "acknowledged_at" = CASE WHEN $3 = 'acknowledged'
              THEN COALESCE("acknowledged_at", NOW()) ELSE "acknowledged_at" END,
            "completed_at" = CASE WHEN $3 = 'completed'
              THEN COALESCE("completed_at", NOW()) ELSE "completed_at" END
      WHERE "id" = $1 AND "device_id" = $2 AND "expires_at" > NOW()
        AND "status" IN ('queued', 'acknowledged', 'awaiting_user', 'validating')
        AND ($3 <> 'completed' OR "mode" = 'test')
      RETURNING "id", "status"`,
    [sessionId, deviceId, status, errorCode || null],
  );
  return result.rows[0] || null;
}

// Lock device, session and profile until encrypted storage is committed. Cancellation,
// revocation and profile edits must not allow an already-issued upload to restore access.
export async function commitAuthenticationSessionUpload({
  deviceId,
  sessionId,
  uploadTokenHash,
  nonce,
  state,
}) {
  return prisma.$transaction(async (tx) => {
    const client = queryClient(tx);
    const device = await client.query(
      `SELECT "id" FROM "AuthenticationDevice"
      WHERE "id" = $1 AND "revoked_at" IS NULL FOR UPDATE`,
      [deviceId],
    );
    if (!device.rowCount) return false;
    const claimed = await client.query(
      `UPDATE "AuthenticationSession" SET "status" = 'uploading', "updated_at" = NOW()
      WHERE "id" = $1 AND "device_id" = $2 AND "upload_token_hash" = $3 AND "nonce" = $4
      AND "expires_at" > NOW() AND "status" IN ('acknowledged', 'awaiting_user', 'validating')
      RETURNING *`,
      [sessionId, deviceId, uploadTokenHash, nonce],
    );
    const session = claimed.rows[0];
    if (!session) return false;
    const profile = await client.query(
      `SELECT "id" FROM "AuthenticationProfile"
      WHERE "id" = $1 AND "ownerUserId" = $2 AND "authenticationMethod" = 'local_agent'
      AND "updatedAt" <= $3 FOR UPDATE`,
      [session.profile_id, session.owner_user_id, session.created_at],
    );
    if (!profile.rowCount)
      throw Object.assign(
        new Error('The profile changed. Start authentication again.'),
        { statusCode: 409 },
      );
    await storeAuthenticationState(
      {
        actorId: session.owner_user_id,
        profileId: session.profile_id,
        sessionId,
        state,
      },
      tx,
    );
    await client.query(
      `UPDATE "AuthenticationSession" SET "status" = 'completed', "completed_at" = NOW(), "updated_at" = NOW()
      WHERE "id" = $1`,
      [sessionId],
    );
    return true;
  });
}

export async function getAuthenticationSessionForUser({ sessionId, userId }) {
  await pool.query(
    `UPDATE "AuthenticationSession" SET "status" = 'expired',
    "safe_error_code" = 'session_expired', "updated_at" = NOW()
    WHERE "id" = $1 AND "owner_user_id" = $2 AND "expires_at" <= NOW()
    AND "status" IN ('queued', 'acknowledged', 'awaiting_user', 'validating')`,
    [sessionId, userId],
  );
  const result = await pool.query(
    `SELECT "id", "profile_id", "device_id", "status", "mode", "expires_at",
            "acknowledged_at", "completed_at", "safe_error_code", "created_at",
            "updated_at"
       FROM "AuthenticationSession"
      WHERE "id" = $1 AND "owner_user_id" = $2`,
    [sessionId, userId],
  );
  return result.rows[0] || null;
}

export async function cancelAuthenticationSessionForUser({
  sessionId,
  userId,
}) {
  const result = await pool.query(
    `UPDATE "AuthenticationSession"
        SET "status" = 'cancelled', "safe_error_code" = 'user_cancelled',
            "updated_at" = NOW()
      WHERE "id" = $1 AND "owner_user_id" = $2
        AND "status" IN
          ('queued', 'acknowledged', 'awaiting_user', 'validating', 'uploading')
      RETURNING "id", "profile_id", "status", "safe_error_code"`,
    [sessionId, userId],
  );
  return result.rows[0] || null;
}
