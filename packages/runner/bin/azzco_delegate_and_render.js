#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.AZZCO_WORKSPACE || "/workspace";
const category = process.argv[2] || "owner_decision_meeting";
const urgency = process.argv[3] || "P2";
const outDir = path.join(ROOT, "ops/context");
const jsonPath = path.join(outDir, `council_last_${category}.json`);
const textPath = path.join(outDir, `council_last_${category}.txt`);

const titles = {
  morning_brief: "AZZCO Morning Brief",
  incident_watchdog: "AZZCO Incident Watchdog",
  cto_audit: "AZZCO CTO Platform Audit",
  lead_scout: "AZZCO Lead Scout",
  crm_pipeline: "AZZCO CRM Pipeline",
  mail_triage: "AZZCO Mail Triage",
  legal_accounting: "AZZCO Legal/Accounting Review",
  legal_finance_sentinel: "AZZCO Legal Finance Sentinel",
  invoice_reconciliation: "AZZCO Invoice Reconciliation",
  deal_desk: "AZZCO Deal Desk",
  approval_queue: "AZZCO Approval Queue",
  document_vault: "AZZCO Document Vault Audit",
  deep_legal_scan: "AZZCO Deep Legal Scan",
  deep_accounting_scan: "AZZCO Deep Accounting Scan",
  deep_risk_synthesis: "AZZCO Deep Risk Synthesis",
  weekly_board_brief: "AZZCO Weekly Board Brief",
  owner_decision_meeting: "AZZCO Owner Decision Brief"
};

