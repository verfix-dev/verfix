#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH_INPUT=${INPUT_CONFIG:-verify.config.json}
BASE_URL_INPUT=${INPUT_BASE_URL:-}
AUTO_VERCEL=${INPUT_AUTO_DETECT_VERCEL:-false}
FLOW_INPUT=${INPUT_FLOW:-}
API_BASE=${INPUT_API_BASE:-http://localhost:3001}
DASHBOARD_BASE=${INPUT_DASHBOARD_BASE:-http://localhost:3000}

BASE_URL="$BASE_URL_INPUT"
if [[ -z "$BASE_URL" ]]; then
  if [[ "$AUTO_VERCEL" == "true" && -n "${VERCEL_URL:-}" ]]; then
    BASE_URL="https://${VERCEL_URL}"
  else
    echo "Error: base-url is required unless auto-detect-vercel=true and VERCEL_URL is set." >&2
    exit 1
  fi
fi

if [[ ! -f "$CONFIG_PATH_INPUT" ]]; then
  echo "Error: config file not found: $CONFIG_PATH_INPUT" >&2
  exit 1
fi

CONFIG_PATH=$(realpath "$CONFIG_PATH_INPUT")

export VERIFY_API="$API_BASE"
export VERIFY_DASHBOARD="$DASHBOARD_BASE"

make up

make api > /tmp/verify_api.log 2>&1 &
make worker > /tmp/verify_worker.log 2>&1 &

ready=false
for _ in {1..30}; do
  if curl -s "${API_BASE}/api/v1/health" | grep -q '"status"'; then
    ready=true
    break
  fi
  sleep 2
done

if [[ "$ready" != "true" ]]; then
  echo "Error: VerifyRuntime API did not become healthy." >&2
  exit 1
fi

pushd cli > /dev/null
npm install

ARGS=(run --url "$BASE_URL" --output json --config "$CONFIG_PATH")
if [[ -n "$FLOW_INPUT" ]]; then
  ARGS+=(--flow "$FLOW_INPUT")
fi

npx ts-node src/index.ts "${ARGS[@]}"

popd > /dev/null
