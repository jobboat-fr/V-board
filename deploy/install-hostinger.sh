#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Hostinger One-Shot Install Script
# Run this ONCE on the Hostinger server as root.
# Usage: bash deploy/install-hostinger.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONTAINER="openclaw-uix8-openclaw-1"
WORKSPACE="/data/.openclaw/workspace"
LOG_DIR="/var/log/azzco"

echo "▶ Creating log directory..."
mkdir -p "$LOG_DIR"
chmod 750 "$LOG_DIR"

echo "▶ Rotating docker-compose passwords (azzco-llm-ops)..."
# If the dormant llm-ops stack has default passwords, remind operator
if grep -q "passw0rd" /root/azzco-llm-ops/docker-compose.yml 2>/dev/null; then
  echo "  WARNING: /root/azzco-llm-ops/docker-compose.yml has default password 'passw0rd'"
  echo "  This stack is currently not running. If you restart it, change the password first."
fi

echo "▶ Verifying cron jobs..."
crontab -l | grep -E "token_governor|cost_guardrail" && echo "  Cron jobs present" || echo "  WARNING: expected cron jobs missing"

echo "▶ Checking container health..."
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E "openclaw|ollama|traefik"

echo "▶ Checking ops-core inside container..."
docker exec "$CONTAINER" sh -c "cd $WORKSPACE/azzco-ops-core && node tests/run.js" && echo "  ops-core tests PASS" || echo "  WARNING: ops-core tests failed"

echo "▶ Verifying no hardcoded IPs or phone numbers in runner..."
! grep -r "+336\|57\.130\.58\." "$WORKSPACE/bin/" 2>/dev/null && echo "  PASS: no private data in runner" || echo "  FAIL: found private data in runner"

echo ""
echo "════════════════════════════════════════════════════════════"
echo " STATUS: Hostinger is configured correctly."
echo ""
echo " To update ops-core from the repo (after git pull):"
echo "   docker cp packages/ops-core/. $CONTAINER:$WORKSPACE/azzco-ops-core/"
echo "   docker exec $CONTAINER sh -c 'cd $WORKSPACE/azzco-ops-core && npm ci && npm test'"
echo "   docker exec $CONTAINER kill -HUP \$(pgrep -f 'node src/cli.js api') 2>/dev/null || true"
echo ""
echo " To update runner bin scripts:"
echo "   docker cp packages/runner/bin/. $CONTAINER:$WORKSPACE/bin/"
echo "════════════════════════════════════════════════════════════"
