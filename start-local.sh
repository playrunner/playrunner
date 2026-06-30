#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$SCRIPT_DIR}"
BASE_DIR="${BASE_DIR:-$WORKSPACE_ROOT}"
PREMIUM_DIR="${PREMIUM_DIR:-$WORKSPACE_ROOT/premium}"
COMPOSE_FILE="${BASE_DIR}/docker-compose.yml"
API_DIR="${BASE_DIR}/apps/api"
FRONTEND_DIR="${BASE_DIR}/apps/frontend"
DOCS_DIR="${BASE_DIR}/docs"
INTEGRATION_SDK_DIR="${BASE_DIR}/packages/integration-sdk"
ENVIRONMENT_PACKAGE_DIR="${BASE_DIR}/packages/environment"
GITHUB_PACKAGE_DIR="${BASE_DIR}/packages/github"
JAVASCRIPT_PACKAGE_DIR="${BASE_DIR}/packages/javascript"
JIRA_PACKAGE_DIR="${BASE_DIR}/packages/jira"
PLAYWRIGHT_PACKAGE_DIR="${BASE_DIR}/packages/playwright"
SCHEDULE_PACKAGE_DIR="${BASE_DIR}/packages/schedule"
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
PUBSUB_EMULATOR_PORT="${PUBSUB_EMULATOR_PORT:-8085}"
LOCAL_PUBSUB_PROJECT_ID="${LOCAL_PUBSUB_PROJECT_ID:-playrunner-local}"
PUBSUB_EMULATOR_HOST="${PUBSUB_EMULATOR_HOST:-127.0.0.1:${PUBSUB_EMULATOR_PORT}}"
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
export PUBSUB_EMULATOR_PORT
export LOCAL_PUBSUB_PROJECT_ID
export PUBSUB_EMULATOR_HOST
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
echo "📬 Pub/Sub emulator port: ${PUBSUB_EMULATOR_PORT}"

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

ensure_dependency_dir() {
    local dependency_dir="$1"

    if [ -d "${dependency_dir}/node_modules" ]; then
        return 0
    fi

    echo "Missing ${dependency_dir}/node_modules. Run ./install-local.sh first."
    exit 1
}

ensure_local_dependencies() {
    ensure_dependency_dir "${INTEGRATION_SDK_DIR}"
    ensure_dependency_dir "${ENVIRONMENT_PACKAGE_DIR}"
    ensure_dependency_dir "${GITHUB_PACKAGE_DIR}"
    ensure_dependency_dir "${JAVASCRIPT_PACKAGE_DIR}"
    ensure_dependency_dir "${JIRA_PACKAGE_DIR}"
    ensure_dependency_dir "${PLAYWRIGHT_PACKAGE_DIR}"
    ensure_dependency_dir "${SCHEDULE_PACKAGE_DIR}"
    ensure_dependency_dir "${API_DIR}"
    ensure_dependency_dir "${FRONTEND_DIR}"
    ensure_dependency_dir "${DOCS_DIR}"
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

function getEnvVariable(lines, key) {
  const line = lines.find((entry) => entry.startsWith(`${key}=`));
  if (!line) {
    return '';
  }

  return parseEnvValue(line.slice(key.length + 1));
}

function hasCompleteLocalAuthConfig(config) {
  return Boolean(config.username && config.passwordHash && config.jwtSecret);
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
  return Boolean(storedConfig && hasCompleteLocalAuthConfig(storedConfig));
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

configure_frontend_api_proxy() {
    if [ -n "${VITE_API_URL:-}" ]; then
        export VITE_API_URL
        echo "🔌 Frontend API proxy: ${VITE_API_URL}"
        return 0
    fi

    local api_port="3001"

    if [ -f "${API_DIR}/.env" ]; then
        api_port=$(node - "${API_DIR}/.env" <<'NODE' || echo "3001"
const fs = require('fs');

const [, , envPath] = process.argv;

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

function getEnvVariable(lines, key) {
  const line = lines.find((entry) => entry.startsWith(`${key}=`));
  if (!line) {
    return '';
  }

  return parseEnvValue(line.slice(key.length + 1));
}

const envContents = fs.readFileSync(envPath, 'utf8');
const port = getEnvVariable(envContents.split(/\r?\n/), 'PORT') || '3001';

if (!/^\d+$/.test(port)) {
  process.exit(1);
}

console.log(port);
NODE
)
    fi

    VITE_API_URL="http://127.0.0.1:${api_port}"
    export VITE_API_URL
    echo "🔌 Frontend API proxy: ${VITE_API_URL}"
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
ensure_local_dependencies

echo "📦 Starting local Docker services..."
docker compose -f "${COMPOSE_FILE}" up -d postgres pubsub
wait_for_compose_service postgres 90
wait_for_compose_service pubsub 30

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
env WORKSPACE_ROOT="${WORKSPACE_ROOT}" BASE_DIR="${BASE_DIR}" \
    "${BASE_DIR}/infra/scripts/rebuild-orchestrator.sh"

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
            --build-arg "PLAYWRIGHT_VERSION=${version}" \
            -t playrunner-playwright-runner-typescript:latest \
            -t "playrunner-playwright-runner-typescript:${version}" \
            "${BASE_DIR}/apps/runners/playwright"
        docker build \
            --platform linux/amd64 \
            -f "${BASE_DIR}/apps/runners/playwright/Dockerfile.python" \
            --build-arg "PLAYWRIGHT_VERSION=${version}" \
            -t playrunner-playwright-runner-python:latest \
            -t "playrunner-playwright-runner-python:${version}" \
            "${BASE_DIR}/apps/runners/playwright"
    else
        docker build \
            --platform linux/amd64 \
            -f "${BASE_DIR}/apps/runners/playwright/Dockerfile.typescript" \
            --build-arg "PLAYWRIGHT_VERSION=${version}" \
            -t "playrunner-playwright-runner-typescript:${version}" \
            "${BASE_DIR}/apps/runners/playwright"
        docker build \
            --platform linux/amd64 \
            -f "${BASE_DIR}/apps/runners/playwright/Dockerfile.python" \
            --build-arg "PLAYWRIGHT_VERSION=${version}" \
            -t "playrunner-playwright-runner-python:${version}" \
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
    SETUP_SESSION_TOKEN=$(node -e "console.log(require('crypto').randomUUID())")
    export SETUP_SESSION_TOKEN
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
    configure_frontend_api_proxy
    echo "✅ Local setup detected. Starting the normal app."
    echo "📚 Docs available at ${VITE_DOCS_URL}"
    concurrently \
      --names "WEB,API,DOCS" \
      --prefix-colors "blue,green,magenta" \
      "cd '${BASE_DIR}/apps/frontend' && npm run dev -- --port '${WEB_PORT}'" \
      "cd '${BASE_DIR}/apps/api' && npm start" \
      "cd '${DOCS_DIR}' && npm run start -- --host 127.0.0.1 --port '${DOCS_PORT}' --no-open"
fi
