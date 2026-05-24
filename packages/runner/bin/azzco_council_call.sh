#!/bin/sh
set -eu

CONFIG="/data/.openclaw/workspace/.secrets/azzco_council.env"
URL="${AZZCO_COUNCIL_URL:-http://127.0.0.1:8787/route}"
TOKEN="${AZZCO_COUNCIL_TOKEN:-}"

if [ -f "$CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG"
fi

TIMEOUT="${AZZCO_COUNCIL_TIMEOUT_SECONDS:-120}"

if [ -z "${AZZCO_COUNCIL_TOKEN:-$TOKEN}" ]; then
  echo '{"ok":false,"blocked":true,"error":"COUNCIL_AUTH_MISSING","policy":{"approval_required":true,"auto_send_allowed":false}}'
  exit 0
fi

curl -sS --max-time "$TIMEOUT" \
  -H "authorization: Bearer ${AZZCO_COUNCIL_TOKEN:-$TOKEN}" \
  -H "content-type: application/json" \
  --data-binary @- \
  "${AZZCO_COUNCIL_URL:-$URL}" \
  || echo '{"ok":false,"blocked":true,"error":"COUNCIL_UNREACHABLE","policy":{"approval_required":true,"auto_send_allowed":false}}'
