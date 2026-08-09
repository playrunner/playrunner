import http from 'node:http';

const port = Number(process.env.PLAYRUNNER_E2E_SLACK_FAKE_PORT ?? 4012);

function sendJson(
  response: http.ServerResponse,
  status: number,
  body: unknown,
) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200);
    response.end('OK');
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/conversations.list') {
    sendJson(response, 200, {
      ok: true,
      channels: [
        { id: 'C-E2E-PUBLIC', name: 'playrunner-e2e', is_private: false },
        { id: 'C-E2E-PRIVATE', name: 'private-e2e', is_private: true },
      ],
    });
    return;
  }
  sendJson(response, 404, { ok: false, error: 'not_found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Slack E2E fake listening on ${port}`);
});

const shutdown = () => server.close();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
