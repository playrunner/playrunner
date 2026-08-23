#!/usr/bin/env node
import fs from 'fs';
import { createCredentialFreeEnvironment } from './codex-auth';
import { runProcess } from './process';
import { validateTestSuite } from './validation-suite';
import { runVitestCoverage } from './vitest-validator';

async function main() {
  const configPath = process.env.PLAYRUNNER_VALIDATOR_CONFIG;
  const config =
    configPath && fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
      : {};
  const validationEnvironment = createCredentialFreeEnvironment(
    {},
    process.env,
  );
  const result = await validateTestSuite(process.cwd(), config, {
    authoritative: true,
    runCommand: (command, cwd, timeoutMs, environment) =>
      runProcess('/bin/sh', ['-c', command], {
        cwd,
        env: { ...validationEnvironment, ...environment },
        maxOutputBytes: 1_000_000,
        stream: true,
        timeoutMs,
      }),
    runUnitCoverage: (cwd, timeoutMs, minimum) =>
      runVitestCoverage(cwd, {
        environment: validationEnvironment,
        maxOutputBytes: 1_000_000,
        minimumBranchCoverage: minimum.branchCoverage,
        minimumLineCoverage: minimum.lineCoverage,
        timeoutMs,
      }),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.passed ? 0 : 1;
}

void main();
