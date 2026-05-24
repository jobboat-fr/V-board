#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.VBOARD_WORKSPACE || "/workspace";
const RUNNER = path.join(ROOT, "ops/runner");

function trim(value, max = 10000) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}\n[TRUNCATED ${text.length - max} chars]` : text;
}

function cmd(args, timeoutMs = 45000) {
  const result = spawnSync("agent_runtime", args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 8
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    error: result.error ? (result.error.code || result.error.message) : null,
    stdout: trim(result.stdout),
    stderr: trim(result.stderr, 3000)
  };
}

function existsInfo(file) {
  try {
    const st = fs.statSync(file);
    return { exists: true, bytes: st.size, mtime: st.mtime.toISOString() };
  } catch {
    return { exists: false };
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function jsonShape(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(value) ? { ok: true, count: value.length } : { ok: true, keys: Object.keys(value || {}).length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function mdShape(file) {
  try {
    const lines = fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#") && !line.trim().startsWith("<!--"));
    return { ok: true, lines: lines.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function readText(file, max = 12000) {
  try {
    return trim(fs.readFileSync(file, "utf8"), max);
  } catch {
    return null;
  }
}

const runnerCategories = [
  "morning_brief",
  "incident_watchdog",
  "cto_audit",
  "lead_scout",
  "mail_triage",
  "crm_pipeline",
  "legal_finance_sentinel",
  "deal_desk",
  "approval_queue",
  "invoice_reconciliation",
  "document_vault",
  "deep_legal_scan",
  "deep_accounting_scan",
  "deep_risk_synthesis",
  "weekly_board_brief"
];

const runnerStatuses = {};
for (const category of runnerCategories) {
  const statusFile = path.join(RUNNER, `last_${category}.json`);
  runnerStatuses[category] = {
    statusFile,
    ...existsInfo(statusFile),
    latest: readJson(statusFile)
  };
}
runnerStatuses.morning = {
  statusFile: path.join(RUNNER, "last_morning.json"),
  ...existsInfo(path.join(RUNNER, "last_morning.json")),
  latest: readJson(path.join(RUNNER, "last_morning.json"))
};

const contextFiles = {
  crm_leads: path.join(ROOT, "crm/leads.md"),
  daily_context: path.join(ROOT, "ops/context/daily_context.md"),
  document_index: path.join(ROOT, "ops/context/document_index.json"),
  invoice_candidates: path.join(ROOT, "ops/context/invoice_candidates.json"),
  invoice_matches: path.join(ROOT, "ops/context/invoice_matches.json"),
  missing_invoices: path.join(ROOT, "ops/context/missing_invoices.json"),
  bank_transactions: path.join(ROOT, "ops/context/bank_transactions.json"),
  lead_scout_outputs: path.join(ROOT, "ops/context/lead_scout_outputs.md"),
  approval_queue: path.join(ROOT, "ops/approval_queue.md"),
  deterministic_schedule: path.join(RUNNER, "vboard-agent_runtime-runner.cron"),
  deterministic_schedule_compat: "/etc/cron.d/vboard-agent_runtime-runner"
};

const files = {};
for (const [name, file] of Object.entries(contextFiles)) {
  files[name] = { path: file, ...existsInfo(file) };
  if (files[name].exists && file.endsWith(".json")) files[name].shape = jsonShape(file);
  if (files[name].exists && file.endsWith(".md")) files[name].shape = mdShape(file);
}

console.log(JSON.stringify({
  ok: true,
  generatedAt: new Date().toISOString(),
  server: "front_desk_agent_runtime",
  purpose: "deterministic_ops_status_for_owner_reports",
  canonicalScheduler: {
    kind: "host_linux_cron",
    hostPath: "/etc/cron.d/vboard-agent_runtime-runner",
    workspaceMirror: path.join(RUNNER, "vboard-agent_runtime-runner.cron"),
    containerCompatMirror: "/etc/cron.d/vboard-agent_runtime-runner",
    note: "agent runtime hard-work agent-crons are intentionally disabled. Do not treat that as missing jobs."
  },
  rules: {
    canonical_scheduler_is_host_linux_cron: true,
    agent_runtime_agent_crons_disabled_intentionally: true,
    do_not_use_jira_tasks_todo_as_schedule_truth: true,
    incomplete_outputs_are_failures: true,
    council_prepares_runner_executes: true
  },
  runner: {
    scheduleText: readText(path.join(RUNNER, "vboard-agent_runtime-runner.cron"), 8000),
    lastRun: readJson(path.join(RUNNER, "last_run.json")),
    statuses: runnerStatuses
  },
  evidenceMemory: {
    dailyContext: readText(path.join(ROOT, "ops/context/daily_context.md"), 6000),
    documentIndex: (readJson(path.join(ROOT, "ops/context/document_index.json"), []) || []).slice(0, 80),
    bankTransactions: (readJson(path.join(ROOT, "ops/context/bank_transactions.json"), []) || []).slice(0, 160),
    bankStatementValidation: readJson(path.join(ROOT, "ops/context/bank_statement_validation.json"), null),
    invoiceCandidates: (readJson(path.join(ROOT, "ops/context/invoice_candidates.json"), []) || []).slice(0, 80),
    invoiceMatches: (readJson(path.join(ROOT, "ops/context/invoice_matches.json"), []) || []).slice(0, 80),
    missingInvoices: (readJson(path.join(ROOT, "ops/context/missing_invoices.json"), []) || []).slice(0, 120),
    refreshSummary: readJson(path.join(ROOT, "ops/context/document_memory_refresh_last.json"), null),
    refreshError: readText(path.join(ROOT, "ops/context/document_memory_refresh_last.err"), 2000)
  },
  agent_runtime: {
    status: cmd(["status"], 60000),
    cronList: cmd(["cron", "list"], 60000)
  },
  workspace: {
    agents: existsInfo(path.join(ROOT, "AGENTS.md")),
    protocolsDir: existsInfo(path.join(ROOT, "protocols")),
    contextFiles: files
  }
}, null, 2));
