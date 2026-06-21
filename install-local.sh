#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

LOCAL_PACKAGE_DIRS=(
  "apps/api"
  "apps/web"
  "apps/runners/orchestrator"
  "apps/runners/playwright"
)

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH."
  exit 1
fi

echo "Installing local development dependencies..."

for package_dir in "${LOCAL_PACKAGE_DIRS[@]}"; do
  echo ""
  echo "==> ${package_dir}"
  (
    cd "${ROOT_DIR}/${package_dir}"
    npm ci
  )
done

echo ""
echo "Configuring git pre-commit hook (prettier formatting gate)..."
git -C "${ROOT_DIR}" config core.hooksPath .githooks

echo ""
echo "Local development dependencies installed."
echo "apps/setup reuses apps/web/node_modules and does not need a separate install."
