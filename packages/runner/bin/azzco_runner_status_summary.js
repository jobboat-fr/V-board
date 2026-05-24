#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = "/data/.openclaw/workspace";
const RUNNER = path.join(ROOT, "ops/runner");
const OUT = path.join(RUNNER, "CURRENT_STATUS.md");

const labels = {
  morning_brief: "Morning Brief",
  incident_watchdog: "Incident Watchdog",
  cto_audit: "CTO Platform Audit",
  lead_scout: "Lead Scout",
  mail_triage: "Mail Triage",
  crm_pipeline: "CRM Daily Update",
  legal_finance_sentinel: "Legal/Finance Sentinel",
  deal_desk: "Deal Desk",
  approval_queue: "Approval Queue",
  invoice_reconciliation: "Invoice Follow-up",
  document_vault: "Document Vault Audit",
  deep_legal_scan: "Deep Legal Scan",
  deep_accounting_scan: "Deep Accounting Scan",
  deep_risk_synthesis: "Deep Risk Synthesis",
  weekly_board_brief: "Weekly Board Brief"
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function parisTime(iso) {
  if (!iso) return "unknown local time";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      dateStyle: "short",
      timeStyle: "medium"
    }).format(new Date(iso));
  } catch {
    return "unknown local time";
  }
}

function oneLineStatus(category) {
  const latest = readJson(path.join(RUNNER, `last_${category}.json`));
  if (!latest) return `- ${labels[category] || category}: scheduled, no deterministic run recorded yet`;
  return `- ${labels[category] || category}: ${latest.status} / ${latest.deliveryStatus} at ${latest.generatedAt} UTC / ${parisTime(latest.generatedAt)} Europe/Paris (${latest.execution})`;
}

fs.mkdirSync(RUNNER, { recursive: true });
const schedule = fs.existsSync(path.join(RUNNER, "azzco-openclaw-runner.cron"))
  ? fs.readFileSync(path.join(RUNNER, "azzco-openclaw-runner.cron"), "utf8").trim()
  : "schedule mirror missing";

const categories = Object.keys(labels);
const text = [
  "# AZZCO Current Scheduler Status",
  "",
  `Generated: ${new Date().toISOString()} UTC / ${parisTime(new Date().toISOString())} Europe/Paris`,
  "",
  "Source of truth:",
  "- Canonical scheduler: host Linux cron /etc/cron.d/azzco-openclaw-runner",
  "- Workspace mirror: /data/.openclaw/workspace/ops/runner/azzco-openclaw-runner.cron",
  "- OpenClaw hard-work agent-crons are intentionally disabled. Do not report them as missing.",
  "- Execution: Hostinger collects/delivers, OVH analyzes/prepares.",
  "",
  "Latest deterministic runner statuses:",
  ...categories.map(oneLineStatus),
  "",
  "Schedule mirror:",
  "```cron",
  schedule,
  "```"
].join("\n");

fs.writeFileSync(OUT, `${text}\n`);
console.log(text);
