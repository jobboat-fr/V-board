#!/bin/sh
# run_delegated_job.sh — container-native entry point (no docker exec)
# Runs directly inside the runner container. All paths resolved via AZZCO_WORKSPACE.
set -eu

WORKSPACE="${AZZCO_WORKSPACE:-/workspace}"
OWNER="${AZZCO_OWNER_WHATSAPP:?AZZCO_OWNER_WHATSAPP is required}"
CATEGORY="${1:-owner_decision_meeting}"
URGENCY="${2:-P2}"

LOG_DIR="${AZZCO_LOG_DIR:-$WORKSPACE/ops/logs/runner}"
mkdir -p "$LOG_DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
run_id="${CATEGORY}_${ts}_$$"
report_file="$LOG_DIR/${run_id}.txt"
err_file="$LOG_DIR/${run_id}.err"
report_day="$(date -u +%F)"
report_archive_dir="$WORKSPACE/reports/$report_day"
report_archive_path="$report_archive_dir/${run_id}.md"

mkdir -p "$report_archive_dir"

status="ok"
if ! timeout 720 node "$WORKSPACE/bin/azzco_delegate_and_render.js" "$CATEGORY" "$URGENCY" >"$report_file" 2>"$err_file"; then
  status="blocked"
  {
    echo "AZZCO ${CATEGORY} - BLOCKED"
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Urgency: $URGENCY"
    echo ""
    echo "Reason: runner could not complete the council delegation."
    echo "runner did not invent a local answer."
    echo ""
    echo "Stderr:"
    sed -n '1,80p' "$err_file" 2>/dev/null || true
  } >"$report_file"
fi

if grep -q " - BLOCKED" "$report_file"; then
  status="blocked"
fi

cp "$report_file" "$report_archive_path"

delivery_status="delivered"
if ! TARGET="$OWNER" node "$WORKSPACE/bin/azzco_send_whatsapp_stdin.js" <"$report_file"; then
  delivery_status="delivery_failed"
  status="blocked"
fi

RUN_ID="$run_id" \
CATEGORY="$CATEGORY" \
URGENCY="$URGENCY" \
STATUS="$status" \
DELIVERY_STATUS="$delivery_status" \
REPORT_PATH="$report_archive_path" \
node - <<'NODE'
const fs = require("fs");
const path = require("path");
const root = path.join(process.env.AZZCO_WORKSPACE || "/workspace", "ops/runner");
const reportsRoot = path.join(process.env.AZZCO_WORKSPACE || "/workspace", "reports");
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(reportsRoot, { recursive: true });
const status = {
  runId: process.env.RUN_ID,
  category: process.env.CATEGORY,
  urgency: process.env.URGENCY,
  status: process.env.STATUS,
  deliveryStatus: process.env.DELIVERY_STATUS,
  reportPath: process.env.REPORT_PATH,
  generatedAt: new Date().toISOString(),
  scheduler: "container_cron",
  execution: "runner_collects_council_analyzes_runner_delivers"
};
fs.writeFileSync(path.join(root, `last_${process.env.CATEGORY}.json`), JSON.stringify(status, null, 2));
fs.writeFileSync(path.join(root, "last_run.json"), JSON.stringify(status, null, 2));
const indexPath = path.join(reportsRoot, "INDEX.md");
const line = `- ${status.generatedAt} | ${status.category} | ${status.urgency} | ${status.status}/${status.deliveryStatus} | ${status.reportPath}\n`;
let existing = "";
try { existing = fs.readFileSync(indexPath, "utf8"); } catch {}
if (!existing.includes(status.runId)) {
  fs.writeFileSync(indexPath, `${existing || "# AZZCO Report Archive\n\n"}${line}`);
}
NODE

node "$WORKSPACE/bin/azzco_runner_status_summary.js" >/dev/null 2>&1 || true

echo "$run_id $CATEGORY $URGENCY $status $delivery_status"
