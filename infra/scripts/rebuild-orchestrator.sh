#!/usr/bin/env bash
set -euo pipefail

# Rebuild the local Orchestrator Docker image and force the running container to
# respawn from it.
#
# The API reuses an already-healthy orchestrator container, so rebuilding the
# image alone does NOT take effect: the old container keeps running the stale
# image until it is removed. This script rebuilds the image and removes the
# running container so the next "Start runner" (reopening the Editor tab)
# spawns a fresh container from the new image.
#
# It is also the single source of truth for the orchestrator image build, called
# by start-local.sh so the build command is not duplicated.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
BASE_DIR="${BASE_DIR:-$WORKSPACE_ROOT}"
ORCHESTRATOR_IMAGE_TAG="${ORCHESTRATOR_IMAGE_TAG:-playrunner-orchestrator}"
ORCHESTRATOR_CONTAINER_NAME="${ORCHESTRATOR_CONTAINER_NAME:-playrunner-orchestrator-local}"

# The Dockerfile copies the whole repo and locates the orchestrator via
# BASE_PATH, relative to the build context (WORKSPACE_ROOT).
BASE_PATH_ARG="."
if [ "${BASE_DIR}" != "${WORKSPACE_ROOT}" ]; then
    BASE_PATH_ARG="${BASE_DIR#${WORKSPACE_ROOT}/}"
fi

echo "🔨 Building Orchestrator Docker image (${ORCHESTRATOR_IMAGE_TAG})..."
docker build \
    --build-arg BASE_PATH="${BASE_PATH_ARG}" \
    -f "${BASE_DIR}/apps/runners/orchestrator/Dockerfile" \
    -t "${ORCHESTRATOR_IMAGE_TAG}" \
    "${WORKSPACE_ROOT}"

echo "♻️  Removing running orchestrator container so the API respawns it..."
docker rm -f "${ORCHESTRATOR_CONTAINER_NAME}" >/dev/null 2>&1 || true

echo "✅ Orchestrator image rebuilt. Reopen the Editor tab to spawn a fresh container."
