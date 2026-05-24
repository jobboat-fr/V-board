#!/bin/sh
set -eu
WORKSPACE="${VBOARD_WORKSPACE:-/workspace}"
OUT="$WORKSPACE/ops/context/latest_ops_status.json"
mkdir -p "$(dirname "$OUT")"
node "$WORKSPACE/bin/vboard_document_memory_refresh.js" >"$WORKSPACE/ops/context/document_memory_refresh_last.json" 2>"$WORKSPACE/ops/context/document_memory_refresh_last.err" || true
node "$WORKSPACE/bin/vboard_runner_status_summary.js" >"$WORKSPACE/ops/runner/CURRENT_STATUS.md" 2>/dev/null || true
node "$WORKSPACE/bin/vboard_ops_status_collect.js" | tee "$OUT"
