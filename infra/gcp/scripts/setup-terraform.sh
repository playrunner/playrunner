#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/gcp"
TFVARS_PATH="${TF_DIR}/terraform.tfvars"
TFSTATE_PATH="${TF_DIR}/terraform.tfstate"
TFSTATE_BACKUP_PATH="${TF_DIR}/terraform.tfstate.backup"

FORCE="false"
USER_ID=""

while [ $# -gt 0 ]; do
    case "$1" in
        --yes|-y) FORCE="true"; shift ;;
        --force) FORCE="true"; shift ;;
        --user-id) USER_ID="$2"; shift 2 ;;
        -h|--help)
            cat <<EOF
Usage: $(basename "$0") [options]

Writes infra/gcp/terraform.tfvars from the GCP settings saved by Playrunner.
Run Terraform directly after reviewing the generated values.

Options:
  --yes, -y                  Overwrite an existing terraform.tfvars
  --force                    Overwrite an existing terraform.tfvars
  --user-id <id>             Use a specific saved CloudCredential row
  -h, --help                 Show this help

Examples:
  ./infra/gcp/scripts/setup-terraform.sh
  ./infra/gcp/scripts/setup-terraform.sh --force
EOF
            exit 0
            ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Required command '$1' not found in PATH." >&2
        exit 1
    fi
}

require_cmd node

gcp_settings() {
    if [ -n "$USER_ID" ]; then
        node "${SCRIPT_DIR}/gcp-settings.mjs" "$@" --user-id "$USER_ID"
    else
        node "${SCRIPT_DIR}/gcp-settings.mjs" "$@"
    fi
}

has_managed_state() {
    STATE_PATH="$TFSTATE_PATH" BACKUP_STATE_PATH="$TFSTATE_BACKUP_PATH" node <<'NODE'
const fs = require("fs");

for (const statePath of [process.env.STATE_PATH, process.env.BACKUP_STATE_PATH]) {
  if (!statePath || !fs.existsSync(statePath)) continue;

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    process.exit(0);
  }

  if (Array.isArray(state.resources) && state.resources.length > 0) {
    process.exit(0);
  }
}

process.exit(1);
NODE
}

print_existing_state_note() {
    if ! has_managed_state; then
        return 0
    fi

    cat <<EOF

Existing local Terraform state was found in infra/gcp.

For a clean first-time setup or retest, remove local Terraform state before
running Terraform:
  rm -f infra/gcp/terraform.tfstate infra/gcp/terraform.tfstate.backup

If you are updating an existing Terraform-managed Playrunner install, keep the
state files and run Terraform directly.
EOF
}

if [ -f "$TFVARS_PATH" ] && [ "$FORCE" != "true" ]; then
    if [ -t 0 ]; then
        read -r -p "infra/gcp/terraform.tfvars already exists. Overwrite it from saved Playrunner settings? (y/n) [n]: " CONFIRM
        CONFIRM=${CONFIRM:-n}
        case "$CONFIRM" in
            y|Y) FORCE="true" ;;
            *) echo "Aborted."; exit 0 ;;
        esac
    else
        echo "infra/gcp/terraform.tfvars already exists. Pass --force to overwrite it." >&2
        exit 1
    fi
fi

echo "Writing infra/gcp/terraform.tfvars from saved Playrunner GCP settings..."
gcp_settings \
    write-terraform-tfvars \
    --out "${TFVARS_PATH}" \
    --force

echo ""
echo "Generated values:"
gcp_settings terraform-tfvars

echo ""
print_existing_state_note

echo ""
echo "Review infra/gcp/terraform.tfvars, then run Terraform directly:"
echo "  terraform -chdir=infra/gcp init"
echo "  terraform -chdir=infra/gcp plan"
echo "  terraform -chdir=infra/gcp apply"
