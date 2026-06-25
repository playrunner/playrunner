import { ChildProcess, execFile, spawn } from 'child_process';
import { PORT } from '../config';

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

const TRYCLOUDFLARE_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const START_TIMEOUT_MS = 30000;
const REACHABLE_TIMEOUT_MS = 60000;
const REACHABLE_POLL_INTERVAL_MS = 2000;
const REACHABLE_PROBE_TIMEOUT_MS = 5000;
// Give DNS a moment to propagate before the first probe. Probing the instant
// cloudflared prints the name returns NXDOMAIN, which the OS resolver
// negatively caches — poisoning every retry within that cache's TTL.
const REACHABLE_INITIAL_DELAY_MS = 4000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// node's fetch throws a generic "fetch failed"; the actionable detail lives on
// the `cause` (e.g. ENOTFOUND, ECONNREFUSED, timeouts).
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  if (err.name === 'AbortError') {
    return 'request timed out';
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return code
      ? `${err.message} (${code}: ${cause.message})`
      : `${err.message} (${cause.message})`;
  }
  return err.message;
}

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REACHABLE_PROBE_TIMEOUT_MS);

  return fetch(url, {
    method: 'GET',
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
  });
}

class TunnelService {
  private process: ChildProcess | null = null;
  private url = '';
  private status: TunnelStatus = 'stopped';
  private error = '';

  getState() {
    return { error: this.error, status: this.status, url: this.url };
  }

  isActive(): boolean {
    return this.status === 'running' && Boolean(this.url);
  }

  async assertReachable(url = this.url): Promise<void> {
    if (!url) {
      throw new Error('No Cloudflare tunnel URL is available.');
    }

    try {
      // Any HTTP response (even 404) proves the public name resolves and
      // routes through the tunnel to the local API. Network/DNS failures throw.
      await fetchWithTimeout(new URL('/api/heartbeat', url).toString());
    } catch (err) {
      throw new Error(
        `Cloudflare tunnel ${url} is not reachable: ${describeFetchError(err)}`,
      );
    }
  }

  markUnreachable(message: string, expectedUrl?: string) {
    if (expectedUrl && this.url !== expectedUrl) {
      return;
    }

    this.cleanupProcess();
    this.status = 'error';
    this.error = message;
    this.url = '';
  }

  async start(): Promise<{ url: string }> {
    if (this.isActive()) {
      return { url: this.url };
    }
    if (this.status === 'starting') {
      throw new Error('A tunnel is already starting.');
    }

    await this.ensureCloudflaredInstalled();

    this.status = 'starting';
    this.error = '';
    this.url = '';

    const child = spawn(
      'cloudflared',
      ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.process = child;

    try {
      this.url = await this.waitForTunnelUrl(child);
      await this.waitForTunnelReachable(this.url);
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      this.cleanupProcess();
      this.url = '';
      throw err;
    }

    this.status = 'running';
    console.log(`[tunnel] running at ${this.url}`);
    child.on('exit', () => {
      if (this.process === child) {
        this.process = null;
        this.status = 'stopped';
        this.url = '';
      }
    });

    return { url: this.url };
  }

  stop() {
    this.cleanupProcess();
    this.status = 'stopped';
    this.url = '';
    this.error = '';
  }

  private waitForTunnelUrl(child: ChildProcess): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      // Keep recent cloudflared output so failures can report the real reason
      // (e.g. an auth/network error) instead of an opaque exit code.
      let output = '';

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        fn();
      };

      const tail = () => output.trim().split('\n').slice(-8).join('\n');

      // cloudflared prints the assigned URL to stderr.
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        output += text;
        const match = text.match(TRYCLOUDFLARE_URL_REGEX);
        if (match) {
          finish(() => resolve(match[0]));
        }
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (err) => finish(() => reject(err)));
      child.on('exit', (code) =>
        finish(() =>
          reject(
            new Error(
              `cloudflared exited (code ${code}) before a tunnel URL was established.${
                tail() ? `\n${tail()}` : ''
              }`,
            ),
          ),
        ),
      );

      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new Error(
                `Timed out waiting for cloudflared to establish a tunnel.${
                  tail() ? `\n${tail()}` : ''
                }`,
              ),
            ),
          ),
        START_TIMEOUT_MS,
      );
    });
  }

  // A freshly created *.trycloudflare.com name is registered the moment
  // cloudflared prints it, but is not yet globally resolvable. We best-effort
  // wait for the public URL to respond so DNS has time to propagate before a
  // cloud runner uses it. This probe runs against *this machine's* resolver, so
  // it is advisory only — cloud runners resolve via their own resolvers and are
  // unaffected by a local negative-cache, so we never fail the tunnel on it.
  private async waitForTunnelReachable(url: string): Promise<void> {
    await delay(REACHABLE_INITIAL_DELAY_MS);

    const deadline = Date.now() + REACHABLE_TIMEOUT_MS;
    let lastError = '';

    while (Date.now() < deadline) {
      try {
        await this.assertReachable(url);
        console.log(`[tunnel] confirmed publicly reachable at ${url}`);
        return;
      } catch (err) {
        lastError = describeFetchError(err);
        await delay(REACHABLE_POLL_INTERVAL_MS);
      }
    }

    console.warn(
      `[tunnel] started but could not confirm public reachability from this ` +
        `machine within ${REACHABLE_TIMEOUT_MS / 1000}s (last error: ${lastError}). ` +
        `Proceeding — cloud runners may need a few seconds for DNS to propagate.`,
    );
  }

  private cleanupProcess() {
    if (this.process) {
      this.process.removeAllListeners('exit');
      try {
        this.process.kill('SIGTERM');
      } catch {
        // Process may already be gone; ignore.
      }
      this.process = null;
    }
  }

  private ensureCloudflaredInstalled(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      execFile('cloudflared', ['--version'], (err) => {
        if (err) {
          reject(
            new Error(
              'cloudflared is not installed or not on your PATH. Install it (for example `brew install cloudflared`) and try again.',
            ),
          );
          return;
        }
        resolve();
      });
    });
  }
}

export const tunnelService = new TunnelService();
