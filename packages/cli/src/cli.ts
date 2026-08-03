#!/usr/bin/env node
import { runCli } from './run.js';

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort(new Error(signal)));
}

const exitCode = await runCli(process.argv.slice(2), {
  signal: controller.signal,
});
process.exitCode = exitCode;
