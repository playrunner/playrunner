#!/usr/bin/env node
import fs from 'fs';
import { validatePlaywrightTests } from './validator';

async function main() {
  const configPath = process.env.PLAYRUNNER_VALIDATOR_CONFIG;
  const config =
    configPath && fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
      : {};
  const result = await validatePlaywrightTests(process.cwd(), config, {
    authoritative: true,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.passed ? 0 : 1;
}

void main();
