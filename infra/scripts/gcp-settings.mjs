import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const apiDir = path.join(repoRoot, 'apps', 'api');
const apiEnvPath = path.join(apiDir, '.env');

const args = process.argv.slice(2);
const command = args.shift();
const flags = parseFlags(args);

function parseFlags(rest) {
  const out = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq !== -1) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        out[token.slice(2)] = next;
        i++;
      } else {
        out[token.slice(2)] = 'true';
      }
    }
  }
  return out;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(apiEnvPath);

if (!process.env.DATABASE_URL) {
  fail(
    `DATABASE_URL is not set. Expected it in environment or ${path.relative(repoRoot, apiEnvPath)}.`,
  );
}

const requireFromApi = createRequire(path.join(apiDir, 'package.json'));
let PrismaClient;
try {
  ({ PrismaClient } = requireFromApi('@prisma/client'));
} catch (error) {
  fail(
    `Failed to load @prisma/client from ${path.relative(repoRoot, apiDir)}. Run "npm install" in apps/api first. (${error.message})`,
  );
}

const prisma = new PrismaClient();

try {
  const credential = await loadCredential();
  emit(command, credential);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await prisma.$disconnect().catch(() => {});
}

async function loadCredential() {
  const where = { provider: 'gcp' };
  if (flags['user-id']) where.userId = flags['user-id'];

  const records = await prisma.cloudCredential.findMany({ where });
  if (records.length === 0) {
    throw new Error(
      'No GCP cloud credential found. Connect GCP in the Integrations modal first.',
    );
  }
  if (records.length > 1 && !flags['user-id']) {
    const ids = records.map((r) => r.userId).join(', ');
    throw new Error(
      `Multiple GCP credentials found for users [${ids}]. Pass --user-id <id> to disambiguate.`,
    );
  }
  return records[0].data || {};
}

function emit(cmd, data) {
  switch (cmd) {
    case 'project-id':
      printRequired(data.selectedProject, 'selectedProject');
      break;
    case 'region':
      printRequired(data.cloudRunLocation, 'cloudRunLocation');
      break;
    case 'orchestrator-service-name':
      printRequired(data.orchestratorServiceName, 'orchestratorServiceName');
      break;
    case 'orchestrator-image-uri-template':
      printRequired(
        data.orchestratorImageUriTemplate,
        'orchestratorImageUriTemplate',
      );
      break;
    case 'playwright-image-uri-template':
      printRequired(
        data.playwrightImageUriTemplate,
        'playwrightImageUriTemplate',
      );
      break;
    case 'json':
      process.stdout.write(JSON.stringify(publicConfig(data)));
      break;
    default:
      fail(
        'Usage: node infra/scripts/gcp-settings.mjs <project-id|region|orchestrator-service-name|orchestrator-image-uri-template|playwright-image-uri-template|json> [--user-id <id>]',
      );
  }
}

function publicConfig(data) {
  return {
    selectedProject: data.selectedProject || null,
    cloudRunLocation: data.cloudRunLocation || null,
    orchestratorServiceName: data.orchestratorServiceName || null,
    orchestratorImageUriTemplate: data.orchestratorImageUriTemplate || null,
    playwrightImageUriTemplate: data.playwrightImageUriTemplate || null,
  };
}

function printRequired(value, label) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(
      `GCP setting "${label}" is empty. Save it in the Integrations modal first.`,
    );
  }
  process.stdout.write(trimmed);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
