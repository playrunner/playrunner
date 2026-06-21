import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.SETUP_INSTALLER_PORT || '3003', 10);
const SETUP_SESSION_TOKEN = process.env.SETUP_SESSION_TOKEN || '';

function getRepoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function getSetupStatePath() {
  return path.join(getRepoRoot(), 'setup', 'installer', '.setup-state.json');
}

function getApiDir() {
  return path.join(getRepoRoot(), 'apps', 'api');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function normalizePostgresUrl(value, fieldName, required = false) {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!trimmed) {
    if (required) {
      throw new Error(`Missing required field: ${fieldName}`);
    }
    return undefined;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${fieldName} must be a valid postgres:// or postgresql:// URL.`);
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${fieldName} must use the postgres:// or postgresql:// protocol.`);
  }

  return trimmed;
}

function normalizePostgresSetupPayload(body) {
  return {
    databaseUrl: normalizePostgresUrl(body.databaseUrl, 'DATABASE_URL', true),
    directUrl: normalizePostgresUrl(body.directUrl, 'DIRECT_URL'),
    shadowDatabaseUrl: normalizePostgresUrl(body.shadowDatabaseUrl, 'SHADOW_DATABASE_URL'),
    username: normalizeUsername(body.username),
    password: normalizePassword(body.password),
  };
}

function normalizeUsername(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!trimmed) {
    throw new Error('Missing required field: LOCAL_AUTH_USERNAME');
  }

  return trimmed;
}

function normalizePassword(value) {
  const password = typeof value === 'string' ? value : '';

  if (!password.trim()) {
    throw new Error('Missing required field: LOCAL_AUTH_PASSWORD');
  }

  if (password.trim().length < 8) {
    throw new Error('LOCAL_AUTH_PASSWORD must be at least 8 characters.');
  }

  return password;
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody);
}

function formatEnvValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function getEnvVariable(lines, key) {
  const line = lines.find((entry) => entry.startsWith(`${key}=`));
  if (!line) {
    return undefined;
  }

  return parseEnvValue(line.slice(key.length + 1));
}

function upsertEnvVariable(lines, key, value) {
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));

  if (!value) {
    if (index !== -1) {
      lines.splice(index, 1);
    }
    return;
  }

  const renderedLine = `${key}=${formatEnvValue(value)}`;
  if (index === -1) {
    lines.push(renderedLine);
    return;
  }

  lines[index] = renderedLine;
}

