import {
  decryptSecretPayload,
  encryptSecretPayload,
} from '../credential-crypto.ts';
import { checkBrowserSession } from './browser.mjs';

// Shared by a continuously running installed-server worker and scheduled jobs.
export async function renewNextSession({ store, chromium, proxy }) {
  const job = await store.claim();
  if (!job) return false;
  let outcome = { result: 'error' };
  try {
    const identity = [
      job.ownerUserId,
      'authentication_profile',
      job.profile_id,
      'storage_state',
    ];
    const state = decryptSecretPayload(
      job.encryptedState,
      job.encryptionVersion,
      identity,
    );
    const checked = await checkBrowserSession({
      chromium,
      profile: job,
      state,
      proxy,
    });
    outcome =
      checked.result === 'valid'
        ? {
            result: 'valid',
            ...encryptSecretPayload(checked.state, identity),
            cookieExpiryHint: checked.cookieExpiryHint,
          }
        : { result: checked.result };
  } catch {
    // Keep credentials and provider error details out of logs.
  }
  await store.finish(job, outcome);
  return true;
}
