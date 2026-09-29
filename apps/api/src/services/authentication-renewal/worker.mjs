import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createRenewalPool } from './database.mjs';
import { createRenewalStore } from './store.mjs';
import { createPublicProxy } from './browser.mjs';
import { renewNextSession } from './runner.mjs';
import { loadCredentialKeyring } from '../credential-crypto.ts';

// --once drains a bounded batch for cron/job runtimes. The default daemon
// checks durable schedules every 30 seconds, independently of browser tabs.
const once = process.argv.includes('--once');
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
let pool;
let proxy;
try {
  loadCredentialKeyring();
  pool = createRenewalPool();
  const store = createRenewalStore(pool);
  proxy = await createPublicProxy();
  do {
    try {
      const deadline = Date.now() + 8 * 60_000;
      for (
        let count = 0;
        count < 10 && Date.now() < deadline && !stop.signal.aborted;
        count++
      ) {
        if (!(await renewNextSession({ store, chromium, proxy }))) break;
      }
    } catch {
      console.error(
        'Session renewal could not complete. Pending checks will be retried.',
      );
      if (once) process.exitCode = 1;
    }
    if (once || stop.signal.aborted) break;
    await delay(30_000, undefined, { signal: stop.signal }).catch(() => {});
  } while (!stop.signal.aborted);
} catch {
  console.error(
    'Session renewal worker could not start. Check its database and encryption configuration.',
  );
  process.exitCode = 1;
} finally {
  await proxy?.close();
  await pool?.end();
}
