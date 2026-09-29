import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';

// Pin DNS at the outbound proxy: Chromium never resolves an approved hostname
// a second time, so a DNS change cannot redirect it into a private network.
export function publicAddress(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export async function createPublicProxy({ lookup = dns.lookup } = {}) {
  const sockets = new Set();
  async function target(host, port) {
    if (![80, 443].includes(Number(port))) throw new Error('Blocked port');
    const records = await lookup(host, { all: true, family: 4 });
    if (
      !records.length ||
      records.some(({ address }) => !publicAddress(address))
    )
      throw new Error('Blocked address');
    return records[0].address;
  }
  const proxy = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url);
      if (url.protocol !== 'http:' || url.username || url.password)
        throw new Error('Blocked URL');
      const address = await target(url.hostname, url.port || 80);
      const headers = { ...req.headers, host: url.host };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const upstream = http.request(
        {
          host: address,
          port: url.port || 80,
          path: `${url.pathname}${url.search}`,
          method: req.method,
          headers,
          timeout: 30_000,
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    } catch {
      res.writeHead(403);
      res.end();
    }
  });
  proxy.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  proxy.on('connect', async (req, client, head) => {
    try {
      const url = new URL(`https://${req.url}`);
      const port = Number(url.port || 443);
      const address = await target(url.hostname, port);
      const upstream = net.connect(port, address);
      sockets.add(upstream);
      upstream.on('close', () => sockets.delete(upstream));
      upstream.setTimeout(60_000, () => upstream.destroy());
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      client.on('close', () => upstream.destroy());
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    }
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  return {
    server: `http://127.0.0.1:${proxy.address().port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => proxy.close(resolve));
    },
  };
}

export async function checkBrowserSession({
  chromium,
  profile,
  state,
  proxy,
  timeout = 45_000,
}) {
  let browser;
  let timer;
  try {
    const start = new URL(profile.startUrl);
    if (
      !['http:', 'https:'].includes(start.protocol) ||
      start.username ||
      start.password
    )
      throw new Error('Invalid start URL');
    browser = await chromium.launch({
      headless: true,
      proxy: { server: proxy.server },
      args: [
        '--proxy-bypass-list=<-loopback>',
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      ],
      // Do not inherit API credentials or debug logging into the browser process.
      env: Object.fromEntries(
        ['PATH', 'HOME', 'TMPDIR', 'LD_LIBRARY_PATH']
          .filter((key) => process.env[key])
          .map((key) => [key, process.env[key]]),
      ),
    });
    const deadline = Date.now() + timeout;
    const remaining = () => Math.max(1, deadline - Date.now());
    timer = setTimeout(() => void browser.close(), timeout + 5000);
    const context = await browser.newContext({
      storageState: state,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    await context.route('**/*', (route) => {
      const protocol = new URL(route.request().url()).protocol;
      return ['http:', 'https:'].includes(protocol)
        ? route.continue()
        : route.abort();
    });
    const page = await context.newPage();
    const response = await page.goto(start.href, {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    if (!response || response.status() >= 500 || response.status() === 429)
      return { result: 'error' };
    await page
      .waitForLoadState('networkidle', { timeout: Math.min(5000, remaining()) })
      .catch(() => {});
    try {
      if (profile.successConditionType === 'element_visible') {
        await page
          .locator(profile.successConditionValue)
          .first()
          .waitFor({ state: 'visible', timeout: remaining() });
      } else {
        await page.waitForURL(
          (url) =>
            profile.successConditionType === 'url_exact'
              ? url.href === profile.successConditionValue
              : url.href.startsWith(profile.successConditionValue),
          { timeout: remaining() },
        );
      }
    } catch {
      // A timeout or failed request alone does not prove the login expired.
      const loginVisible = await page
        .locator('input[type="password"]')
        .first()
        .isVisible()
        .catch(() => false);
      return { result: loginVisible ? 'needs_reauth' : 'error' };
    }
    if (response.status() >= 400) return { result: 'error' };
    const refreshed = await context.storageState({ indexedDB: true });
    if (Buffer.byteLength(JSON.stringify(refreshed)) > 5 * 1024 * 1024)
      return { result: 'error' };
    const expiries = refreshed.cookies
      .map((cookie) => cookie.expires * 1000)
      .filter((expires) => expires > Date.now());
    return {
      result: 'valid',
      state: refreshed,
      cookieExpiryHint: expiries.length
        ? new Date(Math.min(...expiries))
        : null,
    };
  } catch {
    return { result: 'error' };
  } finally {
    clearTimeout(timer);
    await browser?.close().catch(() => {});
  }
}
