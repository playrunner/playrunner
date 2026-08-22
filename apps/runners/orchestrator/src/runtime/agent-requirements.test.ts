import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentRequirements } from './agent-requirements';

test('allows an agent run with no external requirement sources', async () => {
  assert.deepEqual(await resolveAgentRequirements({}, {}), []);
});

test('loads normalized GitHub issue requirements', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      'https://github-api.test/repos/playrunner/example/issues/42',
    );
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      'Bearer github-secret',
    );
    return Response.json({
      body: 'Given a declined payment, show an error.',
      title: 'Handle declined payments',
    });
  };

  const requirements = await resolveAgentRequirements(
    { githubIssue: 'playrunner/example#42' },
    {
      github: {
        accessToken: 'github-secret',
        apiBaseUrl: 'https://github-api.test',
      },
    },
  );

  assert.deepEqual(requirements, [
    {
      body: 'Given a declined payment, show an error.',
      id: 'playrunner/example#42',
      source: 'github',
      title: 'Handle declined payments',
      url: 'https://github.com/playrunner/example/issues/42',
    },
  ]);
});

test('loads Jira summary and ADF description requirements', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/oauth/token/accessible-resources')) {
      return Response.json([
        { id: 'cloud-1', url: 'https://playrunner.atlassian.net' },
      ]);
    }
    assert.match(url, /\/issue\/PAY-18\?fields=summary,description$/);
    return Response.json({
      fields: {
        description: {
          content: [
            {
              content: [{ text: 'Reject expired cards.', type: 'text' }],
              type: 'paragraph',
            },
          ],
          type: 'doc',
        },
        summary: 'Validate card expiry',
      },
    });
  };

  const requirements = await resolveAgentRequirements(
    { jiraIssue: 'PAY-18' },
    {
      jira: {
        accessToken: 'jira-secret',
        apiBaseUrl: 'https://jira-api.test',
      },
    },
  );

  assert.deepEqual(requirements, [
    {
      body: 'Reject expired cards.',
      id: 'PAY-18',
      source: 'jira',
      title: 'Validate card expiry',
      url: 'https://playrunner.atlassian.net/browse/PAY-18',
    },
  ]);
});
