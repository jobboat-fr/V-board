#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# V-Board — Server Health Check & First-Time Setup Verification
# Run this on the server after cloning and configuring .env.
# Usage: bash deploy/install-front-desk.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="${VBOARD_REPO:-/opt/v-board}"
LOG_DIR="/var/log/vboard"

echo "▶ Creating log directory..."
mkdir -p "$LOG_DIR"
chmod 750 "$LOG_DIR"

echo ""
echo "▶ Checking Docker and Docker Compose..."
docker --version
docker compose version

echo ""
echo "▶ Checking repository at $REPO_DIR..."
if [ ! -f "$REPO_DIR/docker-compose.yml" ]; then
  echo "  ERROR: $REPO_DIR/docker-compose.yml not found."
  echo "  Clone the repository first:"
  echo "    git clone https://github.com/your-org/v-board.git $REPO_DIR"
  exit 1
fi

echo ""
echo "▶ Checking .env file..."
if [ ! -f "$REPO_DIR/.env" ]; then
  echo "  WARNING: $REPO_DIR/.env not found. Copying from .env.example..."
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  echo "  ⚠ Edit $REPO_DIR/.env and fill in:"
  echo "    VBOARD_COUNCIL_TOKEN"
  echo "    VBOARD_API_TOKEN"
  echo "    VBOARD_OWNER_WHATSAPP"
  echo "    LLM_API_TOKEN (or LLM_FALLBACK_API_KEY)"
fi

echo ""
echo "▶ Building and starting containers..."
cd "$REPO_DIR"
docker compose up -d --build

echo ""
echo "▶ Waiting for services to be healthy..."
sleep 10

echo ""
echo "▶ Checking ops-core health..."
if curl -sf http://127.0.0.1:8788/health | grep -q '"ok":true'; then
  echo "  ✓ ops-core is healthy"
else
  echo "  FAIL: ops-core health check failed"
  docker compose logs ops-core | tail -20
  exit 1
fi

echo ""
echo "▶ Checking council health (internal)..."
if docker compose exec council node -e "require('http').get('http://127.0.0.1:8787/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"; then
  echo "  ✓ council is healthy"
else
  echo "  FAIL: council health check failed"
  docker compose logs council | tail -20
  exit 1
fi

echo ""
echo "▶ Running ops-core doctor (9-fixture route grid)..."
docker compose exec ops-core node src/cli.js doctor && echo "  ✓ doctor PASS" || echo "  WARNING: doctor reported issues"

echo ""
echo "════════════════════════════════════════════════════════════"
echo " ✓ V-Board is running."
echo ""
echo " Services:"
docker compose ps
echo ""
echo " Useful commands:"
echo "   docker compose logs -f ops-core      # follow ops-core logs"
echo "   docker compose logs -f council        # follow council logs"
echo "   docker compose logs -f runner         # follow cron jobs"
echo "   docker compose exec ops-core          # shell into ops-core"
echo "   curl http://127.0.0.1:8788/dashboard  # live dashboard"
echo "════════════════════════════════════════════════════════════"
