#!/bin/sh
set -eu
OUT="/data/.openclaw/workspace/ops/context/latest_ops_status.json"
mkdir -p "$(dirname "$OUT")"
node /data/.openclaw/workspace/bin/azzco_document_memory_refresh.js >/data/.openclaw/workspace/ops/context/document_memory_refresh_last.json 2>/data/.openclaw/workspace/ops/context/document_memory_refresh_last.err || true
node /data/.openclaw/workspace/bin/azzco_runner_status_summary.js >/data/.openclaw/workspace/ops/runner/CURRENT_STATUS.md 2>/dev/null || true
node /data/.openclaw/workspace/bin/azzco_ops_status_collect.js | tee "$OUT"
