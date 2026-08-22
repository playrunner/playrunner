import http from 'node:http';

const port = Number(process.env.PLAYRUNNER_E2E_GITHUB_FAKE_PORT ?? 4010);
const repository = 'playrunner/e2e-fixture';
const forkRepository = 'playrunner-bot/e2e-fixture';
let nextIssueNumber = 1;
const issues: Array<Record<string, unknown>> = [];

function sendJson(
  response: http.ServerResponse,
  status: number,
  body: unknown,
) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200);
    response.end('OK');
    return;
  }

  if (request.method === 'GET' && url.pathname === '/user/installations') {
    sendJson(response, 200, { installations: [{ id: 1 }] });
    return;
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/user/installations/1/repositories'
  ) {
    sendJson(response, 200, {
      repositories: [
        { full_name: repository, id: 1 },
        { full_name: forkRepository, id: 2 },
      ],
    });
    return;
  }

  if (
    request.method === 'GET' &&
    url.pathname === `/repos/${repository}/branches`
  ) {
    sendJson(response, 200, [{ name: 'main' }]);
    return;
  }

  if (request.method === 'GET' && url.pathname === `/repos/${repository}`) {
    sendJson(response, 200, { full_name: repository, id: 1 });
    return;
  }

  if (
    request.method === 'POST' &&
    url.pathname === `/repos/${repository}/issues`
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
      string,
      unknown
    >;
    const number = nextIssueNumber++;
    const issue = {
      body: input.body ?? null,
      html_url: `http://127.0.0.1:${port}/issues/${number}`,
      number,
      state: 'open',
      title: input.title,
      url: `http://127.0.0.1:${port}/repos/${repository}/issues/${number}`,
    };
    issues.push(issue);
    sendJson(response, 201, issue);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/__e2e/issues') {
    const title = url.searchParams.get('title');
    sendJson(
      response,
      200,
      issues.filter((issue) => !title || issue.title === title),
    );
    return;
  }

  sendJson(response, 404, { message: 'Not found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`GitHub E2E fake listening on ${port}`);
});

const shutdown = () => server.close();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
