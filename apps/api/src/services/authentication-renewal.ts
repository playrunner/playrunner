import { createRenewalPool } from './authentication-renewal/database.mjs';
import { createRenewalStore } from './authentication-renewal/store.mjs';

let pool: ReturnType<typeof createRenewalPool> | undefined;
export function authenticationRenewalStore() {
  pool ??= createRenewalPool();
  return createRenewalStore(pool);
}

export function sessionRenewalAvailable() {
  return process.env.PLAYRUNNER_SESSION_RENEWAL_ENABLED === 'true';
}

export function requireSessionRenewal() {
  if (!sessionRenewalAvailable())
    throw Object.assign(
      new Error('Session checks are not enabled on this server.'),
      { statusCode: 503 },
    );
}

export async function stopAuthenticationRenewalConnections() {
  await pool?.end();
}
