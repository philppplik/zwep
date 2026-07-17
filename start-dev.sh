#!/usr/bin/env bash
# Zwep dev launcher — starts Meilisearch (via docker), the API (8080) and the
# Vite web UI (5173) together. The Vite proxy forwards /v1/* to the API, so the
# API MUST be running or you get ECONNREFUSED / 500 in the admin console.
#
#   ./start-dev.sh          # bash / git-bash
#   start-dev.bat           # double-click on Windows
#
# Ctrl-C stops everything.
set -euo pipefail

cd "$(dirname "$0")"

# 1. infra
echo "→ starting Meilisearch + Redis (docker)..."
docker compose up -d meilisearch redis

# 2. API (background)
echo "→ starting API on :8080"
node --experimental-strip-types services/api/src/server.ts &
API_PID=$!

# 3. Web
echo "→ starting Vite on :5173 (proxy → :8080)"
( cd web && npm run dev ) &
WEB_PID=$!

cleanup() {
  echo ""
  echo "→ shutting down..."
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait
