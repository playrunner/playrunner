import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pluginRoot } from '../scripts/package.mjs';

const calls = [];
let outcome = 'completed';
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  calls.push({
    path: req.url,
    method: req.method,
    auth: req.headers.authorization,
    body,
  });
  res.setHeader('Content-Type', 'application/json');
  if (outcome === 'unauthorized') {
    res.writeHead(401).end(JSON.stringify({ error: 'Invalid API token' }));
  } else if (req.method === 'POST') {
    res
      .writeHead(202)
      .end(JSON.stringify({ executionId: 'plugin-smoke', status: 'running' }));
  } else if (req.url.includes('/events?')) {
    res.end(
      JSON.stringify({
        events: [{ sequence: '1', message: 'Smoke progress' }],
      }),
    );
  } else {
    res.end(JSON.stringify({ executionId: 'plugin-smoke', status: outcome }));
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');

try {
  for (const [status, expectedCode] of [
    ['completed', 0],
    ['failed', 1],
    ['unauthorized', 2],
  ]) {
    outcome = status;
    calls.length = 0;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(PLAYRUNNER_|GITHUB_)/.test(key),
      ),
    );
    const child = spawn(
      process.execPath,
      [
        join(pluginRoot, 'scripts/playrunner.mjs'),
        'smoke-workflow',
        '--json',
        '--timeout',
        '10s',
        '--input',
        'scenario=plugin smoke',
      ],
      {
        env: {
          ...env,
          PLAYRUNNER_URL: `http://127.0.0.1:${server.address().port}`,
          PLAYRUNNER_API_KEY: 'test-only-token',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 120_000);
    const [code] = await once(child, 'close');
    clearTimeout(timeout);
    assert.equal(code, expectedCode, stderr);
    assert.ok(calls.length > 0);
    assert.ok(calls.every((call) => call.auth === 'Bearer test-only-token'));
    assert.equal(calls[0].path, '/api/v1/workflows/smoke-workflow/executions');
    assert.equal(JSON.parse(calls[0].body).inputs.scenario, 'plugin smoke');
    assert.doesNotMatch(stdout + stderr, /test-only-token/);
    if (status !== 'unauthorized') {
      const records = stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(records[0].executionId, 'plugin-smoke');
      assert.equal(records.at(-1).status, status);
      assert.ok(records.some((record) => record.message === 'Smoke progress'));
    } else {
      assert.match(stderr, /Invalid API token/);
    }
    console.log(`Published CLI smoke passed: ${status} (exit ${code})`);
  }
} finally {
  server.close();
  server.closeAllConnections();
}
