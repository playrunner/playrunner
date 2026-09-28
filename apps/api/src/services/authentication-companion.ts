import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import {
  approveAuthenticationDeviceCode,
  cancelAuthenticationSessionForUser,
  commitAuthenticationSessionUpload,
  consumeAuthenticationDeviceCode,
  createAuthenticationDeviceCode,
  createAuthenticationSession,
  getAuthenticationDevice,
  getAuthenticationSessionForUser,
  listAuthenticationCommands,
  listAuthenticationDevices,
  recordAuthenticationDeviceRequest,
  revokeAuthenticationDevice,
  updateAuthenticationSessionStatus,
} from './authentication-companion-store';
function getBearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}
function uploadSecret() {
  const secret = process.env.PLAYRUNNER_LOCAL_AUTH_JWT_SECRET || '';
  if (secret.length < 32)
    throw new Error('Authentication companion is not configured.');
  return secret;
}

const DEVICE_CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 10 * 60_000;
const ONLINE_WINDOW_MS = 90_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_STORAGE_STATE_BYTES = 5 * 1024 * 1024;
const SESSION_STATUSES = new Set([
  'acknowledged',
  'awaiting_user',
  'validating',
  'completed',
  'failed',
]);
const MINIMUM_CLI_VERSION = [0, 2, 6] as const;

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function requiredString(value, label, maximumLength) {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${label} is required.`);
    error.statusCode = 400;
    error.code = 'invalid_request';
    throw error;
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    const error = new Error(`${label} is too long.`);
    error.statusCode = 400;
    error.code = 'invalid_request';
    throw error;
  }
  return normalized;
}

function safeCapabilities(value) {
  if (!Array.isArray(value) || value.length > 20) return [];
  return value
    .filter(
      (item) => typeof item === 'string' && /^[a-z0-9_]{1,80}$/.test(item),
    )
    .slice(0, 20);
}

export function supportedCliVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) return false;
  const version = match.slice(1).map(Number);
  return (
    version.some(
      (part, index) =>
        part > MINIMUM_CLI_VERSION[index] &&
        version
          .slice(0, index)
          .every((value, prior) => value === MINIMUM_CLI_VERSION[prior]),
    ) || version.every((part, index) => part === MINIMUM_CLI_VERSION[index])
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

function serializeDevice(device) {
  const lastSeen = device.last_seen_at
    ? new Date(device.last_seen_at).getTime()
    : 0;
  return {
    capabilities: device.capabilities || [],
    cliVersion: device.cli_version,
    createdAt: device.created_at,
    id: device.id,
    lastSeenAt: device.last_seen_at,
    name: device.display_name,
    online: !device.revoked_at && Date.now() - lastSeen <= ONLINE_WINDOW_MS,
    platform: device.platform,
    revokedAt: device.revoked_at,
    updatedAt: device.updated_at,
  };
}

export function authenticationUploadToken(sessionId, nonce) {
  return crypto
    .createHmac('sha256', uploadSecret())
    .update(`authentication-upload\0${sessionId}\0${nonce}`)
    .digest('base64url');
}

export function validateAuthenticationStorageState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (
    !Array.isArray(value.cookies) ||
    !Array.isArray(value.origins) ||
    value.cookies.length > 5_000 ||
    value.origins.length > 500
  ) {
    return false;
  }
  const validCookies = value.cookies.every(
    (cookie) =>
      cookie &&
      typeof cookie === 'object' &&
      !Array.isArray(cookie) &&
      ['domain', 'name', 'path', 'value'].every(
        (key) => typeof cookie[key] === 'string' && cookie[key].length <= 8_192,
      ) &&
      typeof cookie.expires === 'number' &&
      Number.isFinite(cookie.expires) &&
      typeof cookie.httpOnly === 'boolean' &&
      typeof cookie.secure === 'boolean' &&
      ['Lax', 'None', 'Strict'].includes(cookie.sameSite),
  );
  const validOrigins = value.origins.every(
    (origin) =>
      origin &&
      typeof origin === 'object' &&
      !Array.isArray(origin) &&
      typeof origin.origin === 'string' &&
      origin.origin.length <= 2_048 &&
      Array.isArray(origin.localStorage) &&
      origin.localStorage.length <= 10_000 &&
      origin.localStorage.every(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          typeof entry.name === 'string' &&
          typeof entry.value === 'string',
      ) &&
      (origin.indexedDB === undefined || Array.isArray(origin.indexedDB)),
  );
  return (
    validCookies &&
    validOrigins &&
    Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_STORAGE_STATE_BYTES
  );
}

export function authenticationDeviceSignatureMessage({
  body,
  method,
  nonce,
  originalUrl,
  timestamp,
}) {
  return [method.toUpperCase(), originalUrl, timestamp, nonce, hash(body)].join(
    '\n',
  );
}

export function verifyAuthenticationDeviceSignature({
  message,
  publicKey,
  signature,
}) {
  try {
    return crypto.verify(
      null,
      Buffer.from(message),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

async function browserUser(req) {
  if (!req.authUser?.providerUserId)
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  return { uid: req.authUser.providerUserId };
}

async function deviceForRequest(req) {
  const deviceId = requiredString(
    req.get('x-playrunner-device-id'),
    'Device ID',
    128,
  );
  const nonce = requiredString(
    req.get('x-playrunner-device-nonce'),
    'Request nonce',
    128,
  );
  const timestamp = requiredString(
    req.get('x-playrunner-device-timestamp'),
    'Request timestamp',
    80,
  );
  const signature = requiredString(
    req.get('x-playrunner-device-signature'),
    'Request signature',
    512,
  );
  const bearer = getBearerToken(req);
  const device = await getAuthenticationDevice(deviceId);
  if (
    !device ||
    device.revoked_at ||
    !bearer ||
    !crypto.timingSafeEqual(
      Buffer.from(hash(bearer)),
      Buffer.from(device.credential_hash),
    )
  ) {
    const error = new Error('Device authentication failed.');
    error.statusCode = 401;
    error.code = 'device_unauthorized';
    throw error;
  }
  const timestampMs = Date.parse(timestamp);
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS
  ) {
    const error = new Error('The signed request timestamp is invalid.');
    error.statusCode = 401;
    error.code = 'device_timestamp_invalid';
    throw error;
  }
  const body = req.body === undefined ? '' : JSON.stringify(req.body);
  const message = authenticationDeviceSignatureMessage({
    body,
    method: req.method,
    nonce,
    originalUrl: req.originalUrl,
    timestamp,
  });
  const valid = verifyAuthenticationDeviceSignature({
    message,
    publicKey: device.public_key,
    signature,
  });
  if (!valid) {
    const error = new Error('The signed device request is invalid.');
    error.statusCode = 401;
    error.code = 'device_signature_invalid';
    throw error;
  }
  await recordAuthenticationDeviceRequest({ deviceId, nonce });
  return { ...device, last_seen_at: new Date() };
}

export function createAuthenticationCompanionIntegration() {
  return {
    async createDeviceCode(req, res) {
      const publicKey = requiredString(
        req.body?.publicKey,
        'Public key',
        2_000,
      );
      let key;
      try {
        key = crypto.createPublicKey(publicKey);
      } catch {
        key = null;
      }
      if (!key || key.asymmetricKeyType !== 'ed25519') {
        res.status(400).json({
          code: 'invalid_public_key',
          error: 'An Ed25519 device public key is required.',
        });
        return;
      }
      const deviceCode = randomToken(32);
      const userCode =
        `${crypto.randomBytes(3).toString('hex').slice(0, 4)}-${crypto.randomBytes(3).toString('hex').slice(0, 4)}`.toUpperCase();
      const cliVersion = requiredString(
        req.body?.cliVersion,
        'CLI version',
        40,
      );
      if (!supportedCliVersion(cliVersion)) {
        res.status(426).json({
          code: 'cli_version_unsupported',
          error: 'Upgrade the Playrunner CLI before pairing this device.',
        });
        return;
      }
      await createAuthenticationDeviceCode({
        capabilities: safeCapabilities(req.body?.capabilities),
        cliVersion,
        deviceCodeHash: hash(deviceCode),
        deviceName: requiredString(req.body?.deviceName, 'Device name', 120),
        expiresAt: new Date(Date.now() + DEVICE_CODE_TTL_MS),
        platform: requiredString(req.body?.platform, 'Platform', 80),
        publicKey,
        userCode,
      });
      res.status(201).json({
        deviceCode,
        expiresIn: DEVICE_CODE_TTL_MS / 1_000,
        interval: 3,
        userCode,
        verificationUri: `${companionAppUrl(req)}/connect/device?code=${encodeURIComponent(userCode)}`,
      });
    },

    async approveDeviceCode(req, res) {
      const user = await browserUser(req);
      const approved = await approveAuthenticationDeviceCode({
        userCode: requiredString(
          req.body?.userCode,
          'Pairing code',
          20,
        ).toUpperCase(),
        userId: user.uid,
      });
      if (!approved) {
        res.status(404).json({
          code: 'pairing_code_invalid',
          error: 'The pairing code is invalid, expired, or already approved.',
        });
        return;
      }
      res.json({ device: approved });
    },

    async exchangeDeviceCode(req, res) {
      const deviceCode = requiredString(
        req.params.deviceCode,
        'Device code',
        100,
      );
      const refreshToken = randomToken(48);
      const result = await consumeAuthenticationDeviceCode({
        credentialHash: hash(refreshToken),
        deviceCodeHash: hash(deviceCode),
      });
      if (result.status === 'pending') {
        res.status(428).json({ code: 'authorization_pending' });
        return;
      }
      if (result.status !== 'approved') {
        res.status(410).json({
          code: `device_code_${result.status}`,
          error: 'The device code is expired or was already exchanged.',
        });
        return;
      }
      res.json({ deviceId: result.deviceId, refreshToken });
    },

    async listDevices(req, res) {
      const user = await browserUser(req);
      res.json({
        devices: (await listAuthenticationDevices(user.uid)).map(
          serializeDevice,
        ),
      });
    },

    async deviceStatus(req, res) {
      const device = await deviceForRequest(req);
      res.json(serializeDevice(device));
    },

    async revokeDevice(req, res) {
      const user = await browserUser(req);
      if (
        !(await revokeAuthenticationDevice({
          deviceId: req.params.deviceId,
          userId: user.uid,
        }))
      ) {
        res
          .status(404)
          .json({ code: 'device_not_found', error: 'Device not found.' });
        return;
      }
      res.status(204).end();
    },

    async revokeCurrentDevice(req, res) {
      const device = await deviceForRequest(req);
      await revokeAuthenticationDevice({
        deviceId: device.id,
        userId: device.owner_user_id,
      });
      res.status(204).end();
    },

    async createSession(req, res) {
      const user = await browserUser(req);
      const mode = String(req.body?.mode || 'authenticate');
      if (mode !== 'authenticate') {
        const error = new Error('Authentication session mode is invalid.');
        error.statusCode = 400;
        error.code = 'invalid_session_mode';
        throw error;
      }
      const id = `companion.${crypto.randomUUID()}`;
      const nonce = randomToken(24);
      const token = authenticationUploadToken(id, nonce);
      const session = await createAuthenticationSession({
        deviceId: requiredString(req.body?.deviceId, 'Device', 128),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        id,
        mode,
        nonce,
        profileId: requiredString(
          req.params.profileId || req.params.id,
          'Profile',
          128,
        ),
        uploadTokenHash: hash(token),
        userId: user.uid,
      });
      if (!session) {
        res.status(404).json({
          code: 'profile_or_device_not_found',
          error: 'Authentication Profile or paired device not found.',
        });
        return;
      }
      res.status(202).json({
        session: companionSession(
          session,
          req.params.profileId || req.params.id,
        ),
      });
    },

    async sessionStatus(req, res) {
      const user = await browserUser(req);
      const session = await getAuthenticationSessionForUser({
        sessionId: req.params.sessionId,
        userId: user.uid,
      });
      if (!session) {
        res
          .status(404)
          .json({ code: 'session_not_found', error: 'Session not found.' });
        return;
      }
      res.json({ session: companionSession(session) });
    },

    async cancelSession(req, res) {
      const user = await browserUser(req);
      const session = await cancelAuthenticationSessionForUser({
        sessionId: req.params.sessionId,
        userId: user.uid,
      });
      if (!session) {
        res
          .status(409)
          .json({ code: 'session_unavailable', error: 'Session unavailable.' });
        return;
      }
      res.json({ session: companionSession(session) });
    },

    async commands(req, res) {
      const device = await deviceForRequest(req);
      const rawCursor = String(req.query.cursor || '0');
      const cursor = /^\d+$/.test(rawCursor) ? rawCursor : '0';
      const requestedTimeout = Number(req.query.timeout || 0);
      const timeout = Number.isFinite(requestedTimeout)
        ? Math.min(25_000, Math.max(0, requestedTimeout))
        : 0;
      const deadline = Date.now() + timeout;
      let rows = await listAuthenticationCommands({
        cursor,
        deviceId: device.id,
      });
      while (!rows.length && Date.now() < deadline) {
        await delay(Math.min(500, deadline - Date.now()));
        rows = await listAuthenticationCommands({
          cursor,
          deviceId: device.id,
        });
      }
      const commands = rows.map((row) => ({
        expiresAt: row.expires_at,
        profileId: row.profile_id,
        sequence: row.sequence,
        sessionId: row.id,
        mode: row.mode,
        startUrl: row.startUrl,
        successCondition: {
          type: row.successConditionType,
          value: row.successConditionValue,
        },
        uploadNonce: row.nonce,
        uploadToken: authenticationUploadToken(row.id, row.nonce),
      }));
      res.json({
        commands,
        nextCursor: commands.at(-1)?.sequence || cursor,
      });
    },

    async acknowledge(req, res) {
      const device = await deviceForRequest(req);
      const session = await updateAuthenticationSessionStatus({
        deviceId: device.id,
        errorCode: undefined,
        sessionId: req.params.sessionId,
        status: 'acknowledged',
      });
      if (!session) {
        res
          .status(409)
          .json({ code: 'session_unavailable', error: 'Session unavailable.' });
        return;
      }
      res.json({ session: companionSession(session) });
    },

    async updateStatus(req, res) {
      const device = await deviceForRequest(req);
      const status = String(req.body?.status || '');
      if (!SESSION_STATUSES.has(status)) {
        res.status(400).json({
          code: 'invalid_session_status',
          error: 'Invalid session status.',
        });
        return;
      }
      const errorCode = req.body?.errorCode
        ? requiredString(req.body.errorCode, 'Error code', 80)
        : undefined;
      const session = await updateAuthenticationSessionStatus({
        deviceId: device.id,
        errorCode,
        sessionId: req.params.sessionId,
        status,
      });
      if (!session) {
        res
          .status(409)
          .json({ code: 'session_unavailable', error: 'Session unavailable.' });
        return;
      }
      res.json({ session: companionSession(session) });
    },

    async uploadState(req, res) {
      const device = await deviceForRequest(req);
      const nonce = requiredString(req.body?.nonce, 'Upload nonce', 128);
      const token = requiredString(req.body?.uploadToken, 'Upload token', 256);
      if (!validateAuthenticationStorageState(req.body?.state)) {
        res.status(400).json({
          code: 'invalid_authentication_state',
          error: 'Captured authentication state is invalid or too large.',
        });
        return;
      }
      const committed = await commitAuthenticationSessionUpload({
        deviceId: device.id,
        sessionId: req.params.sessionId,
        uploadTokenHash: hash(token),
        state: req.body.state,
        nonce,
      });
      if (!committed) {
        res.status(409).json({
          code: 'upload_capability_invalid',
          error: 'The upload capability is invalid, expired, or already used.',
        });
        return;
      }
      res.status(204).end();
    },
  };
}

export function companionAppUrl(req) {
  const configured = process.env.PLAYRUNNER_PUBLIC_APP_URL?.trim().replace(
    /\/+$/,
    '',
  );
  if (configured) return configured;
  // Relative pairing is anchored to the address used by the CLI. Public domains use TLS,
  // including behind a TLS-terminating proxy; forwarded headers are not trusted.
  const host = req.get('host') || '';
  const url = new URL(`http://${host}`);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return `${local ? req.protocol : 'https'}://${host}`;
}

