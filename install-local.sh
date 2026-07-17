#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH."
  exit 1
fi

LOCAL_PACKAGE_DIRS=("packages/integration-sdk")

while IFS= read -r package_dir; do
  LOCAL_PACKAGE_DIRS+=("${package_dir}")
done < <(
  node - "${ROOT_DIR}" <<'NODE'
const fs = require('fs');
const path = require('path');

const rootDirectory = process.argv[2];
const packagesDirectory = path.join(rootDirectory, 'packages');
const integrationDirectories = fs
  .readdirSync(packagesDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(packagesDirectory, entry.name))
  .filter((directory) => {
    const manifestPath = path.join(directory, 'package.json');
    if (!fs.existsSync(manifestPath)) return false;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return Boolean(manifest.playrunner?.integration);
  })
  .sort();

for (const directory of integrationDirectories) {
  console.log(path.relative(rootDirectory, directory));
}
NODE
)

LOCAL_PACKAGE_DIRS+=(
  "apps/api"
  "apps/frontend"
  "apps/runners/orchestrator"
  "apps/runners/playwright"
  "docs"
)

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
echo "apps/setup reuses apps/frontend/node_modules and does not need a separate install."
echo "docs is installed here because ./start-local.sh also starts the local Docusaurus site."
echo "packages/* are installed here because app package links resolve through those package folders."
