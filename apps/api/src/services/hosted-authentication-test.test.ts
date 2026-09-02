import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hostedAuthenticationTestScript,
  hostedAuthenticationTestSessionId,
  parseHostedAuthenticationTestSessionId,
} from './hosted-authentication-test';

test('builds an inline hosted test without interpolating executable profile data', () => {
  const script = hostedAuthenticationTestScript({
    startUrl: "https://example.test/'\\nthrow new Error('injected')",
    successCondition: {
      type: 'url_prefix',
      value: "https://example.test/projects?value='",
    },
  });

  assert.ok(
    script.includes(
      `page.goto(${JSON.stringify("https://example.test/'\\nthrow new Error('injected')")}`,
    ),
  );
  assert.match(
    script,
    /page\.url\(\)\.startsWith\("https:\/\/example\.test\/projects/,
  );
  assert.doesNotMatch(script, /page\.goto\('https/);
});

test('round trips hosted test session identifiers', () => {
  const profileId = '11111111-1111-4111-8111-111111111111';
  const executionId = '22222222-2222-4222-8222-222222222222';
  const sessionId = hostedAuthenticationTestSessionId(profileId, executionId);

  assert.deepEqual(parseHostedAuthenticationTestSessionId(sessionId), {
    executionId,
    profileId,
  });
  assert.equal(parseHostedAuthenticationTestSessionId('not-hosted'), null);
});
