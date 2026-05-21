import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.SETUP_INSTALLER_PORT || '3003', 10);
const FIREBASE_TEMPLATE_FILES = [
  'firestore.indexes.json',
  'firestore.rules',
];
const REQUIRED_FIREBASE_FIELDS = [
  'projectId',
  'apiKey',
  'appId',
  'authDomain',
  'storageBucket',
  'messagingSenderId',
];
const SETUP_SESSION_TOKEN = process.env.SETUP_SESSION_TOKEN || '';

function getSetupStatePath() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  return path.join(repoRoot, 'setup', 'installer', '.setup-state.json');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function normalizeFirebaseSetupPayload(body) {
  return {
    apiKey: body.apiKey?.trim() ?? '',
    appId: body.appId?.trim() ?? '',
    authDomain: body.authDomain?.trim() ?? '',
    firestoreDatabaseId: body.firestoreDatabaseId?.trim() ?? '',
    firestoreLocation: body.firestoreLocation?.trim() ?? '',
    measurementId: body.measurementId?.trim() || undefined,
    messagingSenderId: body.messagingSenderId?.trim() ?? '',
    projectId: body.projectId?.trim() ?? '',
    storageBucket: body.storageBucket?.trim() ?? '',
  };
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

async function installFirebaseFiles(config) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const webDir = path.join(repoRoot, 'apps', 'web');
  const templateDir = path.join(repoRoot, 'setup', 'firebase');

  await fs.mkdir(webDir, { recursive: true });

  for (const fileName of FIREBASE_TEMPLATE_FILES) {
    await fs.copyFile(path.join(templateDir, fileName), path.join(webDir, fileName));
  }

  await fs.writeFile(
    path.join(webDir, 'firebase-config.json'),
    `${JSON.stringify(
      {
        apiKey: config.apiKey,
        appId: config.appId,
        authDomain: config.authDomain,
        firestoreDatabaseId: config.firestoreDatabaseId || undefined,
        measurementId: config.measurementId,
        messagingSenderId: config.messagingSenderId,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await fs.writeFile(
    path.join(webDir, '.firebaserc'),
    `${JSON.stringify(
      {
        projects: {
          default: config.projectId,
        },
        targets: {},
        etags: {},
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await fs.writeFile(
    path.join(webDir, 'firebase.json'),
    `${JSON.stringify(
      {
        firestore: {
          database: config.firestoreDatabaseId,
          location: config.firestoreLocation,
          rules: 'firestore.rules',
          indexes: 'firestore.indexes.json',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

}

async function markSetupCompleted() {
  await fs.writeFile(
    getSetupStatePath(),
    `${JSON.stringify({ completedAt: new Date().toISOString() }, null, 2)}\n`,
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
    sendJson(res, 200, { ok: true });
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
    (requestUrl.pathname === '/setup/firebase/generate' ||
      requestUrl.pathname === '/setup/firebase/complete')
  ) {
    try {
      const token = requestUrl.searchParams.get('token') || '';

      if (isCompleted) {
        sendJson(res, 403, { error: 'Setup has already been completed.' });
        return;
      }

      if (!isValidSetupSessionToken(token)) {
        sendJson(res, 403, { error: 'Missing or invalid setup session token.' });
        return;
      }

      const payload = normalizeFirebaseSetupPayload(await readJsonBody(req));
      const missingFields = REQUIRED_FIREBASE_FIELDS.filter((field) => !payload[field]);

      if (missingFields.length > 0) {
        sendJson(res, 400, { error: `Missing required fields: ${missingFields.join(', ')}` });
        return;
      }

      await installFirebaseFiles(payload);
      if (requestUrl.pathname === '/setup/firebase/complete') {
        await markSetupCompleted();
      }
      sendJson(res, 200, { ok: true });
      return;
    } catch (error) {
      const isParseError = error instanceof SyntaxError;
      const statusCode = isParseError ? 400 : 500;
      const message = isParseError
        ? 'Invalid JSON payload.'
        : error instanceof Error
          ? error.message
          : 'Failed to install Firebase setup files.';

      console.error('Installer service error:', error);
      sendJson(res, statusCode, { error: message });
      return;
    }
  }

  sendJson(res, 404, { error: 'Not found' });
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
