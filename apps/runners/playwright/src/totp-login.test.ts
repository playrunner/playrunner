import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { generateSecret, verify } from 'otplib';
import {
  captureTotpSession,
  materializeAuthenticationState,
} from './totp-login';
import type { TotpLogin } from '../../shared/totp-profile';

test('TOTP runner performs password and real code verification before capturing state', async () => {
  const credentials = {
    username: crypto.randomUUID(),
    password: crypto.randomBytes(24).toString('hex'),
    secret: generateSecret(),
  };
  let verified = false;
  let passwordAccepted = false;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const fields = new URLSearchParams(body);
    if (req.url === '/password') {
      passwordAccepted =
        fields.get('user') === credentials.username &&
        fields.get('pass') === credentials.password;
      if (!passwordAccepted) {
        res.writeHead(403).end('Denied');
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(
        '<form action="/verify" method="POST"><input id="code" name="code"><button id="verify">Verify</button></form>',
      );
    } else if (req.url === '/verify') {
      verified =
        passwordAccepted &&
        (
          await verify({
            secret: credentials.secret,
            token: fields.get('code') || '',
          })
        ).valid;
      if (!verified) {
        res.writeHead(403).end('Denied');
        return;
      }
      res
        .writeHead(302, {
          location: '/app',
          'set-cookie':
            'test_session=authenticated; Path=/; HttpOnly; SameSite=Lax',
        })
        .end();
    } else if (req.url === '/app') {
      res.setHeader('content-type', 'text/html');
      res.end('<main id="signed-in">Authenticated</main>');
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<form action="/password" method="POST"><input id="user" name="user"><input id="pass" name="pass" type="password"><button id="login">Login</button></form>',
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const login: TotpLogin = {
    kind: 'totp_login',
    startUrl: origin,
    credentials,
    successCondition: { type: 'element_visible', value: '#signed-in' },
    settings: {
      allowedOrigins: [origin],
      usernameSelector: '#user',
      passwordSelector: '#pass',
      submitSelector: '#login',
      totpSelector: '#code',
      totpSubmitSelector: '#verify',
      period: 30,
      digits: 6,
      algorithm: 'sha1',
    },
  };
  try {
    const state = await captureTotpSession(login);
    assert.equal(verified, true);
    assert.equal(
      state.cookies.some((cookie) => cookie.name === 'test_session'),
      true,
    );
    assert.equal(JSON.stringify(state).includes(credentials.secret), false);
    const existing = { cookies: [], origins: [] };
    assert.equal(await materializeAuthenticationState(existing), existing);
    await assert.rejects(
      captureTotpSession({
        ...login,
        settings: {
          ...login.settings,
          allowedOrigins: ['https://untrusted.invalid'],
        },
      }),
      /failed at username/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
