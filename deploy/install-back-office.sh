#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# back office server One-Shot Install Script
# Run this ONCE on the back office server server to harden and set up systemd services.
# Usage: bash deploy/install-back-office.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

COUNCIL_DIR=/opt/vboard-council/core
OPS_CORE_DIR=/opt/vboard-ops-core
LOG_DIR=/var/log/vboard

echo "▶ Creating log directory..."
mkdir -p "$LOG_DIR"
chown vboard:vboard "$LOG_DIR"
chmod 750 "$LOG_DIR"

echo "▶ Creating /etc/vboard-council.env (if missing)..."
if [ ! -f /etc/vboard-council.env ]; then
  cat > /etc/vboard-council.env << 'EOF'
# VBOARD Council — production environment
# Fill in real values, then: systemctl restart vboard-council
VBOARD_COUNCIL_HOST=127.0.0.1
VBOARD_COUNCIL_PORT=8787
VBOARD_COUNCIL_TOKEN=REPLACE_WITH_STRONG_TOKEN
LLM_API_TOKEN=REPLACE_WITH_LLM_TOKEN
VBOARD_DAILY_BUDGET_USD=3.00
VBOARD_MONTHLY_BUDGET_USD=90.00
VBOARD_DATA_DIR=/opt/vboard-council/core/data
EOF
  chmod 640 /etc/vboard-council.env
  chown root:vboard /etc/vboard-council.env
  echo "  Created /etc/vboard-council.env — FILL IN VALUES BEFORE STARTING"
else
  echo "  /etc/vboard-council.env already exists — skipping"
fi

echo "▶ Creating /etc/vboard-ops-core.env (if missing)..."
if [ ! -f /etc/vboard-ops-core.env ]; then
  cat > /etc/vboard-ops-core.env << 'EOF'
# VBOARD Ops Core — production environment
VBOARD_API_HOST=127.0.0.1
VBOARD_API_PORT=8788
VBOARD_API_TOKEN=REPLACE_WITH_STRONG_TOKEN
VBOARD_DATA_ROOT=/var/lib/vboard-ops-core
VBOARD_LOG_DIR=/var/log/vboard
# Link to council (same server — localhost)
VBOARD_COUNCIL_URL=http://127.0.0.1:8787/route
VBOARD_COUNCIL_TOKEN=REPLACE_WITH_SAME_COUNCIL_TOKEN
EOF
  chmod 640 /etc/vboard-ops-core.env
  chown root:vboard /etc/vboard-ops-core.env
  echo "  Created /etc/vboard-ops-core.env — FILL IN VALUES BEFORE STARTING"
else
  echo "  /etc/vboard-ops-core.env already exists — skipping"
fi

echo "▶ Creating data root for ops-core..."
mkdir -p /var/lib/vboard-ops-core
chown vboard:vboard /var/lib/vboard-ops-core

echo "▶ Installing systemd unit files..."
cp "$COUNCIL_DIR/../deploy/vboard-council.service" /etc/systemd/system/vboard-council.service
cp "$OPS_CORE_DIR/deploy/systemd/vboard-ops-core.service" /etc/systemd/system/vboard-ops-core.service

echo "▶ Reloading systemd..."
systemctl daemon-reload

echo "▶ Enabling services for auto-start on boot..."
systemctl enable vboard-council
systemctl enable vboard-ops-core

echo ""
echo "════════════════════════════════════════════════════════════"
echo " NEXT STEPS — do these manually:"
echo ""
echo "  1. Edit /etc/vboard-council.env  — set VBOARD_COUNCIL_TOKEN + LLM_API_TOKEN"
echo "  2. Edit /etc/vboard-ops-core.env — set VBOARD_API_TOKEN (same as council token)"
echo ""
echo "  3. Stop the currently-running bare node processes:"
echo "     pkill -f 'node /opt/vboard-council'"
echo "     pkill -f 'node src/cli.js api'"
echo ""
echo "  4. Start via systemd:"
echo "     systemctl start vboard-council"
echo "     systemctl start vboard-ops-core"
echo ""
echo "  5. Check status:"
echo "     systemctl status vboard-council"
echo "     systemctl status vboard-ops-core"
echo "     journalctl -u vboard-council -f"
echo "════════════════════════════════════════════════════════════"