function ensureEnvVariable(lines, key, createValue) {
  const existingValue = getEnvVariable(lines, key);

  if (existingValue) {
    return existingValue;
  }

  const value = createValue();
  upsertEnvVariable(lines, key, value);
  return value;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

async function ensureApiEnvFile() {
  const apiDir = getApiDir();
  const envPath = path.join(apiDir, '.env');
  const envExamplePath = path.join(apiDir, '.env.example');

  try {
    await fs.access(envPath);
  } catch {
    try {
      await fs.copyFile(envExamplePath, envPath);
    } catch {
      await fs.writeFile(envPath, '', 'utf8');
    }
  }

  return envPath;
}

function renderPrismaSchema(config) {
  const optionalDatasourceLines = [];

  if (config.directUrl) {
    optionalDatasourceLines.push('  directUrl = env("DIRECT_URL")');
  }

  if (config.shadowDatabaseUrl) {
    optionalDatasourceLines.push('  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")');
  }

  const datasourceBlock = [
    'datasource db {',
    '  provider = "postgresql"',
    '  url      = env("DATABASE_URL")',
    ...optionalDatasourceLines,
    '}',
  ].join('\n');

  return `generator client {
  provider = "prisma-client-js"
}

${datasourceBlock}

model Project {
  id        String     @id
  userId    String
  title     String?
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  workflows Workflow[]

  @@index([userId])
}

model Workflow {
  id           String    @id
  userId       String
  projectId    String?
  title        String?
  nodes        Json?
  connections  Json?
  cloudProvider String?
  concurrency  Int?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  project      Project?  @relation(fields: [projectId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([projectId])
}

model Integration {
  id        String   @id @default(cuid())
  userId    String
  provider  String
  data      Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, provider])
  @@index([userId])
}

model CloudCredential {
  id        String   @id @default(cuid())
  userId    String
  provider  String
  data      Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, provider])
  @@index([userId])
}

model Environment {
  id          String   @id
  userId      String
  name        String
  description String?
  variables   Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId])
}

model Secret {
  id          String   @id @default(cuid())
  userId      String
  secretKey   String
  value       String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([userId, secretKey])
  @@index([userId])
}
`;
}

function renderPrismaClientTs() {
  return `import {PrismaClient} from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}
`;
}

async function installPostgresFiles(config) {
  const apiDir = getApiDir();
  const prismaDir = path.join(apiDir, 'prisma');
  const apiLibDir = path.join(apiDir, 'src', 'lib');
  const envPath = await ensureApiEnvFile();

  await fs.mkdir(prismaDir, {recursive: true});
  await fs.mkdir(apiLibDir, {recursive: true});

  const envContents = await fs.readFile(envPath, 'utf8').catch(() => '');
  const envLines = envContents ? envContents.split(/\r?\n/) : [];

  upsertEnvVariable(envLines, 'DATABASE_URL', config.databaseUrl);
  upsertEnvVariable(envLines, 'DIRECT_URL', config.directUrl);
  upsertEnvVariable(envLines, 'SHADOW_DATABASE_URL', config.shadowDatabaseUrl);
  upsertEnvVariable(envLines, 'LOCAL_AUTH_USERNAME', config.username);
  upsertEnvVariable(envLines, 'LOCAL_AUTH_PASSWORD_HASH', hashPassword(config.password));
  ensureEnvVariable(envLines, 'AUTH_JWT_SECRET', () => crypto.randomBytes(32).toString('hex'));

  while (envLines.length > 0 && envLines[envLines.length - 1] === '') {
    envLines.pop();
  }

  await fs.writeFile(envPath, `${envLines.join('\n')}\n`, 'utf8');
  await fs.writeFile(path.join(prismaDir, 'schema.prisma'), renderPrismaSchema(config), 'utf8');
  await fs.writeFile(path.join(apiLibDir, 'prisma.ts'), renderPrismaClientTs(), 'utf8');
}

async function markSetupCompleted() {
  await fs.writeFile(
    getSetupStatePath(),
    `${JSON.stringify({completedAt: new Date().toISOString()}, null, 2)}\n`,
    'utf8',
  );
}

async function getSetupState() {
  try {
    const raw = await fs.readFile(getSetupStatePath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getRequestUrl(req) {
  return new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
}

function isValidSetupSessionToken(token) {
  return Boolean(SETUP_SESSION_TOKEN) && token === SETUP_SESSION_TOKEN;
}

async function handleRequest(req, res) {
  const requestUrl = getRequestUrl(req);
  const setupState = await getSetupState();
  const isCompleted = Boolean(setupState?.completedAt);

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(res, 200, {ok: true});
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/setup/session') {
    const token = requestUrl.searchParams.get('token') || '';

    sendJson(res, 200, {
      completed: isCompleted,
      enabled: !isCompleted && isValidSetupSessionToken(token),
    });
    return;
  }

  if (
    req.method === 'POST' &&
    (requestUrl.pathname === '/setup/runtime/generate' ||
      requestUrl.pathname === '/setup/runtime/complete')
  ) {
    try {
      const token = requestUrl.searchParams.get('token') || '';

      if (isCompleted) {
        sendJson(res, 403, {error: 'Setup has already been completed.'});
        return;
      }

      if (!isValidSetupSessionToken(token)) {
        sendJson(res, 403, {error: 'Missing or invalid setup session token.'});
        return;
      }

      const payload = normalizePostgresSetupPayload(await readJsonBody(req));

      await installPostgresFiles(payload);
      if (requestUrl.pathname === '/setup/runtime/complete') {
        await markSetupCompleted();
      }

      sendJson(res, 200, {ok: true});
      return;
    } catch (error) {
      const isParseError = error instanceof SyntaxError;
      const statusCode = isParseError ? 400 : 500;
      const message = isParseError
        ? 'Invalid JSON payload.'
        : error instanceof Error
          ? error.message
          : 'Failed to install PostgreSQL, Prisma, and local auth setup files.';

      console.error('Installer service error:', error);
      sendJson(res, statusCode, {error: message});
      return;
    }
  }

  sendJson(res, 404, {error: 'Not found'});
}

export function createInstallerServer() {
  return http.createServer((req, res) => {
    void handleRequest(req, res);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createInstallerServer();
  server.listen(PORT, () => {
    console.log(`Setup installer service listening on http://127.0.0.1:${PORT}`);
    if (SETUP_SESSION_TOKEN) {
      console.log(`Setup session token active: ${SETUP_SESSION_TOKEN}`);
    } else {
      console.log('Setup session token not provided. Setup UI remains locked.');
    }
  });
}
