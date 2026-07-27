import { type ChildProcess, execFile, spawn } from 'child_process';
import { PORT } from '../config';

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const START_TIMEOUT_MS = 30_000;
const REACHABLE_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_LOG_LINES = 40;
const MAX_LOG_LINE_LENGTH = 500;
const ANSI_ESCAPE_PATTERN = new RegExp(
  String.raw`\u001B\[[0-?]*[ -/]*[@-~]`,
  'g',
);

class TunnelService {
  private child: ChildProcess | null = null;
  private error = '';
  private logs: string[] = [];
  private message = 'Tunnel is stopped.';
  private status: TunnelStatus = 'stopped';
  private url = '';

  getState() {
    return {
      error: this.error,
      logs: [...this.logs],
      message: this.message,
      status: this.status,
      url: this.url,
    };
  }

  async start(): Promise<{ url: string }> {
    if (this.status === 'running' && this.url) return { url: this.url };
    if (this.status === 'starting') {
      throw new Error('A Cloudflare tunnel is already starting.');
    }

    this.status = 'starting';
    this.error = '';
    this.logs = [];
    this.message = 'Checking for cloudflared…';
    this.url = '';
    this.addLog(
      'Checking that cloudflared is installed and available on PATH.',
    );

    try {
      await this.assertInstalled();
      this.addLog('cloudflared is available.');
      this.message = 'Starting cloudflared…';
      this.addLog(`Starting a quick tunnel to http://localhost:${PORT}.`);

      const child = spawn(
        'cloudflared',
        ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      this.child = child;
      const recordOutput = (chunk: Buffer) => this.addOutput(chunk);
      child.stdout?.on('data', recordOutput);
      child.stderr?.on('data', recordOutput);

      const url = await this.waitForUrl(child);
      this.url = url;
      this.message = 'Waiting for Cloudflare DNS and routing…';
      this.addLog(`Cloudflare assigned ${url}.`);
      this.addLog('Waiting for the public URL to reach the local API.');
      await this.waitUntilReachable(url);
      this.status = 'running';
      this.message = 'Tunnel is publicly reachable.';
      this.addLog('Tunnel is ready and publicly reachable.');
      child.once('exit', () => {
        if (this.child !== child) return;
        this.child = null;
        this.status = 'error';
        this.error = 'cloudflared exited unexpectedly.';
        this.message = this.error;
        this.url = '';
        this.addLog(this.error);
      });
      return { url };
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.status = 'error';
      this.message = this.error;
      this.addLog(`Tunnel startup failed: ${this.error}`);
      this.cleanup();
      throw error;
    }
  }

  stop() {
    this.cleanup();
    this.error = '';
    this.message = 'Tunnel is stopped.';
    this.status = 'stopped';
    this.url = '';
    this.addLog('Tunnel stopped.');
  }

  private assertInstalled(): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('cloudflared', ['--version'], (error) => {
        if (error) {
          reject(
            new Error(
              'cloudflared is not installed or is not on PATH. Install it, then try again.',
            ),
          );
          return;
        }
        resolve();
      });
    });
  }

  private waitForUrl(child: ChildProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        callback();
      };
      const onData = (chunk: Buffer) => {
        const match = chunk.toString().match(URL_PATTERN);
        if (match) finish(() => resolve(match[0]));
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.once('error', (error) => finish(() => reject(error)));
      child.once('exit', (code) =>
        finish(() =>
          reject(
            new Error(
              `cloudflared exited with code ${String(code)} before publishing a URL.`,
            ),
          ),
        ),
      );
      const timeout = setTimeout(
        () =>
          finish(() =>
            reject(new Error('Timed out waiting for the Cloudflare tunnel.')),
          ),
        START_TIMEOUT_MS,
      );
    });
  }

  private async waitUntilReachable(url: string) {
    const deadline = Date.now() + REACHABLE_TIMEOUT_MS;
    let lastError = 'unknown network error';
    let attempts = 0;
    while (Date.now() < deadline) {
      attempts += 1;
      try {
        const response = await fetch(new URL('/health', url));
        if (!response.ok) {
          throw new Error(`health check returned HTTP ${response.status}`);
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempts === 1 || attempts % 5 === 0) {
          this.addLog(`Public reachability check pending: ${lastError}`);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
    throw new Error(`Cloudflare tunnel did not become reachable: ${lastError}`);
  }

  private cleanup() {
    if (!this.child) return;
    this.child.removeAllListeners();
    this.child.kill('SIGTERM');
    this.child = null;
  }

  private addOutput(chunk: Buffer) {
    for (const line of chunk.toString('utf8').split(/\r?\n/g)) {
      const normalized = line.replace(ANSI_ESCAPE_PATTERN, '').trim();
      if (normalized) this.addLog(normalized);
    }
  }

  private addLog(line: string) {
    const timestamp = new Date().toLocaleTimeString('en-AU', {
      hour12: false,
    });
    this.logs.push(`[${timestamp}] ${line.slice(0, MAX_LOG_LINE_LENGTH)}`);
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
    }
  }
}

export const tunnelService = new TunnelService();
