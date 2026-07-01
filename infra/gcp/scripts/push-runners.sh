#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
PLAYWRIGHT_CONFIG_SCRIPT="${REPO_ROOT}/infra/scripts/playwright-runner-config.mjs"
cd "${REPO_ROOT}"

PROJECT_ID=""
REGION=""
API_SERVICE_NAME=""
API_IMAGE_NAME="playrunner-api"
API_IMAGE_TAG="latest"
API_IMAGE_URI=""
ORCHESTRATOR_SERVICE_NAME=""
ORCHESTRATOR_MIN_INSTANCE_COUNT=""
ORCHESTRATOR_MAX_INSTANCE_COUNT=""
ORCHESTRATOR_CPU_IDLE=""
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
        --api-service-name) API_SERVICE_NAME="$2"; shift 2 ;;
        --api-image-name) API_IMAGE_NAME="$2"; shift 2 ;;
        --api-image-tag) API_IMAGE_TAG="$2"; shift 2 ;;
        --api-image-uri) API_IMAGE_URI="$2"; shift 2 ;;
        --orchestrator-service-name) ORCHESTRATOR_SERVICE_NAME="$2"; shift 2 ;;
        --orchestrator-min-instances) ORCHESTRATOR_MIN_INSTANCE_COUNT="$2"; shift 2 ;;
        --orchestrator-max-instances) ORCHESTRATOR_MAX_INSTANCE_COUNT="$2"; shift 2 ;;
        --orchestrator-cpu-idle) ORCHESTRATOR_CPU_IDLE="$2"; shift 2 ;;
        --user-id) USER_ID="$2"; shift 2 ;;
        --target) TARGET="$2"; shift 2 ;;
        --base-path) BASE_PATH="$2"; shift 2 ;;
        --yes|-y) ASSUME_YES="true"; shift ;;
        -h|--help)
            cat <<EOF
Usage: $(basename "$0") [options]

Builds and pushes Playrunner API, orchestrator, and Playwright runner images to
Google Artifact Registry, configures Docker auth for the target registry host,
redeploys the API and orchestrator Cloud Run services, and deletes stale
Playwright Cloud Run Jobs so they pick up the new image.

GCP settings (project, region, service settings, image URI templates) are read from
the CloudCredential row that the Integrations modal writes to Postgres. CLI
flags override the stored values.

Options:
  --project-id <id>                 GCP project ID (overrides DB setting)
  --region <region>                 Cloud Run region (overrides DB setting)
  --api-service-name <n>            API Cloud Run service name (default playrunner-api)
  --api-image-name <n>              API image name (default playrunner-api)
  --api-image-tag <tag>             API image tag (default latest)
  --api-image-uri <uri>             Full API image URI override
  --orchestrator-service-name <n>   Cloud Run service name (overrides DB)
  --orchestrator-min-instances <n>  Minimum Cloud Run service instances (0 allowed)
  --orchestrator-max-instances <n>  Maximum Cloud Run service instances
  --orchestrator-cpu-idle <bool>    Whether Cloud Run can idle CPU between requests
  --user-id <id>                    Filter Postgres lookup to a specific user
  --target api|orchestrator|playwright|both|all
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

if [ -z "$TARGET" ]; then
    echo ""
    echo "Select which image set to build and push:"
    echo "1) API"
    echo "2) Orchestrator"
    echo "3) Playwright Runner"
    echo "4) Both runners (orchestrator + Playwright)"
    echo "5) All (API + runners)"
    read -r -p "Enter choice [1-5]: " CHOICE
    case "$CHOICE" in
        1) TARGET="api" ;;
        2) TARGET="orchestrator" ;;
        3) TARGET="playwright" ;;
        4) TARGET="both" ;;
        5) TARGET="all" ;;
        *) echo "Invalid choice. Exiting." >&2; exit 1 ;;
    esac
fi

case "$TARGET" in
    api|orchestrator|playwright|both|all) ;;
    *) echo "Unknown target: $TARGET" >&2; exit 1 ;;
esac

includes_orchestrator() {
    case "$TARGET" in
        orchestrator|both|all) return 0 ;;
        *) return 1 ;;
    esac
}

includes_playwright() {
    case "$TARGET" in
        playwright|both|all) return 0 ;;
        *) return 1 ;;
    esac
}

[ -z "$PROJECT_ID" ] && PROJECT_ID="$(settings project-id)"
[ -z "$REGION" ] && REGION="$(settings region)"
[ -z "$API_SERVICE_NAME" ] && API_SERVICE_NAME="playrunner-api"
if includes_orchestrator; then
    [ -z "$ORCHESTRATOR_SERVICE_NAME" ] && ORCHESTRATOR_SERVICE_NAME="$(settings orchestrator-service-name)"
    [ -z "$ORCHESTRATOR_MIN_INSTANCE_COUNT" ] && ORCHESTRATOR_MIN_INSTANCE_COUNT="$(settings orchestrator-min-instance-count)"
    [ -z "$ORCHESTRATOR_MAX_INSTANCE_COUNT" ] && ORCHESTRATOR_MAX_INSTANCE_COUNT="$(settings orchestrator-max-instance-count)"
    [ -z "$ORCHESTRATOR_CPU_IDLE" ] && ORCHESTRATOR_CPU_IDLE="$(settings orchestrator-cpu-idle)"
    ORCHESTRATOR_TEMPLATE="$(settings orchestrator-image-uri-template)"

    case "$ORCHESTRATOR_MIN_INSTANCE_COUNT" in
        ''|*[!0-9]*) echo "Invalid orchestrator min instances: ${ORCHESTRATOR_MIN_INSTANCE_COUNT}" >&2; exit 1 ;;
    esac
    case "$ORCHESTRATOR_MAX_INSTANCE_COUNT" in
        ''|*[!0-9]*|0) echo "Invalid orchestrator max instances: ${ORCHESTRATOR_MAX_INSTANCE_COUNT}" >&2; exit 1 ;;
    esac
    if [ "$ORCHESTRATOR_MAX_INSTANCE_COUNT" -lt "$ORCHESTRATOR_MIN_INSTANCE_COUNT" ]; then
        echo "Orchestrator max instances must be greater than or equal to min instances." >&2
        exit 1
    fi
    case "$ORCHESTRATOR_CPU_IDLE" in
        true|false) ;;
        *) echo "Invalid orchestrator CPU idle value: ${ORCHESTRATOR_CPU_IDLE}. Expected true or false." >&2; exit 1 ;;
    esac
