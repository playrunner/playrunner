import { ChildProcess, execFile, spawn } from 'child_process';
import { PORT } from '../config';

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

const TRYCLOUDFLARE_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const START_TIMEOUT_MS = 30000;
const REACHABLE_TIMEOUT_MS = 60000;
const REACHABLE_POLL_INTERVAL_MS = 2000;

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
    console.log(`[tunnel] ready and publicly reachable at ${this.url}`);
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

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        fn();
      };

      // cloudflared prints the assigned URL to stderr.
      const onData = (chunk: Buffer) => {
        const match = chunk.toString().match(TRYCLOUDFLARE_URL_REGEX);
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
              `cloudflared exited (code ${code}) before a tunnel URL was established.`,
            ),
          ),
        ),
      );

      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new Error(
                'Timed out waiting for cloudflared to establish a tunnel.',
              ),
            ),
          ),
        START_TIMEOUT_MS,
      );
    });
  }

  // A freshly created *.trycloudflare.com name is registered the moment
  // cloudflared prints it, but is not yet globally resolvable. Handing it to a
  // cloud runner immediately races DNS propagation (and a failed lookup gets
  // negatively cached), so we gate on the public URL being reachable first.
  private async waitForTunnelReachable(url: string): Promise<void> {
    const deadline = Date.now() + REACHABLE_TIMEOUT_MS;
    let lastError = '';

    while (Date.now() < deadline) {
      try {
        // Any HTTP response (even 404) proves the public name resolves and
        // routes through the tunnel to the local API. We only retry on
        // network/DNS errors, which throw.
        await fetch(`${url}/api/heartbeat`, { method: 'GET' });
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await new Promise((resolve) =>
          setTimeout(resolve, REACHABLE_POLL_INTERVAL_MS),
        );
      }
    }

    throw new Error(
      `Tunnel ${url} did not become publicly reachable within ${
        REACHABLE_TIMEOUT_MS / 1000
      }s (last error: ${lastError}).`,
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
