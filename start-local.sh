#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$SCRIPT_DIR}"
BASE_DIR="${BASE_DIR:-$WORKSPACE_ROOT}"
PREMIUM_DIR="${PREMIUM_DIR:-$WORKSPACE_ROOT/premium}"
COMPOSE_FILE="${BASE_DIR}/docker-compose.yml"
API_DIR="${BASE_DIR}/apps/api"
DOCS_DIR="${BASE_DIR}/docs"
ROOT_ENV_FILE="${BASE_DIR}/.env.local"
ROOT_ENV_EXAMPLE_FILE="${BASE_DIR}/.env.local.example"
LEGACY_ROOT_ENV_FILE="${BASE_DIR}/.env"

ensure_root_env_file() {
    if [ -f "${ROOT_ENV_FILE}" ]; then
        return 0
    fi

    if [ -f "${LEGACY_ROOT_ENV_FILE}" ]; then
        mv "${LEGACY_ROOT_ENV_FILE}" "${ROOT_ENV_FILE}"
        echo "📝 Renamed ${LEGACY_ROOT_ENV_FILE} to ${ROOT_ENV_FILE}"
        return 0
    fi

    if [ -f "${ROOT_ENV_EXAMPLE_FILE}" ]; then
        cp "${ROOT_ENV_EXAMPLE_FILE}" "${ROOT_ENV_FILE}"
        echo "📝 Created ${ROOT_ENV_FILE} from ${ROOT_ENV_EXAMPLE_FILE}"
    fi
}

ensure_root_env_file

if [ -f "${ROOT_ENV_FILE}" ]; then
    echo "📝 Loading local env overrides from ${ROOT_ENV_FILE}"
    set -a
    # shellcheck disable=SC1090
    source "${ROOT_ENV_FILE}"
    set +a
fi

WEB_PORT="${WEB_PORT:-3000}"
DOCS_PORT="${DOCS_PORT:-3004}"
SETUP_INSTALLER_PORT="${SETUP_INSTALLER_PORT:-3003}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_DB="${POSTGRES_DB:-playrunner}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
LOCAL_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"
ROOT_DATABASE_URL="${DATABASE_URL:-}"
VITE_DEFAULT_DATABASE_URL="${VITE_DEFAULT_DATABASE_URL:-${ROOT_DATABASE_URL:-$LOCAL_DATABASE_URL}}"
VITE_SETUP_INSTALLER_URL="${VITE_SETUP_INSTALLER_URL:-http://127.0.0.1:${SETUP_INSTALLER_PORT}}"
DEFAULT_DOCS_HOME_URL="http://127.0.0.1:${DOCS_PORT}/playrunner/"
DEFAULT_SETUP_DOCS_URL="${DEFAULT_DOCS_HOME_URL}docs/tutorials/getting-started"
DOCS_LANDING_PATH="${DOCS_LANDING_PATH:-}"

export WEB_PORT
export DOCS_PORT
export SETUP_INSTALLER_PORT
export POSTGRES_PORT
export POSTGRES_HOST
export POSTGRES_DB
export POSTGRES_USER
export POSTGRES_PASSWORD
export VITE_DEFAULT_DATABASE_URL
export VITE_SETUP_INSTALLER_URL

RUN_SETUP=false
AUTO_SETUP=false
EDITION="oss"
SETUP_COMPLETED=false
API_ENV_PREPARED=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --setup)
            RUN_SETUP=true
            shift
            ;;
        --edition)
            if [[ -z "${2:-}" ]]; then
                echo "Missing value for --edition. Use 'oss' or 'premium'."
                exit 1
            fi
            EDITION="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1"
            echo "Usage: ./start-local.sh [--setup] [--edition oss|premium]"
            exit 1
            ;;
    esac
done

case "$EDITION" in
    oss|false)
        export ENABLE_PREMIUM=false
        EDITION_LABEL="oss"
        ;;
    premium|true)
        export ENABLE_PREMIUM=true
        EDITION_LABEL="premium"
        ;;
    *)
        echo "Invalid edition '$EDITION'. Use './start-local.sh' for OSS/local mode or './start-premium.sh' for premium mode."
        exit 1
        ;;
esac

echo "🚀 Starting Local Development Environment..."
echo "🧩 Edition mode: ${EDITION_LABEL}"
echo "📁 Workspace root: ${WORKSPACE_ROOT}"
echo "📦 Base dir: ${BASE_DIR}"
echo "🌐 Web port: ${WEB_PORT}"
echo "📚 Docs port: ${DOCS_PORT}"
echo "🧰 Setup installer port: ${SETUP_INSTALLER_PORT}"
echo "🐘 Postgres port: ${POSTGRES_PORT}"

