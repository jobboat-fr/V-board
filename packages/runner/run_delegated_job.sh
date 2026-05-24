#!/bin/sh
set -eu

CONTAINER="${OPENCLAW_CONTAINER:-openclaw-uix8-openclaw-1}"
OWNER="${AZZCO_OWNER_WHATSAPP:?AZZCO_OWNER_WHATSAPP is required}"
CATEGORY="${1:-owner_decision_meeting}"
URGENCY="${2:-P2}"
RUN_ROOT="/root/azzco-openclaw-runner"
LOG_DIR="$RUN_ROOT/logs"
mkdir -p "$LOG_DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
run_id="${CATEGORY}_${ts}_$$"
report_file="$LOG_DIR/${run_id}.txt"
err_file="$LOG_DIR/${run_id}.err"
report_day="$(date -u +%F)"
report_archive_dir="/data/.openclaw/workspace/reports/$report_day"
report_archive_path="$report_archive_dir/${run_id}.md"

status="ok"
if ! timeout 720 /usr/bin/docker exec "$CONTAINER" /data/.openclaw/workspace/bin/azzco_delegate_and_render.js "$CATEGORY" "$URGENCY" >"$report_file" 2>"$err_file"; then
  status="blocked"
  {
    echo "AZZCO ${CATEGORY} - BLOCKED"
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Urgency: $URGENCY"
    echo
    echo "Reason: deterministic Hostinger runner could not complete the OVH delegation."
    echo "Hostinger did not invent a local answer."
    echo
    echo "Stderr:"
    sed -n '1,80p' "$err_file" 2>/dev/null || true
  } >"$report_file"
fi

if grep -q " - BLOCKED" "$report_file"; then
  status="blocked"
fi

/usr/bin/docker exec "$CONTAINER" mkdir -p "$report_archive_dir"
/usr/bin/docker cp "$report_file" "$CONTAINER:$report_archive_path"
/usr/bin/docker exec -u 0 "$CONTAINER" chown 1000:1000 "$report_archive_path" 2>/dev/null || true

delivery_status="delivered"
if ! /usr/bin/docker exec -i -e TARGET="$OWNER" "$CONTAINER" node /data/.openclaw/workspace/bin/azzco_send_whatsapp_stdin.js <"$report_file"; then
  delivery_status="delivery_failed"
  status="blocked"
fi

/usr/bin/docker exec -i -e CATEGORY="$CATEGORY" -e URGENCY="$URGENCY" -e STATUS="$status" -e DELIVERY_STATUS="$delivery_status" -e RUN_ID="$run_id" -e REPORT_PATH="$report_archive_path" "$CONTAINER" node - <<'NODE'
const fs = require("fs");
const path = require("path");
const root = "/data/.openclaw/workspace/ops/runner";
const reportsRoot = "/data/.openclaw/workspace/reports";
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
  scheduler: "host_linux_cron",
  execution: "hostinger_collects_ovh_analyzes_hostinger_delivers"
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

/usr/bin/docker exec "$CONTAINER" node /data/.openclaw/workspace/bin/azzco_runner_status_summary.js >/dev/null 2>&1 || true

echo "$run_id $CATEGORY $URGENCY $status $delivery_status"
