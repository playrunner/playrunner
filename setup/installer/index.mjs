import fs from "fs/promises";
import http from "http";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.SETUP_INSTALLER_PORT || "3003", 10);
const SETUP_SESSION_TOKEN = process.env.SETUP_SESSION_TOKEN || "";
const LOCAL_AUTH_SECRET_OWNER = "__playrunner_local_auth__";
const LOCAL_AUTH_SECRET_KEYS = {
  jwtSecret: "local.auth.jwt_secret",
  passwordHash: "local.auth.password_hash",
  username: "local.auth.username",
};

function getRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function getRootEnvPath() {
  return path.join(getRepoRoot(), ".env.local");
}

function getApiDir() {
  return path.join(getRepoRoot(), "apps", "api");
}

function getApiEnvPath() {
  return path.join(getApiDir(), ".env");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function normalizePostgresUrl(value, fieldName, required = false) {
  const trimmed = typeof value === "string" ? value.trim() : "";

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
    throw new Error(
      `${fieldName} must be a valid postgres:// or postgresql:// URL.`,
    );
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      `${fieldName} must use the postgres:// or postgresql:// protocol.`,
    );
  }

  return trimmed;
}

function normalizePostgresSetupPayload(body) {
  return {
    databaseUrl: normalizePostgresUrl(body.databaseUrl, "DATABASE_URL", true),
    username: normalizeUsername(body.username),
    password: normalizePassword(body.password),
  };
}

function normalizeUsername(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (!trimmed) {
    throw new Error("Missing required field: Admin username");
  }

  return trimmed;
}

function normalizePassword(value) {
  const password = typeof value === "string" ? value : "";

  if (!password.trim()) {
    throw new Error("Missing required field: Admin password");
  }

  if (password.trim().length < 8) {
    throw new Error("Admin password must be at least 8 characters.");
  }

  return password;
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody);
}