fi

if includes_playwright; then
    PLAYWRIGHT_TEMPLATE="$(settings playwright-image-uri-template)"
fi

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

image_registry_host() {
    local image="$1"
    printf '%s' "${image%%/*}"
}

configure_docker_auth() {
    local host="$1"
    if [ -z "$host" ]; then
        return
    fi

    echo "Configuring Docker auth for ${host}..."
    gcloud auth configure-docker "${host}" --quiet
}

if includes_orchestrator; then
    ORCHESTRATOR_IMAGE_URI="$(substitute "$ORCHESTRATOR_TEMPLATE" "projectId=${PROJECT_ID}")"
fi
[ -z "$API_IMAGE_URI" ] && API_IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/api/${API_IMAGE_NAME}:${API_IMAGE_TAG}"

echo "GCP Project:               $PROJECT_ID"
echo "Cloud Run Region:          $REGION"
if [ "$TARGET" = "api" ] || [ "$TARGET" = "all" ]; then
    echo "API Service Name:          $API_SERVICE_NAME"
    echo "API Image:                 $API_IMAGE_URI"
fi
if includes_orchestrator; then
    echo "Orchestrator Service Name: $ORCHESTRATOR_SERVICE_NAME"
    echo "Orchestrator Min Instances: $ORCHESTRATOR_MIN_INSTANCE_COUNT"
    echo "Orchestrator Max Instances: $ORCHESTRATOR_MAX_INSTANCE_COUNT"
    echo "Orchestrator CPU Idle:     $ORCHESTRATOR_CPU_IDLE"
    echo "Orchestrator Image:        $ORCHESTRATOR_IMAGE_URI"
fi
if includes_playwright; then
    echo "Playwright Template:       $(substitute "$PLAYWRIGHT_TEMPLATE" "projectId=${PROJECT_ID}")"
fi
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

push_api() {
    echo ""
    echo "======================================"
    echo "Building API..."
    echo "======================================"
    configure_docker_auth "$(image_registry_host "${API_IMAGE_URI}")"

    docker build \
        --platform linux/amd64 \
        --build-arg BASE_PATH="${BASE_PATH}" \
        -f "${REPO_ROOT}/apps/api/Dockerfile" \
        -t "${API_IMAGE_URI}" \
        "${REPO_ROOT}"

    echo "Pushing API..."
    docker push "${API_IMAGE_URI}"

    echo "Deploying API to Cloud Run..."
    gcloud run deploy "${API_SERVICE_NAME}" \
        --image "${API_IMAGE_URI}" \
        --region "${REGION}" \
        --project "${PROJECT_ID}" \
        --port 8080
}

push_orchestrator() {
    echo ""
    echo "======================================"
    echo "Building Orchestrator..."
    echo "======================================"
    configure_docker_auth "$(image_registry_host "${ORCHESTRATOR_IMAGE_URI}")"

    docker build \
        --platform linux/amd64 \
        --build-arg BASE_PATH="${BASE_PATH}" \
        -f "${REPO_ROOT}/apps/runners/orchestrator/Dockerfile" \
        -t "${ORCHESTRATOR_IMAGE_URI}" \
        "${REPO_ROOT}"

    echo "Pushing Orchestrator..."
    docker push "${ORCHESTRATOR_IMAGE_URI}"

    echo "Deploying Orchestrator to Cloud Run..."
    local cpu_throttling_flag
    if [ "$ORCHESTRATOR_CPU_IDLE" = "true" ]; then
        cpu_throttling_flag="--cpu-throttling"
    else
        cpu_throttling_flag="--no-cpu-throttling"
    fi

    gcloud run deploy "${ORCHESTRATOR_SERVICE_NAME}" \
        --image "${ORCHESTRATOR_IMAGE_URI}" \
        --region "${REGION}" \
        --project "${PROJECT_ID}" \
        --min-instances "${ORCHESTRATOR_MIN_INSTANCE_COUNT}" \
        --max-instances "${ORCHESTRATOR_MAX_INSTANCE_COUNT}" \
        --cpu-boost \
        "${cpu_throttling_flag}"
}

push_playwright() {
    echo ""
    echo "======================================"
    echo "Building Playwright Runner..."
    echo "======================================"
    local registry_probe_image
    registry_probe_image="$(substitute "$PLAYWRIGHT_TEMPLATE" \
        "projectId=${PROJECT_ID}" \
        "runtime=typescript" \
        "version=latest")"
    configure_docker_auth "$(image_registry_host "${registry_probe_image}")"

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
    api)          push_api ;;
    orchestrator) push_orchestrator ;;
    playwright)   push_playwright ;;
    both)         push_orchestrator; push_playwright ;;
    all)          push_api; push_orchestrator; push_playwright ;;
    *) echo "Unknown target: $TARGET" >&2; exit 1 ;;
esac

echo ""
echo "Done!"
