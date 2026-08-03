#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/tests/e2e/docker-compose.e2e.yml"
E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://127.0.0.1:4010}"
HEALTH_ENDPOINT="${E2E_API_BASE_URL}/health"

cd "${ROOT_DIR}"

cleanup() {
    docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans
}

trap cleanup EXIT

echo "Building screenshot API Docker image..."
docker build -t screenshot-api-e2e:local .

echo "Starting Docker Compose stack..."
docker compose -f "${COMPOSE_FILE}" up -d

echo "Waiting for API health endpoint: ${HEALTH_ENDPOINT}"
ready=0
for _ in $(seq 1 60); do
    if curl --silent --show-error --fail "${HEALTH_ENDPOINT}" >/dev/null; then
        ready=1
        break
    fi
    sleep 2
done

if [[ "${ready}" -ne 1 ]]; then
    echo "API did not become healthy in time. Docker logs:"
    docker compose -f "${COMPOSE_FILE}" logs
    exit 1
fi

echo "Running screenshot API contract tests..."
export E2E_API_BASE_URL
pnpm exec tsx tests/e2e/run-contract-tests.ts
