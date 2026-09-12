import assert from 'node:assert/strict';

const issuer = 'https://playrunner.cloud';
for (const [path, check] of [
  [
    '/.well-known/oauth-protected-resource/mcp',
    (body) => {
      assert.equal(body.resource, `${issuer}/mcp`);
      assert.deepEqual(body.authorization_servers, [issuer]);
    },
  ],
  [
    '/.well-known/oauth-authorization-server',
    (body) => {
      assert.equal(body.issuer, issuer);
      assert.ok(body.code_challenge_methods_supported.includes('S256'));
      assert.equal(body.token_endpoint, `${issuer}/oauth/token`);
    },
  ],
  [
    '/.well-known/openid-configuration',
    (body) => {
      assert.equal(body.userinfo_endpoint, `${issuer}/oauth/userinfo`);
      assert.ok(body.scopes_supported.includes('email'));
    },
  ],
]) {
  const response = await fetch(`${issuer}${path}`, {
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  assert.equal(response.status, 200, `Discovery unavailable: ${path}`);
  check(await response.json());
  console.log(`Verified ${path}`);
}
const response = await fetch(`${issuer}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  signal: AbortSignal.timeout(15_000),
  redirect: 'error',
});
assert.equal(
  response.status,
  401,
  'Unauthenticated MCP requests must be rejected',
);
assert.match(
  response.headers.get('www-authenticate') || '',
  /oauth-protected-resource/,
);
console.log(
  'Hosted discovery and unauthenticated challenge pass. Complete the real OAuth and account workflow smoke tests before submission.',
);
