#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
PLAYWRIGHT_CONFIG_SCRIPT="${REPO_ROOT}/infra/scripts/playwright-runner-config.mjs"
cd "${REPO_ROOT}"

PROJECT_ID=""
REGION=""
ORCHESTRATOR_SERVICE_NAME=""
ORCHESTRATOR_TEMPLATE=""
PLAYWRIGHT_TEMPLATE=""
USER_ID=""
TARGET=""
ASSUME_YES="false"
BASE_PATH="."

while [ $# -gt 0 ]; do
    case "$1" in
        --project-id) PROJECT_ID="$2"; shift 2 ;;
        --region) REGION="$2"; shift 2 ;;
        --orchestrator-service-name) ORCHESTRATOR_SERVICE_NAME="$2"; shift 2 ;;
        --user-id) USER_ID="$2"; shift 2 ;;
        --target) TARGET="$2"; shift 2 ;;
        --base-path) BASE_PATH="$2"; shift 2 ;;
        --yes|-y) ASSUME_YES="true"; shift ;;
        -h|--help)
            cat <<EOF
Usage: $(basename "$0") [options]

Builds and pushes the Playrunner orchestrator and Playwright runner images to
Google Artifact Registry, redeploys the orchestrator Cloud Run service, and
deletes stale Playwright Cloud Run Jobs so they pick up the new image.

GCP settings (project, region, service name, image URI templates) are read from
the CloudCredential row that the Integrations modal writes to Postgres. CLI
flags override the stored values.

Options:
  --project-id <id>                 GCP project ID (overrides DB setting)
  --region <region>                 Cloud Run region (overrides DB setting)
  --orchestrator-service-name <n>   Cloud Run service name (overrides DB)
  --user-id <id>                    Filter Postgres lookup to a specific user
  --target orchestrator|playwright|both
                                    Skip the interactive menu
  --base-path <path>                BASE_PATH build arg for orchestrator (default ".")
  --yes, -y                         Skip confirmation prompt

Requires: docker, gcloud, node, and a populated apps/api/.env (DATABASE_URL).
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
require_cmd docker
require_cmd gcloud
require_cmd node

settings_args=()
if [ -n "$USER_ID" ]; then settings_args+=(--user-id "$USER_ID"); fi
settings() {
    node "${SCRIPT_DIR}/gcp-settings.mjs" "$1" "${settings_args[@]}"
}

[ -z "$PROJECT_ID" ] && PROJECT_ID="$(settings project-id)"
[ -z "$REGION" ] && REGION="$(settings region)"
[ -z "$ORCHESTRATOR_SERVICE_NAME" ] && ORCHESTRATOR_SERVICE_NAME="$(settings orchestrator-service-name)"
ORCHESTRATOR_TEMPLATE="$(settings orchestrator-image-uri-template)"
PLAYWRIGHT_TEMPLATE="$(settings playwright-image-uri-template)"

substitute() {
    # Args: template, then key=value pairs.
    local result="$1"; shift
    while [ $# -gt 0 ]; do
        local key="${1%%=*}"
        local value="${1#*=}"
        result="${result//\{$key\}/$value}"
        shift
    done
    printf '%s' "$result"
}

ORCHESTRATOR_IMAGE="$(substitute "$ORCHESTRATOR_TEMPLATE" "projectId=${PROJECT_ID}")"

echo "GCP Project:               $PROJECT_ID"
echo "Cloud Run Region:          $REGION"
echo "Orchestrator Service Name: $ORCHESTRATOR_SERVICE_NAME"
echo "Orchestrator Image:        $ORCHESTRATOR_IMAGE"
echo "Playwright Template:       $(substitute "$PLAYWRIGHT_TEMPLATE" "projectId=${PROJECT_ID}")"
echo "Build Base Path:           $BASE_PATH"
echo ""

if [ "$ASSUME_YES" != "true" ]; then
    read -r -p "Proceed with these settings? (y/n) [y]: " CONFIRM
    CONFIRM=${CONFIRM:-y}
    case "$CONFIRM" in
        y|Y) ;;
        *) echo "Aborted."; exit 0 ;;
    esac
fi