function runDelegate() {
  return spawnSync("node", [path.join(ROOT, "bin/azzco_delegate_hard_work.js"), category, urgency], {
    encoding: "utf8",
    timeout: 420000,
    maxBuffer: 1024 * 1024 * 28
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readResult() {
  for (let i = 0; i < 20; i += 1) {
    try {
      return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch {
      sleep(500);
    }
  }
  return null;
}

function compactList(items, limit = 6) {
  if (!Array.isArray(items) || items.length === 0) return ["none observed"];
  return items.slice(0, limit).map((item) => String(item));
}

function unique(items, limit = 8) {
  return [...new Set((items || []).flat().filter(Boolean).map((item) => String(item)))].slice(0, limit);
}

function bullets(items, limit = 6) {
  return compactList(items, limit).map((item) => `- ${item}`).join("\n");
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(outDir, name), "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  if (n > 1 && n <= 100) return Number((n / 100).toFixed(2));
  if (n > 100) return 1;
  if (n < 0) return 0;
  return Number(n.toFixed(2));
}

const FINANCE_CATEGORIES = new Set(["invoice_reconciliation", "legal_finance_sentinel", "deep_accounting_scan", "deep_risk_synthesis", "legal_accounting"]);
const MAIL_CATEGORIES = new Set(["mail_triage", "morning_brief", "approval_queue"]);
const CRM_CATEGORIES = new Set(["crm_pipeline", "deal_desk"]);
const INFRA_CATEGORIES = new Set(["incident_watchdog", "cto_audit"]);

function deterministicEvidence() {
  const documents = readJson("document_index.json", []);
  const legalDocs = documents.filter((doc) => doc.category === "legal_company").slice(0, 4);
  const baseFacts = [
    documents.length ? `[EMP] Document memory index contains ${documents.length} documents.` : null,
    ...legalDocs.map((doc) => `[EMP] Legal/company evidence indexed: ${doc.name}.`)
  ].filter(Boolean);

  if (FINANCE_CATEGORIES.has(category)) {
    const financeReport = readJsonFile(path.join(ROOT, "finance/reports/finance_report.json"), null); // ROOT from env
    if (financeReport && financeReport.ok && financeReport.facts) {
      const topExpenses = (financeReport.expenseBreakdown && financeReport.expenseBreakdown.ranked || []).slice(0, 3)
        .map((e) => `${e.description}: ${e.amount.toFixed(2)} EUR (${e.pct.toFixed(1)}%)`);
      const missingDocs = (financeReport.missingDocuments || []).slice(0, 8).map((item) => {
        const amt = Number(item.amount);
        return `${item.date} ${item.merchant} ${Number.isFinite(amt) ? amt.toFixed(2) : "?"} EUR`;
      });
      return {
        facts: [...baseFacts, ...financeReport.facts, ...(topExpenses.length ? [`[EMP] Top expense categories: ${topExpenses.join("; ")}.`] : [])],
        missing: missingDocs
      };
    }
    const bankValidation = readJson("bank_statement_validation.json", null);
    const missingInvoices = readJson("missing_invoices.json", []);
    const missing = missingInvoices.slice(0, 8).map((item) => {
      const amount = Number(item.amount);
      return `${item.date || "?"} ${item.merchant || "?"} ${Number.isFinite(amount) ? amount.toFixed(2) : "?"} EUR`;
    });
    return {
      facts: [...baseFacts,
        bankValidation ? `[EMP] Bank validation status: ${bankValidation.ok ? "OK" : "FAILED"}.` : "[EMP] Bank validation file missing.",
        bankValidation ? `[EMP] Declared totals: credits ${Number(bankValidation.declaredCreditsTotal || 0).toFixed(2)} EUR, debits ${Number(bankValidation.declaredDebitsTotal || 0).toFixed(2)} EUR.` : null
      ].filter(Boolean),
      missing
    };
  }

  if (MAIL_CATEGORIES.has(category)) {
    const mailSnapshot = readJsonFile(path.join(ROOT, "mail/triage/latest_inbox_snapshot.json"), null);
    const rows = mailSnapshot && Array.isArray(mailSnapshot.rows) ? mailSnapshot.rows : [];
    const hotCount = rows.filter((r) => (r.labels || []).includes("hot_mail")).length;
    const warmCount = rows.filter((r) => (r.labels || []).includes("warm_mail")).length;
    return {
      facts: [...baseFacts,
        rows.length ? `[EMP] Inbox snapshot contains ${rows.length} emails.` : "[EMP] Inbox snapshot missing or empty.",
        hotCount ? `[EMP] Hot-labeled emails: ${hotCount}.` : null,
        warmCount ? `[EMP] Warm-labeled emails: ${warmCount}.` : null
      ].filter(Boolean),
      missing: []
    };
  }

  if (CRM_CATEGORIES.has(category)) {
    const crmLeadsPath = path.join(ROOT, "crm/leads.md");
    let crmSize = 0;
    try { crmSize = fs.statSync(crmLeadsPath).size; } catch {}
    return {
      facts: [...baseFacts,
        crmSize > 120 ? `[EMP] CRM leads file exists (${crmSize} bytes).` : "[EMP] CRM leads file is empty or placeholder-only."
      ],
      missing: []
    };
  }

  if (INFRA_CATEGORIES.has(category)) {
    const runnerStatus = readJsonFile(path.join(ROOT, "ops/runner/CURRENT_STATUS.md"), null);
    const lastRun = readJsonFile(path.join(ROOT, "ops/runner/last_run.json"), null);
    return {
      facts: [...baseFacts,
        lastRun ? `[EMP] Last runner job: ${lastRun.category || "unknown"} at ${lastRun.startedAt || "unknown"}, status ${lastRun.status || "unknown"}.` : "[EMP] No last_run.json found."
      ].filter(Boolean),
      missing: []
    };
  }

  return { facts: baseFacts, missing: [] };
}

function renderBlocked(reason, detail) {
  return [
    `${titles[category] || titles.owner_decision_meeting} - BLOCKED`,
    `Category: ${category}`,
    `Urgency: ${urgency}`,
    "",
    `Reason: ${reason}`,
    detail ? `Detail: ${String(detail).slice(0, 900)}` : null,
    "",
    "Execution split:",
    "- runner collected/delivered only.",
    "- council analysis was required.",
    "- No local hard analysis was invented.",
    "",
    "Next action: check bridge/council logs before retrying."
  ].filter(Boolean).join("\n");
}

function fileBytes(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function countFiles(dir) {
  try {
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile()).length;
  } catch {
    return 0;
  }
}

function prepareCategorySources() {
  if (category === "mail_triage") {
    spawnSync("node", [path.join(ROOT, "bin/mail_triage_collect.js")], {
      encoding: "utf8",
      timeout: 45000,
      maxBuffer: 1024 * 1024 * 8,
      env: { ...process.env, MAIL_TRIAGE_LIMIT: process.env.MAIL_TRIAGE_LIMIT || "20" }
    });
  }
}

function categoryPreflightBlock() {
  const crmLeads = path.join(ROOT, "crm/leads.md");
  const mailDir = path.join(ROOT, "mail");
  const mailSnapshot = path.join(ROOT, "mail/triage/latest_inbox_snapshot.json");
  const leadScoutFresh = path.join(outDir, "lead_scout_fresh_candidates.json");
  const bankValidation = readJson("bank_statement_validation.json", null);
  const financeCategories = new Set(["legal_finance_sentinel", "invoice_reconciliation", "deep_accounting_scan", "deep_risk_synthesis"]);
  const mailSnapshotJson = readJsonFile(mailSnapshot, null);
  const mailSnapshotOk = mailSnapshotJson?.ok === true && Array.isArray(mailSnapshotJson.rows);
  if (category === "mail_triage" && !mailSnapshotOk) {
    return {
      reason: "mail_source_snapshot_missing",
      detail: `No successful inbox snapshot exists under ${ROOT}/mail/triage/latest_inbox_snapshot.json. Refusing to invent mail labels or replies.`
    };
  }
  if (category === "lead_scout" && fileBytes(leadScoutFresh) < 20) {
    return {
      reason: "lead_source_collection_missing",
      detail: `No fresh lead source collection exists at ${ROOT}/ops/context/lead_scout_fresh_candidates.json. Refusing to invent prospects.`
    };
  }
  if (["crm_pipeline", "deal_desk", "approval_queue"].includes(category) && fileBytes(crmLeads) < 120) {
    return {
      reason: "crm_leads_missing",
      detail: `CRM lead file is empty or placeholder-only at ${ROOT}/crm/leads.md. Refusing to invent pipeline state.`
    };
  }
  if (financeCategories.has(category) && (!bankValidation || bankValidation.ok !== true)) {
    return {
      reason: "bank_statement_validation_failed",
      detail: bankValidation ? JSON.stringify(bankValidation).slice(0, 1400) : "No bank_statement_validation.json found"
    };
  }
  return null;
}

function render(result) {
  const preflight = categoryPreflightBlock();
  if (preflight) return renderBlocked(preflight.reason, preflight.detail);

  const stage = result?.bridge || {};
  const ovh = stage.bridge || {};
  const route = stage.route || {};
  const decision = ovh.decision || {};
  const packets = Array.isArray(ovh.packets) ? ovh.packets : [];
  const modelPlan = ovh.route?.models?.plan || [];
  const budget = ovh.route?.budget || {};
  const risks = unique([
    decision.top_risks || [],
    packets.flatMap((packet) => packet.risks || [])
  ]);
  const missing = unique([
    decision.missing_documents || [],
    packets.flatMap((packet) => packet.missing_documents || [])
  ]);
  const checks = unique([
    decision.mandatory_checks || [],
    packets.flatMap((packet) => packet.checks || [])
  ]);
  const actions = unique([
    decision.next_step ? [decision.next_step] : [],
    packets.flatMap((packet) => packet.recommended_action || [])
  ], 10);
  const models = modelPlan.map((item) => `${item.model} (${item.reason || item.alias})`);
  const deterministic = deterministicEvidence();
  const facts = unique([deterministic.facts, packets.flatMap((packet) => packet.facts_emp || [])], 14);
  const estimates = unique(packets.flatMap((packet) => packet.estimates_est || []), 8);
  const missingWithEvidence = unique([deterministic.missing, missing], 12);

  if (!result?.ok || !stage.ok || !ovh.ok) {
    return renderBlocked(ovh.error || stage.error || result?.error || "council bridge returned non-ok", JSON.stringify({ stage, ovh }).slice(0, 900));
  }

  return [
    `${titles[category] || titles.owner_decision_meeting}`,
    `Generated: ${result.generatedAt || new Date().toISOString()}`,
    `Route: runner -> council -> runner`,
    `Urgency: ${decision.urgency || urgency}`,
    `Decision: ${decision.action || "owner_review"}`,
    `Confidence: ${normalizeConfidence(decision.confidence)}`,
    "",
    "Execution split:",
    "- council prepared the analysis only.",
    "- runner is the communicator/courier.",
    "- council may not send WhatsApp, email, or CRM writes.",
    "- runner may execute only allowed/approved actions.",
    "",
    "Model/cost:",
    `- Models: ${models.length ? models.join("; ") : "not reported"}`,
    `- Estimated run cost: ${budget.estimatedUsd != null ? `$${Number(budget.estimatedUsd).toFixed(6)}` : "not reported"}`,
    `- Budget mode: ${budget.mode || "not reported"}`,
    "",
    "Concrete evidence facts:",
    bullets(facts),
    "",
    "Estimates/interpretation:",
    bullets(estimates),
    "",
    "Top risks:",
    bullets(risks),
    "",
    "Missing evidence/documents:",
    bullets(missingWithEvidence),
    "",
    "Mandatory checks:",
    bullets(checks),
    "",
    "Recommended next actions:",
    bullets(actions, 10),
    "",
    "Reliability:",
    "- Evidence-only; blocked items are not guessed.",
    "- [EMP] facts and [EST] estimates must remain separated in follow-up work."
  ].join("\n");
}

fs.mkdirSync(outDir, { recursive: true });
prepareCategorySources();
const preflight = categoryPreflightBlock();
if (preflight) {
  const report = renderBlocked(preflight.reason, preflight.detail);
  fs.writeFileSync(textPath, `${report}\n`);
  console.log(report);
  process.exit(0);
}

const run = runDelegate();
let result = null;
try {
  result = JSON.parse(String(run.stdout || "").trim());
} catch {
  result = readResult();
}

let report;
if (run.error) {
  report = renderBlocked(run.error.code || run.error.message, run.stderr || run.stdout);
} else if (run.status !== 0 && !result) {
  report = renderBlocked(`delegate_exit_${run.status}`, run.stderr || run.stdout);
} else if (!result) {
  report = renderBlocked("result_file_missing", `No result JSON at ${jsonPath}`);
} else {
  report = render(result);
}

fs.writeFileSync(textPath, `${report}\n`);
console.log(report);
