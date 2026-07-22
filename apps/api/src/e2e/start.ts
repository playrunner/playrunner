import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

const apiDirectory = process.cwd();

loadEnv({ path: path.join(apiDirectory, '.env'), quiet: true });

const sourceDatabaseUrl =
  process.env.PLAYRUNNER_E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!sourceDatabaseUrl) {
  throw new Error(
    'E2E requires DATABASE_URL in apps/api/.env or PLAYRUNNER_E2E_DATABASE_URL.',
  );
}

const databaseUrl = new URL(sourceDatabaseUrl);
databaseUrl.searchParams.set('schema', 'playrunner_e2e');

process.env.DATABASE_URL = databaseUrl.toString();
process.env.PORT = '3999';
process.env.PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEY_VERSION = '1';
process.env.PLAYRUNNER_CREDENTIAL_ENCRYPTION_KEYS = JSON.stringify({
  1: Buffer.alloc(32, 7).toString('base64'),
});

const prismaBin = path.join(
  apiDirectory,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);
const pushResult = spawnSync(prismaBin, ['db', 'push'], {
  cwd: apiDirectory,
  encoding: 'utf8',
  env: process.env,
});

if (pushResult.status !== 0) {
  throw new Error(
    `Failed to prepare the E2E database schema.\n${pushResult.stderr || pushResult.stdout}`,
  );
}

async function startE2EApi() {
  const { prisma } = await import('../lib/prisma');

  await prisma.$transaction([
    prisma.workflowEvent.deleteMany(),
    prisma.workflowScheduleTrigger.deleteMany(),
    prisma.workflowSchedule.deleteMany(),
    prisma.workflowExecution.deleteMany(),
    prisma.workflow.deleteMany(),
    prisma.project.deleteMany(),
    prisma.connection.deleteMany(),
    prisma.environment.deleteMany(),
    prisma.secret.deleteMany(),
  ]);

  const { configureLocalAuth } = await import('../auth/local-auth');
  await configureLocalAuth({
    jwtSecret: 'playrunner-e2e-jwt-secret-with-at-least-32-bytes',
    password: 'playrunner-e2e-password',
    username: 'e2e@playrunner.dev',
  });

  await import('../index');
}

void startE2EApi().catch((error) => {
  console.error('Failed to start the E2E API:', error);
  process.exit(1);
});
