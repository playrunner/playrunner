import http from 'node:http';

const port = Number(process.env.PLAYRUNNER_E2E_JIRA_FAKE_PORT ?? 4011);
const cloudId = 'playrunner-e2e-cloud';
const issues: Array<Record<string, unknown>> = [];
let nextIssueNumber = 1;

function sendJson(
  response: http.ServerResponse,
  status: number,
  body: unknown,
) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
    string,
    unknown
  >;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200);
    response.end('OK');
    return;
  }
  if (
    request.method === 'GET' &&
    url.pathname === '/oauth/token/accessible-resources'
  ) {
    sendJson(response, 200, [{ id: cloudId, name: 'Playrunner E2E' }]);
    return;
  }
  if (
    request.method === 'GET' &&
    url.pathname === `/ex/jira/${cloudId}/rest/api/3/project`
  ) {
    sendJson(response, 200, [
      {
        id: '10000',
        key: 'E2E',
        name: 'Playrunner E2E',
        issueTypes: [
          { id: '10001', name: 'Task' },
          { id: '10002', name: 'Bug' },
        ],
      },
    ]);
    return;
  }
  const issuePath = `/ex/jira/${cloudId}/rest/api/3/issue`;
  if (request.method === 'POST' && url.pathname === issuePath) {
    const input = await readJson(request);
    const key = `E2E-${nextIssueNumber++}`;
    issues.push({ key, ...input });
    sendJson(response, 201, { key });
    return;
  }
  if (request.method === 'PUT' && url.pathname.startsWith(`${issuePath}/`)) {
    const input = await readJson(request);
    const key = decodeURIComponent(url.pathname.slice(issuePath.length + 1));
    issues.push({ key, update: input });
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/__e2e/issues') {
    sendJson(response, 200, issues);
    return;
  }
  sendJson(response, 404, { message: 'Not found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Jira E2E fake listening on ${port}`);
});

const shutdown = () => server.close();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
