#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$SCRIPT_DIR}"
BASE_DIR="${BASE_DIR:-$WORKSPACE_ROOT}"
PREMIUM_DIR="${PREMIUM_DIR:-$WORKSPACE_ROOT/premium}"
COMPOSE_FILE="${BASE_DIR}/docker-compose.yml"
API_DIR="${BASE_DIR}/apps/api"

RUN_SETUP=false
EDITION="oss"

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
            echo "Usage: ./start-local.sh [--setup]"
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

bootstrap_api_prisma() {
    if [ ! -f "${API_DIR}/.env" ]; then
        echo "Missing ${API_DIR}/.env. Run ./start-local.sh --setup first."
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

# 1. Start local Docker-backed services in the background
echo "📦 Starting local Docker services..."
docker compose -f "${COMPOSE_FILE}" up -d postgres
wait_for_compose_service postgres 90

# 2. Export environment variables used by local services
export GCP_PROJECT=local-dev

# 3. Build the Orchestrator and Playwright Docker images
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
    echo "🔐 Setup explicitly enabled for this run only."
    echo "➡️  Open http://127.0.0.1:3000/setup"
    concurrently \
      --names "SETUP-WEB,SETUP" \
      --prefix-colors "blue,yellow" \
      "cd '${BASE_DIR}/apps/web' && npm exec vite -- --config '${BASE_DIR}/apps/setup/vite.config.ts'" \
      "node '${BASE_DIR}/setup/installer/index.mjs'"
else
    unset SETUP_SESSION_TOKEN
    unset VITE_SETUP_MODE
    unset VITE_SETUP_SESSION_TOKEN
    bootstrap_api_prisma
    echo "🔒 Setup is locked. Run ./start-local.sh --setup to open the dedicated setup app."
    concurrently \
      --names "WEB,API" \
      --prefix-colors "blue,green" \
      "cd '${BASE_DIR}/apps/web' && npm run dev" \
      "cd '${BASE_DIR}/apps/api' && npm start"
fi
