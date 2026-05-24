#!/bin/sh
set -eu

WORKSPACE="${VBOARD_WORKSPACE:-/workspace}"
CONFIG="${VBOARD_COUNCIL_CONFIG:-$WORKSPACE/.secrets/vboard_council.env}"
URL="${VBOARD_COUNCIL_URL:-http://council:8787/route}"
TOKEN="${VBOARD_COUNCIL_TOKEN:-}"

if [ -f "$CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG"
fi

TIMEOUT="${VBOARD_COUNCIL_TIMEOUT_SECONDS:-120}"

if [ -z "${VBOARD_COUNCIL_TOKEN:-$TOKEN}" ]; then
  echo '{"ok":false,"blocked":true,"error":"COUNCIL_AUTH_MISSING","policy":{"approval_required":true,"auto_send_allowed":false}}'
  exit 0
fi

curl -sS --max-time "$TIMEOUT" \
  -H "authorization: Bearer ${VBOARD_COUNCIL_TOKEN:-$TOKEN}" \
  -H "content-type: application/json" \
  --data-binary @- \
  "${VBOARD_COUNCIL_URL:-$URL}" \
  || echo '{"ok":false,"blocked":true,"error":"COUNCIL_UNREACHABLE","policy":{"approval_required":true,"auto_send_allowed":false}}'