export function usesAuthenticationCompanion(req) {
  const mode = process.env.PLAYRUNNER_AUTHENTICATION_MODE;
  if (mode === 'companion') return true;
  if (mode === 'local') return false;
  const hostname = process.env.PLAYRUNNER_PUBLIC_APP_URL?.trim()
    ? new URL(process.env.PLAYRUNNER_PUBLIC_APP_URL).hostname
    : req.hostname;
  return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}

export function companionSession(session, profileId = session.profile_id) {
  const statuses = {
    queued: 'started',
    acknowledged: 'capturing',
    awaiting_user: 'capturing',
    validating: 'capturing',
    uploading: 'capturing',
    expired: 'timed_out',
  };
  return {
    id: session.id,
    profileId,
    mode: session.mode || 'authenticate',
    status: statuses[session.status] || session.status,
    error: session.safe_error_code
      ? `Authentication failed: ${String(session.safe_error_code).replaceAll('_', ' ')}.`
      : undefined,
  };
}

export const authenticationCompanion =
  createAuthenticationCompanionIntegration();
export function companionRoute(handler) {
  return (req, res) =>
    Promise.resolve(handler(req, res)).catch((error) => {
      const status = error.statusCode || 500;
      res.status(status).json({
        code: error.code,
        error:
          status >= 500
            ? 'Authentication companion request failed.'
            : error.message,
      });
    });
}
export const authenticationCompanionRouter = Router();
authenticationCompanionRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
authenticationCompanionRouter.post(
  '/device-codes',
  companionRoute(authenticationCompanion.createDeviceCode),
);
authenticationCompanionRouter.post(
  '/device-codes/:deviceCode/token',
  companionRoute(authenticationCompanion.exchangeDeviceCode),
);
authenticationCompanionRouter.post(
  '/device-codes/approve',
  requireAuth,
  companionRoute(authenticationCompanion.approveDeviceCode),
);
authenticationCompanionRouter.get(
  '/devices',
  requireAuth,
  companionRoute(authenticationCompanion.listDevices),
);
authenticationCompanionRouter.delete(
  '/devices/:deviceId',
  requireAuth,
  companionRoute(authenticationCompanion.revokeDevice),
);
authenticationCompanionRouter.get(
  '/devices/me',
  companionRoute(authenticationCompanion.deviceStatus),
);
authenticationCompanionRouter.post(
  '/devices/me/revoke',
  companionRoute(authenticationCompanion.revokeCurrentDevice),
);
authenticationCompanionRouter.get(
  '/commands',
  companionRoute(authenticationCompanion.commands),
);
authenticationCompanionRouter.post(
  '/sessions/:sessionId/ack',
  companionRoute(authenticationCompanion.acknowledge),
);
authenticationCompanionRouter.post(
  '/sessions/:sessionId/status',
  companionRoute(authenticationCompanion.updateStatus),
);
authenticationCompanionRouter.post(
  '/sessions/:sessionId/state',
  companionRoute(authenticationCompanion.uploadState),
);