if [ -z "$TARGET" ]; then
    echo ""
    echo "Select which image to build and push:"
    echo "1) Orchestrator"
    echo "2) Playwright Runner"
    echo "3) Both"
    read -r -p "Enter choice [1-3]: " CHOICE
    case "$CHOICE" in
        1) TARGET="orchestrator" ;;
        2) TARGET="playwright" ;;
        3) TARGET="both" ;;
        *) echo "Invalid choice. Exiting." >&2; exit 1 ;;
    esac
fi

push_orchestrator() {
    echo ""
    echo "======================================"
    echo "Building Orchestrator..."
    echo "======================================"
    docker build \
        --platform linux/amd64 \
        --build-arg BASE_PATH="${BASE_PATH}" \
        -f "${REPO_ROOT}/apps/runners/orchestrator/Dockerfile" \
        -t "${ORCHESTRATOR_IMAGE}" \
        "${REPO_ROOT}"

    echo "Pushing Orchestrator..."
    docker push "${ORCHESTRATOR_IMAGE}"

    echo "Deploying Orchestrator to Cloud Run..."
    gcloud run deploy "${ORCHESTRATOR_SERVICE_NAME}" \
        --image "${ORCHESTRATOR_IMAGE}" \
        --region "${REGION}" \
        --project "${PROJECT_ID}" \
        --cpu-boost
}

push_playwright() {
    echo ""
    echo "======================================"
    echo "Building Playwright Runner..."
    echo "======================================"
    local default_tag latest_tag
    default_tag="$(node "${PLAYWRIGHT_CONFIG_SCRIPT}" default-tag)"
    latest_tag="$(node "${PLAYWRIGHT_CONFIG_SCRIPT}" latest-tag)"
    local versions=()
    while IFS= read -r version; do
        versions+=("$version")
    done < <(node "${PLAYWRIGHT_CONFIG_SCRIPT}" tags)

    local pw_ctx="${REPO_ROOT}/apps/runners/playwright"
    local built_images=()

    for runtime in typescript python; do
        local dockerfile="${pw_ctx}/Dockerfile.${runtime}"
        for version in "${versions[@]}"; do
            local image_versioned
            image_versioned="$(substitute "$PLAYWRIGHT_TEMPLATE" \
                "projectId=${PROJECT_ID}" \
                "runtime=${runtime}" \
                "version=${version}")"

            local tag_args=(-t "${image_versioned}")
            built_images+=("${image_versioned}")

            if [ "$version" = "$latest_tag" ]; then
                local image_latest
                image_latest="$(substitute "$PLAYWRIGHT_TEMPLATE" \
                    "projectId=${PROJECT_ID}" \
                    "runtime=${runtime}" \
                    "version=latest")"
                tag_args+=(-t "${image_latest}")
                built_images+=("${image_latest}")
            fi

            echo "Building ${runtime} ${version}..."
            docker build \
                --platform linux/amd64 \
                -f "${dockerfile}" \
                --build-arg PLAYWRIGHT_VERSION="${version}" \
                "${tag_args[@]}" \
                "${pw_ctx}"
        done
    done

    for image in "${built_images[@]}"; do
        local suffix=""
        case "$image" in
            *":${default_tag}") suffix=" [default]" ;;
            *":latest") suffix=" [latest -> ${latest_tag}]" ;;
        esac
        echo "Pushing ${image}${suffix}..."
        docker push "${image}"
    done

    echo ""
    echo "Cleaning up cached Cloud Run Jobs..."
    local jobs
    jobs="$(gcloud run jobs list \
        --project "${PROJECT_ID}" \
        --region "${REGION}" \
        --format='value(name)' | grep '^playrunner-' || true)"
    if [ -n "$jobs" ]; then
        echo "$jobs" | xargs -n 1 -I {} gcloud run jobs delete {} \
            --project "${PROJECT_ID}" \
            --region "${REGION}" \
            --quiet
        echo "Deleted old jobs. They will be dynamically recreated with the new image."
    else
        echo "No existing cached jobs found."
    fi

    echo "Playwright Runner pushed successfully."
    echo "Cloud Run Jobs will automatically use this image on the next execution."
}

case "$TARGET" in
    orchestrator) push_orchestrator ;;
    playwright)   push_playwright ;;
    both)         push_orchestrator; push_playwright ;;
    *) echo "Unknown target: $TARGET" >&2; exit 1 ;;
esac

echo ""
echo "Done!"