function formatEnvValue(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derivedKey}`;
}

async function readApiEnvTemplateLines() {
  const envPath = getApiEnvPath();
  const envExamplePath = path.join(getApiDir(), ".env.example");
  const sourcePath = (await fileExists(envPath)) ? envPath : envExamplePath;
  const envContents = await fs.readFile(sourcePath, "utf8").catch(() => "");
  return envContents ? envContents.split(/\r?\n/) : [];
}

function createApiRequire() {
  return createRequire(path.join(getApiDir(), "package.json"));
}

function hasCompleteLocalAuthConfig(config) {
  return Boolean(config.username && config.passwordHash && config.jwtSecret);
}

async function withApiPrismaClient(databaseUrl, callback) {
  const requireFromApi = createApiRequire();
  const unregisterTypeScript = requireFromApi("tsx/cjs/api").register();
  const { PrismaPg } = requireFromApi("@prisma/adapter-pg");
  const { PrismaClient } = requireFromApi(
    "./src/generated/prisma/client.cts",
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    return await callback(prisma);
  } finally {
    await prisma.$disconnect();
    unregisterTypeScript();
  }
}

async function upsertStoredLocalAuthConfig(databaseUrl, config) {
  const secretValues = [
    {
      description: "Local setup admin JWT signing secret.",
      secretKey: LOCAL_AUTH_SECRET_KEYS.jwtSecret,
      value: config.jwtSecret,
    },
    {
      description: "Local setup admin password hash.",
      secretKey: LOCAL_AUTH_SECRET_KEYS.passwordHash,
      value: config.passwordHash,
    },
    {
      description: "Local setup admin username.",
      secretKey: LOCAL_AUTH_SECRET_KEYS.username,
      value: config.username,
    },
  ];

  await withApiPrismaClient(databaseUrl, async (prisma) => {
    for (const secret of secretValues) {
      await prisma.secret.upsert({
        where: {
          userId_secretKey: {
            userId: LOCAL_AUTH_SECRET_OWNER,
            secretKey: secret.secretKey,
          },
        },
        update: {
          value: secret.value,
          description: secret.description,
        },
        create: {
          userId: LOCAL_AUTH_SECRET_OWNER,
          secretKey: secret.secretKey,
          value: secret.value,
          description: secret.description,
        },
      });
    }
  });
}

async function readStoredLocalAuthConfig(databaseUrl) {
  return withApiPrismaClient(databaseUrl, async (prisma) => {
    const secrets = await prisma.secret.findMany({
      where: {
        secretKey: {
          in: Object.values(LOCAL_AUTH_SECRET_KEYS),
        },
        userId: LOCAL_AUTH_SECRET_OWNER,
      },
    });

    const values = new Map(
      secrets.map((secret) => [secret.secretKey, secret.value.trim()]),
    );

    return {
      jwtSecret: values.get(LOCAL_AUTH_SECRET_KEYS.jwtSecret) || "",
      passwordHash: values.get(LOCAL_AUTH_SECRET_KEYS.passwordHash) || "",
      username: values.get(LOCAL_AUTH_SECRET_KEYS.username) || "",
    };
  });
}

async function seedLocalAuthConfig(config) {
  await upsertStoredLocalAuthConfig(config.databaseUrl, {
    jwtSecret: crypto.randomBytes(32).toString("hex"),
    passwordHash: hashPassword(config.password),
    username: config.username,
  });
}

async function hasStoredLocalAuthConfig(databaseUrl) {
  const storedConfig = await readStoredLocalAuthConfig(databaseUrl).catch(
    () => null,
  );

  return Boolean(storedConfig && hasCompleteLocalAuthConfig(storedConfig));
}

async function installPostgresFiles(config) {
  const envPath = getApiEnvPath();

  await fs.mkdir(path.dirname(envPath), { recursive: true });

  const envLines = await readApiEnvTemplateLines();

  upsertEnvVariable(envLines, "DATABASE_URL", config.databaseUrl);

  while (envLines.length > 0 && envLines[envLines.length - 1] === "") {
    envLines.pop();
  }

  await seedLocalAuthConfig(config);
  await fs.writeFile(envPath, `${envLines.join("\n")}\n`, "utf8");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getSetupStatus() {
  const apiEnvPath = getApiEnvPath();
  const [hasRootEnvFile, hasApiEnvFile] = await Promise.all([
    fileExists(getRootEnvPath()),
    fileExists(apiEnvPath),
  ]);

  if (!hasRootEnvFile || !hasApiEnvFile) {
    return {
      completed: false,
    };
  }

  const envContents = await fs.readFile(apiEnvPath, "utf8").catch(() => "");
  const envLines = envContents ? envContents.split(/\r?\n/) : [];
  const databaseUrl = getEnvVariable(envLines, "DATABASE_URL");

  return {
    completed: databaseUrl
      ? await hasStoredLocalAuthConfig(databaseUrl)
      : false,
  };
}

function getRequestUrl(req) {
  return new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
}

function isValidSetupSessionToken(token) {
  return Boolean(SETUP_SESSION_TOKEN) && token === SETUP_SESSION_TOKEN;
}

async function handleRequest(req, res) {
  const requestUrl = getRequestUrl(req);
  const setupStatus = await getSetupStatus();
  const isCompleted = setupStatus.completed;

  if (req.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/setup/session") {
    const token = requestUrl.searchParams.get("token") || "";

    sendJson(res, 200, {
      completed: isCompleted,
      enabled: !isCompleted && isValidSetupSessionToken(token),
    });
    return;
  }

  if (
    req.method === "POST" &&
    (requestUrl.pathname === "/setup/runtime/generate" ||
      requestUrl.pathname === "/setup/runtime/complete")
  ) {
    try {
      const token = requestUrl.searchParams.get("token") || "";

      if (isCompleted) {
        sendJson(res, 403, {
          error:
            "Setup already exists for this workspace. Remove apps/api/.env and rerun ./start-local.sh to reset it.",
        });
        return;
      }

      if (!isValidSetupSessionToken(token)) {
        sendJson(res, 403, {
          error: "Missing or invalid setup session token.",
        });
        return;
      }

      const payload = normalizePostgresSetupPayload(await readJsonBody(req));

      await installPostgresFiles(payload);

      sendJson(res, 200, { ok: true });
      return;
    } catch (error) {
      const isParseError = error instanceof SyntaxError;
      const statusCode = isParseError ? 400 : 500;
      const message = isParseError
        ? "Invalid JSON payload."
        : error instanceof Error
          ? error.message
          : "Failed to install PostgreSQL and local admin setup.";

      console.error("Installer service error:", error);
      sendJson(res, statusCode, { error: message });
      return;
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

export function createInstallerServer() {
  return http.createServer((req, res) => {
    void handleRequest(req, res);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createInstallerServer();
  server.listen(PORT, () => {
    console.log(
      `Setup installer service listening on http://127.0.0.1:${PORT}`,
    );
    if (SETUP_SESSION_TOKEN) {
      console.log(`Setup session token active: ${SETUP_SESSION_TOKEN}`);
    } else {
      console.log("Setup session token not provided. Setup UI remains locked.");
    }
  });
}
