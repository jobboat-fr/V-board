#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# OVH One-Shot Install Script
# Run this ONCE on the OVH server to harden and set up systemd services.
# Usage: bash deploy/install-ovh.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

COUNCIL_DIR=/opt/azzco-council/core
OPS_CORE_DIR=/opt/azzco-ops-core
LOG_DIR=/var/log/azzco

echo "▶ Creating log directory..."
mkdir -p "$LOG_DIR"
chown azzco:azzco "$LOG_DIR"
chmod 750 "$LOG_DIR"

echo "▶ Creating /etc/azzco-council.env (if missing)..."
if [ ! -f /etc/azzco-council.env ]; then
  cat > /etc/azzco-council.env << 'EOF'
# AZZCO Council — production environment
# Fill in real values, then: systemctl restart azzco-council
AZZCO_COUNCIL_HOST=127.0.0.1
AZZCO_COUNCIL_PORT=8787
AZZCO_COUNCIL_TOKEN=REPLACE_WITH_STRONG_TOKEN
HUGGINGFACE_TOKEN=REPLACE_WITH_HF_TOKEN
AZZCO_DAILY_BUDGET_USD=3.00
AZZCO_MONTHLY_BUDGET_USD=90.00
AZZCO_DATA_DIR=/opt/azzco-council/core/data
EOF
  chmod 640 /etc/azzco-council.env
  chown root:azzco /etc/azzco-council.env
  echo "  Created /etc/azzco-council.env — FILL IN VALUES BEFORE STARTING"
else
  echo "  /etc/azzco-council.env already exists — skipping"
fi

echo "▶ Creating /etc/azzco-ops-core.env (if missing)..."
if [ ! -f /etc/azzco-ops-core.env ]; then
  cat > /etc/azzco-ops-core.env << 'EOF'
# AZZCO Ops Core — production environment
AZZCO_API_HOST=127.0.0.1
AZZCO_API_PORT=8788
AZZCO_API_TOKEN=REPLACE_WITH_STRONG_TOKEN
AZZCO_DATA_ROOT=/var/lib/azzco-ops-core
AZZCO_LOG_DIR=/var/log/azzco
# Link to council (same server — localhost)
AZZCO_COUNCIL_URL=http://127.0.0.1:8787/route
AZZCO_COUNCIL_TOKEN=REPLACE_WITH_SAME_COUNCIL_TOKEN
EOF
  chmod 640 /etc/azzco-ops-core.env
  chown root:azzco /etc/azzco-ops-core.env
  echo "  Created /etc/azzco-ops-core.env — FILL IN VALUES BEFORE STARTING"
else
  echo "  /etc/azzco-ops-core.env already exists — skipping"
fi

echo "▶ Creating data root for ops-core..."
mkdir -p /var/lib/azzco-ops-core
chown azzco:azzco /var/lib/azzco-ops-core

echo "▶ Installing systemd unit files..."
cp "$COUNCIL_DIR/../deploy/azzco-council.service" /etc/systemd/system/azzco-council.service
cp "$OPS_CORE_DIR/deploy/systemd/azzco-ops-core.service" /etc/systemd/system/azzco-ops-core.service

echo "▶ Reloading systemd..."
systemctl daemon-reload

echo "▶ Enabling services for auto-start on boot..."
systemctl enable azzco-council
systemctl enable azzco-ops-core

echo ""
echo "════════════════════════════════════════════════════════════"
echo " NEXT STEPS — do these manually:"
echo ""
echo "  1. Edit /etc/azzco-council.env  — set AZZCO_COUNCIL_TOKEN + HUGGINGFACE_TOKEN"
echo "  2. Edit /etc/azzco-ops-core.env — set AZZCO_API_TOKEN (same as council token)"
echo ""
echo "  3. Stop the currently-running bare node processes:"
echo "     pkill -f 'node /opt/azzco-council'"
echo "     pkill -f 'node src/cli.js api'"
echo ""
echo "  4. Start via systemd:"
echo "     systemctl start azzco-council"
echo "     systemctl start azzco-ops-core"
echo ""
echo "  5. Check status:"
echo "     systemctl status azzco-council"
echo "     systemctl status azzco-ops-core"
echo "     journalctl -u azzco-council -f"
echo "════════════════════════════════════════════════════════════"