wait_for_compose_service() {
    local service="$1"
    local timeout_seconds="${2:-60}"
    local elapsed=0
    local container_id

    container_id=$(docker compose -f "${COMPOSE_FILE}" ps -q "${service}")
    if [ -z "${container_id}" ]; then
        echo "Failed to locate Docker container for service '${service}'."
        exit 1
    fi

    while [ "${elapsed}" -lt "${timeout_seconds}" ]; do
        local status
        status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)

        if [ "${status}" = "healthy" ] || [ "${status}" = "running" ]; then
            echo "✅ ${service} is ${status}."
            return 0
        fi

        sleep 2
        elapsed=$((elapsed + 2))
    done

    echo "Timed out waiting for Docker service '${service}' to become ready."
    exit 1
}

ensure_docs_dependencies() {
    if [ -d "${DOCS_DIR}/node_modules" ]; then
        return 0
    fi

    echo "Missing ${DOCS_DIR}/node_modules. Run ./install-local.sh first."
    exit 1
}

has_completed_local_setup() {
    node - "${ROOT_ENV_FILE}" "${API_DIR}/.env" "${API_DIR}" <<'NODE'
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const [, , rootEnvPath, apiEnvPath, apiDir] = process.argv;
const LOCAL_AUTH_SECRET_OWNER = '__playrunner_local_auth__';
const LOCAL_AUTH_SECRET_KEYS = {
  jwtSecret: 'local.auth.jwt_secret',
  passwordHash: 'local.auth.password_hash',
  username: 'local.auth.username',
};

function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseEnvValue(rawValue = '') {
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

function formatEnvValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function getEnvVariable(lines, key) {
  const line = lines.find((entry) => entry.startsWith(`${key}=`));
  if (!line) {
    return '';
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

function hasCompleteLocalAuthConfig(config) {
  return Boolean(config.username && config.passwordHash && config.jwtSecret);
}

function getLegacyLocalAuthConfig(lines) {
  return {
    jwtSecret: getEnvVariable(lines, 'AUTH_JWT_SECRET'),
    passwordHash: getEnvVariable(lines, 'LOCAL_AUTH_PASSWORD_HASH'),
    username: getEnvVariable(lines, 'LOCAL_AUTH_USERNAME'),
  };
}

async function withPrismaClient(databaseUrl, callback) {
  const requireFromApi = createRequire(path.join(apiDir, 'package.json'));
  const { PrismaClient } = requireFromApi('@prisma/client');
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    return await callback(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function readStoredLocalAuthConfig(databaseUrl) {
  return withPrismaClient(databaseUrl, async (prisma) => {
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
      jwtSecret: values.get(LOCAL_AUTH_SECRET_KEYS.jwtSecret) || '',
      passwordHash: values.get(LOCAL_AUTH_SECRET_KEYS.passwordHash) || '',
      username: values.get(LOCAL_AUTH_SECRET_KEYS.username) || '',
    };
  });
}

async function upsertStoredLocalAuthConfig(databaseUrl, config) {
  return withPrismaClient(databaseUrl, async (prisma) => {
    const secretValues = [
      {
        description: 'Local setup admin JWT signing secret.',
        secretKey: LOCAL_AUTH_SECRET_KEYS.jwtSecret,
        value: config.jwtSecret,
      },
      {
        description: 'Local setup admin password hash.',
        secretKey: LOCAL_AUTH_SECRET_KEYS.passwordHash,
        value: config.passwordHash,
      },
      {
        description: 'Local setup admin username.',
        secretKey: LOCAL_AUTH_SECRET_KEYS.username,
        value: config.username,
      },
    ];

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

function writeSanitizedEnv(lines) {
  upsertEnvVariable(lines, 'LOCAL_AUTH_USERNAME');
  upsertEnvVariable(lines, 'LOCAL_AUTH_PASSWORD_HASH');
  upsertEnvVariable(lines, 'AUTH_JWT_SECRET');

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  fs.writeFileSync(apiEnvPath, `${lines.join('\n')}\n`, 'utf8');
}

if (!fileExists(rootEnvPath) || !fileExists(apiEnvPath)) {
  process.exit(1);
}

async function main() {
  const envLines = fs.readFileSync(apiEnvPath, 'utf8').split(/\r?\n/);
  const databaseUrl = getEnvVariable(envLines, 'DATABASE_URL');

  if (!databaseUrl) {
    return false;
  }

  const storedConfig = await readStoredLocalAuthConfig(databaseUrl).catch(
    () => null,
  );
  if (storedConfig && hasCompleteLocalAuthConfig(storedConfig)) {
    writeSanitizedEnv(envLines);
    return true;
  }

  const legacyConfig = getLegacyLocalAuthConfig(envLines);
  if (!hasCompleteLocalAuthConfig(legacyConfig)) {
    return false;
  }

  await upsertStoredLocalAuthConfig(databaseUrl, legacyConfig);
  writeSanitizedEnv(envLines);
  return true;
}

main()
  .then((isComplete) => {
    process.exit(isComplete ? 0 : 1);
  })
  .catch(() => {
    process.exit(1);
  });
NODE
}

bootstrap_api_prisma() {
    if [ ! -f "${API_DIR}/.env" ]; then
        echo "Missing ${API_DIR}/.env. Re-run ./start-local.sh to reopen setup."
        exit 1
    fi

    echo "🗃️  Generating Prisma client..."
    (
        cd "${API_DIR}"
        npm run prisma:generate
    )

    echo "🗃️  Pushing Prisma schema to PostgreSQL..."
    (
        cd "${API_DIR}"
        npx prisma db push --skip-generate
    )
}

sync_api_database_url() {
    if [ ! -f "${API_DIR}/.env" ]; then
        return 0
    fi

    node - "${API_DIR}/.env" "${ROOT_DATABASE_URL}" "${LOCAL_DATABASE_URL}" "${POSTGRES_HOST}" "${POSTGRES_DB}" "${POSTGRES_USER}" "${POSTGRES_PASSWORD}" <<'NODE'
const fs = require('fs');

const [
  ,
  ,
  envPath,
  rootDatabaseUrl,
  localDatabaseUrl,
  postgresHost,
  postgresDb,
  postgresUser,
  postgresPassword,
] = process.argv;

function parseEnvValue(rawValue = '') {
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

function formatEnvValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

let rawContents = '';
try {
  rawContents = fs.readFileSync(envPath, 'utf8');
} catch {
  process.exit(0);
}

const envLines = rawContents ? rawContents.split(/\r?\n/) : [];
const databaseUrlIndex = envLines.findIndex((line) => line.startsWith('DATABASE_URL='));
if (databaseUrlIndex === -1) {
  process.exit(0);
}

const currentDatabaseUrl = parseEnvValue(
  envLines[databaseUrlIndex].slice('DATABASE_URL='.length),
);

let nextDatabaseUrl = '';
if (rootDatabaseUrl) {
  nextDatabaseUrl = rootDatabaseUrl;
} else {
  try {
    const currentUrl = new URL(currentDatabaseUrl);
    const localHostnames = new Set(['127.0.0.1', 'localhost']);
    const currentDbName = currentUrl.pathname.replace(/^\//, '');
    const currentUser = decodeURIComponent(currentUrl.username);
    const currentPassword = decodeURIComponent(currentUrl.password);

    const matchesLocalDockerDefaults =
      localHostnames.has(currentUrl.hostname) &&
      localHostnames.has(postgresHost) &&
      currentDbName === postgresDb &&
      currentUser === postgresUser &&
      currentPassword === postgresPassword;

    if (!matchesLocalDockerDefaults) {
      process.exit(0);
    }

    nextDatabaseUrl = localDatabaseUrl;
  } catch {
    process.exit(0);
  }
}

if (!nextDatabaseUrl || currentDatabaseUrl === nextDatabaseUrl) {
  process.exit(0);
}

envLines[databaseUrlIndex] = `DATABASE_URL=${formatEnvValue(nextDatabaseUrl)}`;
while (envLines.length > 0 && envLines[envLines.length - 1] === '') {
  envLines.pop();
}

fs.writeFileSync(envPath, `${envLines.join('\n')}\n`, 'utf8');
NODE
}

# 1. Start local Docker-backed services in the background
ensure_docs_dependencies

echo "📦 Starting local Docker services..."
docker compose -f "${COMPOSE_FILE}" up -d postgres
wait_for_compose_service postgres 90

if [ -f "${API_DIR}/.env" ]; then
    sync_api_database_url
    bootstrap_api_prisma
    API_ENV_PREPARED=true
fi

if has_completed_local_setup; then
    SETUP_COMPLETED=true
fi

if [ -z "${VITE_DOCS_URL:-}" ]; then
    if [ "$SETUP_COMPLETED" = "true" ]; then
        VITE_DOCS_URL="${DEFAULT_DOCS_HOME_URL}"
    else
        VITE_DOCS_URL="${DEFAULT_SETUP_DOCS_URL}"
    fi
fi

if [ -z "${DOCS_LANDING_PATH}" ]; then
    if [ "$SETUP_COMPLETED" = "true" ]; then
        DOCS_LANDING_PATH="/"
    else
        DOCS_LANDING_PATH="/docs/tutorials/getting-started"
    fi
fi

export VITE_DOCS_URL
export DOCS_LANDING_PATH

if [ "$RUN_SETUP" != "true" ] && [ "$SETUP_COMPLETED" != "true" ]; then
    RUN_SETUP=true
    AUTO_SETUP=true
    echo "🛠️  No completed local setup detected. Opening setup automatically."
fi

# 2. Build the Orchestrator and Playwright Docker images
echo "🔨 Building Orchestrator Docker image..."
BASE_PATH_ARG="."
if [ "${BASE_DIR}" != "${WORKSPACE_ROOT}" ]; then
    BASE_PATH_ARG="${BASE_DIR#${WORKSPACE_ROOT}/}"
fi
docker build \
    --build-arg BASE_PATH="${BASE_PATH_ARG}" \
    -f "${BASE_DIR}/apps/runners/orchestrator/Dockerfile" \
    -t playrunner-orchestrator \
    "${WORKSPACE_ROOT}"

echo "🎭 Building Playwright Docker image..."
PLAYWRIGHT_LATEST_TAG=$(node "${BASE_DIR}/infra/scripts/playwright-runner-config.mjs" latest-tag)
PLAYWRIGHT_VERSIONS=()
while IFS= read -r version; do
    PLAYWRIGHT_VERSIONS+=("$version")
done < <(node "${BASE_DIR}/infra/scripts/playwright-runner-config.mjs" tags)

for version in "${PLAYWRIGHT_VERSIONS[@]}"; do
    if [ "$version" = "$PLAYWRIGHT_LATEST_TAG" ]; then
        docker build \
            --platform linux/amd64 \
            -f "${BASE_DIR}/apps/runners/playwright/Dockerfile.typescript" \
            --build-arg PLAYWRIGHT_VERSION=${version} \
            -t playrunner-playwright-runner-typescript:latest \
            -t playrunner-playwright-runner-typescript:${version} \
            "${BASE_DIR}/apps/runners/playwright"
        docker build \
            --platform linux/amd64 \
            -f "${BASE_DIR}/apps/runners/playwright/Dockerfile.python" \
            --build-arg PLAYWRIGHT_VERSION=${version} \
            -t playrunner-playwright-runner-python:latest \
            -t playrunner-playwright-runner-python:${version} \
            "${BASE_DIR}/apps/runners/playwright"
    else
        docker build \
            --platform linux/amd64 \
            -f "${BASE_DIR}/apps/runners/playwright/Dockerfile.typescript" \
            --build-arg PLAYWRIGHT_VERSION=${version} \
            -t playrunner-playwright-runner-typescript:${version} \
            "${BASE_DIR}/apps/runners/playwright"
        docker build \
            --platform linux/amd64 \
            -f "${BASE_DIR}/apps/runners/playwright/Dockerfile.python" \
            --build-arg PLAYWRIGHT_VERSION=${version} \
            -t playrunner-playwright-runner-python:${version} \
            "${BASE_DIR}/apps/runners/playwright"
    fi
done

# 4. Ensure concurrently is installed
if ! command -v concurrently &> /dev/null
then
    echo "⚙️  Installing 'concurrently' globally..."
    npm install -g concurrently
fi

# 5. Start the product app or the dedicated setup app
echo "🌟 Starting local services..."

if [ "$RUN_SETUP" = "true" ]; then
    export SETUP_SESSION_TOKEN=$(node -e "console.log(require('crypto').randomUUID())")
    export VITE_SETUP_MODE=true
    export VITE_SETUP_SESSION_TOKEN="$SETUP_SESSION_TOKEN"
    if [ "$AUTO_SETUP" = "true" ]; then
        echo "🔐 Setup enabled automatically for this run."
    else
        echo "🔐 Setup explicitly enabled for this run only."
    fi
    echo "➡️  Open http://127.0.0.1:${WEB_PORT}/setup"
    echo "📚 Docs available at ${VITE_DOCS_URL}"
    concurrently \
      --names "SETUP-WEB,SETUP,DOCS" \
      --prefix-colors "blue,yellow,magenta" \
      "cd '${BASE_DIR}/apps/frontend' && npm exec vite -- --config '${BASE_DIR}/apps/setup/vite.config.ts' --port '${WEB_PORT}'" \
      "node '${BASE_DIR}/setup/installer/index.mjs'" \
      "cd '${DOCS_DIR}' && npm run start -- --host 127.0.0.1 --port '${DOCS_PORT}'"
else
    unset SETUP_SESSION_TOKEN
    unset VITE_SETUP_MODE
    unset VITE_SETUP_SESSION_TOKEN
    if [ "$API_ENV_PREPARED" != "true" ]; then
        sync_api_database_url
        bootstrap_api_prisma
    fi
    echo "✅ Local setup detected. Starting the normal app."
    echo "📚 Docs available at ${VITE_DOCS_URL}"
    concurrently \
      --names "WEB,API,DOCS" \
      --prefix-colors "blue,green,magenta" \
      "cd '${BASE_DIR}/apps/frontend' && npm run dev -- --port '${WEB_PORT}'" \
      "cd '${BASE_DIR}/apps/api' && npm start" \
      "cd '${DOCS_DIR}' && npm run start -- --host 127.0.0.1 --port '${DOCS_PORT}' --no-open"
fi
