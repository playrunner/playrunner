import express from 'express';

const app = express();
const consumedTickets = new Set<string>();
const readyTickets = new Set<string>();

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.get('/ready', (req, res) => {
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
  res.json({ ready: readyTickets.has(ticket) });
});

app.post('/ready', (req, res) => {
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
  if (ticket) readyTickets.add(ticket);
  res.status(204).end();
});

app.get('/login', (req, res) => {
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
  const hasSession = /(?:^|;\s*)demo_auth=1(?:;|$)/.test(
    req.headers.cookie || '',
  );
  const mayAuthenticate = Boolean(ticket && !consumedTickets.has(ticket));
  if (mayAuthenticate) consumedTickets.add(ticket);
  res.type('html').send(`<!doctype html>
<html><body><main id="login">Demo login</main><script>
const authenticated = ${JSON.stringify(hasSession || mayAuthenticate)};
if (authenticated) {
  document.cookie = 'demo_auth=1; Path=/; SameSite=Lax';
  localStorage.setItem('demo-auth', 'authenticated');
  const request = indexedDB.open('demo-auth', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('sessions');
  request.onsuccess = () => {
    const transaction = request.result.transaction('sessions', 'readwrite');
    transaction.objectStore('sessions').put('authenticated', 'state');
    transaction.oncomplete = async () => {
      await fetch('/ready?ticket=${encodeURIComponent(ticket)}', { method: 'POST' });
      location.replace('/app');
    };
  };
}
</script></body></html>`);
});

app.get('/app', (req, res) => {
  const hasSession = /(?:^|;\s*)demo_auth=1(?:;|$)/.test(
    req.headers.cookie || '',
  );
  if (!hasSession) {
    res.redirect('/login');
    return;
  }
  res
    .type('html')
    .send(
      '<!doctype html><html><body><main data-testid="authenticated-app">Authenticated demo application</main></body></html>',
    );
});

app.listen(4013, '127.0.0.1', () => {
  console.log('Authentication demo listening on http://127.0.0.1:4013');
});
