import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';
import {
  checkBrowserSession,
  createPublicProxy,
  publicAddress,
} from './browser.mjs';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('renewal proxy rejects private, metadata, loopback and reserved addresses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '198.18.0.1',
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  const proxy = await createPublicProxy({
    lookup: async () => [{ address: '127.0.0.1' }],
  });
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        proxy.server,
        {
          path: 'http://metadata.google.internal/computeMetadata/v1/',
          headers: { 'Metadata-Flavor': 'Google' },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  } finally {
    await proxy.close();
  }
});

test('real browser renews cookies and storage, distinguishes sign-in from an outage', async (t) => {
  let mode = 'valid';
  let visits = 0;
  // Controlled HTTP proxy provides the fixture without contacting any live site.
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const url = new URL(req.url);
    if (url.hostname !== 'session.example.test') {
      res.writeHead(403);
      res.end();
      return;
    }
    if (mode === 'outage') {
      res.writeHead(503);
      res.end();
      return;
    }
    if (mode === 'signed_out') {
      res.end('<input type="password">');
      return;
    }
    if (url.pathname === '/renew') {
      assert.match(req.headers.cookie || '', /session=(original|renewed)/);
      res.setHeader(
        'Set-Cookie',
        'session=renewed; Path=/; HttpOnly; Max-Age=86400; SameSite=Lax',
      );
      res.end('ok');
      return;
    }
    visits++;
    res.setHeader('Content-Type', 'text/html');
    res.end(`<script>
      (async () => {
        await fetch('/renew');
        localStorage.setItem('refresh-token', 'rotated-fixture-token');
        const open = indexedDB.open('session-fixture', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('tokens');
        open.onsuccess = () => {
          const tx = open.result.transaction('tokens', 'readwrite');
          tx.objectStore('tokens').put('new-token', 'refresh');
          tx.oncomplete = () => { document.body.innerHTML = '<h1 id="signed-in">Account</h1>'; open.result.close(); };
        };
      })();
    </script>`);
  });
  const proxy = { server: await listen(server) };
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const state = {
    cookies: [
      {
        name: 'session',
        value: 'original',
        domain: 'session.example.test',
        path: '/',
        expires: Date.now() / 1000 + 86400,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
      {
        name: 'irrelevant',
        value: 'expired',
        domain: 'session.example.test',
        path: '/',
        expires: Date.now() / 1000 - 60,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  };
  const profile = {
    startUrl: 'http://session.example.test/',
    successConditionType: 'element_visible',
    successConditionValue: '#signed-in',
    expiresAt: new Date(0),
  };
  const valid = await checkBrowserSession({
    chromium,
    profile,
    state,
    proxy,
    timeout: 3000,
  });
  assert.equal(valid.result, 'valid');
  assert.equal(
    valid.state.cookies.find((cookie) => cookie.name === 'session').value,
    'renewed',
  );
  assert.equal(
    valid.state.cookies.some((cookie) => cookie.name === 'irrelevant'),
    false,
  );
  assert.equal(
    valid.state.origins[0].localStorage[0].value,
    'rotated-fixture-token',
  );
  assert.equal(valid.state.origins[0].indexedDB[0].name, 'session-fixture');
  assert.equal(visits, 1);
  // The newly saved state can bootstrap another independent browser.
  assert.equal(
    (
      await checkBrowserSession({
        chromium,
        profile,
        state: valid.state,
        proxy,
        timeout: 3000,
      })
    ).result,
    'valid',
  );
  mode = 'signed_out';
  assert.deepEqual(
    await checkBrowserSession({
      chromium,
      profile,
      state,
      proxy,
      timeout: 500,
    }),
    { result: 'needs_reauth' },
  );
  mode = 'outage';
  assert.deepEqual(
    await checkBrowserSession({
      chromium,
      profile,
      state,
      proxy,
      timeout: 500,
    }),
    { result: 'error' },
  );
  assert.equal(state.cookies[0].value, 'original');
});
