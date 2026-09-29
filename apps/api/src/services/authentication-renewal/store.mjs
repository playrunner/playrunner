import crypto from 'node:crypto';

export function renewalSettings(row) {
  return {
    enabled: row?.enabled ?? false,
    intervalMinutes: row?.interval_minutes ?? 60,
    lastCheckedAt: row?.last_checked_at ?? null,
    nextCheckAt: row?.next_check_at ?? null,
    result: row?.lease_id
      ? 'checking'
      : row?.requested
        ? 'queued'
        : (row?.last_result ?? null),
    cookieExpiryHint: row?.cookie_expiry_hint ?? null,
  };
}

export function createRenewalStore(pool, { schema } = {}) {
  if (schema && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
    throw new Error('Invalid renewal schema.');
  const table = schema
    ? `"${schema}"."AuthenticationRenewal"`
    : '"AuthenticationRenewal"';
  async function owned(userId, profileId) {
    const result = await pool.query(
      `SELECT id, "authenticationMethod", "revokedAt", status, "encryptedState" IS NOT NULL AS captured
       FROM "AuthenticationProfile" WHERE id = $1 AND "ownerUserId" = $2`,
      [profileId, userId],
    );
    if (!result.rows[0])
      throw Object.assign(new Error('Authentication Profile not found.'), {
        statusCode: 404,
      });
    return result.rows[0];
  }
  async function eligible(userId, profileId) {
    const profile = await owned(userId, profileId);
    if (
      profile.authenticationMethod === 'totp' ||
      profile.revokedAt ||
      profile.status === 'revoked' ||
      !profile.captured
    )
      throw Object.assign(
        new Error('Capture a saved browser session before enabling renewal.'),
        { statusCode: 409 },
      );
  }
  return {
    async get(userId, profileId) {
      await owned(userId, profileId);
      const result = await pool.query(
        `SELECT * FROM ${table} WHERE profile_id = $1`,
        [profileId],
      );
      return renewalSettings(result.rows[0]);
    },
    async save(userId, profileId, input) {
      if (
        typeof input?.enabled !== 'boolean' ||
        !Number.isInteger(input.intervalMinutes) ||
        input.intervalMinutes < 15 ||
        input.intervalMinutes > 1440
      )
        throw Object.assign(
          new Error('Choose an interval between 15 and 1440 minutes.'),
          { statusCode: 400 },
        );
      await owned(userId, profileId);
      if (input.enabled) await eligible(userId, profileId);
      const result = await pool.query(
        `INSERT INTO ${table} (profile_id, enabled, interval_minutes, requested, next_check_at)
         VALUES ($1, $2, $3, $2, CASE WHEN $2 THEN NOW() ELSE NULL END)
         ON CONFLICT (profile_id) DO UPDATE SET enabled = $2, interval_minutes = $3,
           requested = $2, next_check_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
           lease_id = NULL, lease_until = NULL
         RETURNING *`,
        [profileId, input.enabled, input.intervalMinutes],
      );
      return renewalSettings(result.rows[0]);
    },
    async request(userId, profileId) {
      await eligible(userId, profileId);
      const result = await pool.query(
        `INSERT INTO ${table} (profile_id, requested, next_check_at) VALUES ($1, TRUE, NOW())
         ON CONFLICT (profile_id) DO UPDATE SET requested = TRUE, next_check_at = NOW()
         RETURNING *`,
        [profileId],
      );
      return renewalSettings(result.rows[0]);
    },
    async claim() {
      const result = await pool.query(
        `WITH due AS (
          SELECT r.profile_id FROM ${table} r JOIN "AuthenticationProfile" p ON p.id = r.profile_id
          WHERE (r.lease_until IS NULL OR r.lease_until < NOW())
            AND (r.requested OR r.lease_id IS NOT NULL OR (r.enabled AND (r.next_check_at <= NOW()
              OR p."authenticatedAt" > r.last_checked_at)))
            AND p."revokedAt" IS NULL AND p.status IN ('authenticated', 'expired', 'needs_reauth')
            AND p."authenticationMethod" <> 'totp' AND p."encryptedState" IS NOT NULL
          ORDER BY r.next_check_at NULLS LAST LIMIT 1 FOR UPDATE OF r SKIP LOCKED
        ), claimed AS (
          UPDATE ${table} r SET lease_id = $1, lease_until = NOW() + INTERVAL '3 minutes', requested = FALSE
          FROM due WHERE r.profile_id = due.profile_id RETURNING r.*
        ) SELECT c.*, p."ownerUserId", p."encryptedState", p."encryptionVersion", p."startUrl",
          p."successConditionType", p."successConditionValue", p."updatedAt"::text AS source_version
          FROM claimed c JOIN "AuthenticationProfile" p ON p.id = c.profile_id`,
        [crypto.randomUUID()],
      );
      return result.rows[0] ?? null;
    },
    async finish(job, outcome) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const lease = await client.query(
          `SELECT * FROM ${table} WHERE profile_id = $1 AND lease_id = $2 AND lease_until > NOW() FOR UPDATE`,
          [job.profile_id, job.lease_id],
        );
        if (!lease.rowCount) {
          await client.query('ROLLBACK');
          return false;
        }
        const profile = await client.query(
          `SELECT id FROM "AuthenticationProfile" WHERE id = $1 AND "ownerUserId" = $2
           AND "updatedAt" = $3::timestamp AND "revokedAt" IS NULL
           AND status IN ('authenticated', 'expired', 'needs_reauth') FOR UPDATE`,
          [job.profile_id, job.ownerUserId, job.source_version],
        );
        if (!profile.rowCount) {
          await client.query(
            `UPDATE ${table} SET lease_id = NULL, lease_until = NULL WHERE profile_id = $1`,
            [job.profile_id],
          );
          await client.query('COMMIT');
          return false;
        }
        if (outcome.result === 'valid') {
          await client.query(
            `UPDATE "AuthenticationProfile" SET "encryptedState" = $2, "encryptionVersion" = $3,
             status = 'authenticated', "expiresAt" = NULL, "updatedAt" = NOW() WHERE id = $1`,
            [job.profile_id, outcome.encryptedValue, outcome.encryptionVersion],
          );
        } else if (outcome.result === 'needs_reauth') {
          await client.query(
            `UPDATE "AuthenticationProfile" SET status = 'needs_reauth', "updatedAt" = NOW() WHERE id = $1`,
            [job.profile_id],
          );
        }
        await client.query(
          `UPDATE ${table} SET lease_id = NULL, lease_until = NULL, last_checked_at = NOW(), last_result = $2,
           cookie_expiry_hint = CASE WHEN $2 = 'valid' THEN $3::timestamptz ELSE cookie_expiry_hint END,
           next_check_at = CASE WHEN requested THEN NOW()
             WHEN NOT enabled OR $2 = 'needs_reauth' THEN NULL
             WHEN $2 = 'error' THEN NOW() + INTERVAL '15 minutes'
             ELSE NOW() + interval_minutes * INTERVAL '1 minute' END WHERE profile_id = $1`,
          [job.profile_id, outcome.result, outcome.cookieExpiryHint ?? null],
        );
        await client.query(
          `INSERT INTO "AuthenticationProfileAudit" ("profileId", "actorId", action, outcome, "sessionId", "createdAt")
           VALUES ($1, $2, 'session_renewal', $3, $4, NOW())`,
          [job.profile_id, job.ownerUserId, outcome.result, job.lease_id],
        );
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
