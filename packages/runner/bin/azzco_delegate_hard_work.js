#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.AZZCO_WORKSPACE || "/workspace";
const category = process.argv[2] || "owner_decision_meeting";
const urgency = process.argv[3] || "P2";
const outDir = path.join(ROOT, "ops/context");
const outPath = path.join(outDir, `council_last_${category}.json`);

const prompts = {
  owner_decision_meeting:
    "council back office: analyze the compact runner evidence and prepare an owner-grade decision brief. runner will deliver and execute; council prepares only.",
  morning_brief:
    "council hard-work office: synthesize an owner-grade morning brief from runner collector evidence. Identify failures, blocked reports, CRM/mail status, and exact owner actions. runner will deliver; council prepares only.",
  incident_watchdog:
    "council incident office: analyze runner collector evidence for cron failures, incomplete outputs, channel failures, bridge failures, cost/security/platform risks. Return P0/P1/P2 labels and next safe actions. runner will deliver; council prepares only.",
  cto_audit:
    "council CTO office: analyze platform/MCP/infra evidence. Do not invent Railway/Vercel health if evidence is absent. Return blocked checks explicitly. runner will deliver; council prepares only.",
  lead_scout:
    "council CRM/Sales office: analyze lead scout evidence, score prospects, reject weak evidence, prepare cold/hot labels and owner approval needs. runner writes CRM/sends emails only after policy.",
  crm_pipeline:
    "council CRM office: analyze pipeline evidence, stages, hot/warm lead risk, and next actions. runner writes CRM and sends communications.",
  mail_triage:
    "council quality office: analyze mail triage evidence, label hot/warm/cold/admin/finance/legal/security, decide approval gates, and prepare safe reply recommendations. runner sends only allowed actions.",
  legal_accounting:
    "council legal/accounting office: analyze owner-only evidence for fiscal/legal/accounting risks. Do not file/pay/sign. runner reports to owner only.",
  legal_finance_sentinel:
    "council legal/accounting sentinel: inspect compact evidence for P0/P1 fiscal, legal, document, invoice, bank, and social risks. Do not file/pay/sign. runner reports to owner only.",
  invoice_reconciliation:
    "council finance office: analyze invoice/receipt/bank matching evidence and missing proof. runner stores/transfers files and reports to owner.",
  deal_desk:
    "council deal desk: evaluate warm/hot opportunities, objections, risk, confidence threshold, and exact next-best-action. runner sends only approved communication.",
  approval_queue:
    "council quality office: review pending approvals, blocked sends, hot/warm replies, and risk gates. runner executes only owner-approved actions.",
  document_vault:
    "council records office: audit document indexing and missing legal/accounting proof. runner stores/transfers files and reports owner-only.",
  deep_legal_scan:
    "council legal office: perform deep owner-only legal scan from indexed evidence, list risks, missing documents, validation needs, and blocked items. Do not file/sign/commit.",
  deep_accounting_scan:
    "council finance office: perform deep owner-only accounting scan from indexed evidence, list bank/invoice/receipt gaps and accountant-ready actions. Do not file/pay/commit.",
  deep_risk_synthesis:
    "council risk office: synthesize legal, accounting, CRM, infra, cost, and security risks into owner-only priorities. runner reports only.",
  weekly_board_brief:
    "council chief-of-staff office: synthesize a weekly owner board brief from compact evidence. runner delivers; council prepares only."
};

function run(command, args, input, timeoutMs) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 24
  });
  return {
    status: result.status,
    durationMs: Date.now() - startedAt,
    error: result.error ? (result.error.code || result.error.message) : null,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

fs.mkdirSync(outDir, { recursive: true });

const collect = run(path.join(ROOT, "bin/azzco_morning_collect.sh"), [], "", 120000);
const ops = readJson(path.join(outDir, "latest_ops_status.json"), {
  ok: false,
  error: "latest_ops_status_missing"
});
const documentIndex = readJson(path.join(outDir, "document_index.json"), []);
const bankTransactions = readJson(path.join(outDir, "bank_transactions.json"), []);
const bankStatementValidation = readJson(path.join(outDir, "bank_statement_validation.json"), null);
const invoiceCandidates = readJson(path.join(outDir, "invoice_candidates.json"), []);
const invoiceMatches = readJson(path.join(outDir, "invoice_matches.json"), []);
const missingInvoices = readJson(path.join(outDir, "missing_invoices.json"), []);
const dailyContext = (() => {
  try {
    return fs.readFileSync(path.join(outDir, "daily_context.md"), "utf8").slice(0, 10000);
  } catch {
    return "";
  }
})();

const compactEvidence = {
  collector_ok: collect.status === 0 && !collect.error,
  collector_error: collect.error || (collect.status === 0 ? null : `exit_${collect.status}`),
  generatedAt: ops.generatedAt,
  cronRuns: ops.cronRuns || {},
  contextFiles: ops.workspace?.contextFiles || {},
  evidenceMemory: {
    dailyContext,
    documentSummary: {
      count: Array.isArray(documentIndex) ? documentIndex.length : 0,
      byCategory: Array.isArray(documentIndex)
        ? documentIndex.reduce((acc, doc) => {
            acc[doc.category || "unknown"] = (acc[doc.category || "unknown"] || 0) + 1;
            return acc;
          }, {})
        : {},
      keyDocuments: Array.isArray(documentIndex)
        ? documentIndex.slice(0, 60).map((doc) => ({
            name: doc.name,
            path: doc.relativePath || doc.path,
            category: doc.category,
            extractedChars: doc.extractedChars,
            preview: doc.textPreview,
            signals: doc.signals
          }))
        : []
    },
    bankStatementValidation,
    bankTransactions: Array.isArray(bankTransactions) ? bankTransactions.slice(0, 180) : [],
    invoiceCandidates: Array.isArray(invoiceCandidates) ? invoiceCandidates.slice(0, 80) : [],
    invoiceMatches: Array.isArray(invoiceMatches) ? invoiceMatches.slice(0, 80) : [],
    missingInvoices: Array.isArray(missingInvoices) ? missingInvoices.slice(0, 120) : []
  },
  rules: ops.rules || {},
  note:
    "runner collected this compact packet. council must analyze. runner delivers and executes allowed actions only."
};

function buildCategoryEvidence(base) {
  const items = [base];
  const ctxDir = ROOT + "/ops/context";
  function safeJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } }
  function safeText(p) { try { return fs.readFileSync(p, "utf8").slice(0, 8000); } catch { return null; } }
  if (["mail_triage","morning_brief","approval_queue"].includes(category)) {
    const snap = safeJson(ROOT + "/mail/triage/latest_inbox_snapshot.json", null);
    if (snap && snap.ok && Array.isArray(snap.rows)) {
      items.push({ source: "runner_mail_inbox_snapshot", snapshotOk: snap.ok,
        checkedAt: snap.checkedAt, account: snap.account, inspected: snap.inspected,
        actionable: snap.actionable, policy: snap.policy,
        rows: snap.rows.slice(0, 20).map(function(r) {
          return { id: r.id, subject: r.subject, from: r.from, date: r.date,
            flags: r.flags, localLabel: r.localLabel,
            council: r.council ? { category: r.council.category, mailLabel: r.council.mailLabel,
              automationMode: r.council.automationMode, ownerApprovalRequired: r.council.ownerApprovalRequired,
              allowedActions: r.council.allowedActions } : null };
        })
      });
    }
  }
  if (["crm_pipeline","deal_desk","approval_queue","weekly_board_brief"].includes(category)) {
    const leads = safeText(ROOT + "/crm/leads.md");
    if (leads) items.push({ source: "crm_leads_md", content: leads });
  }
  if (["lead_scout","crm_pipeline","deal_desk"].includes(category)) {
    const cands = safeJson(ctxDir + "/lead_scout_fresh_candidates.json", null);
    if (cands) items.push({ source: "lead_scout_fresh_candidates", candidates: cands });
  }
  if (["cto_audit","incident_watchdog","morning_brief"].includes(category)) {
    try {
      const logDir = "/root/azzco-openclaw-runner/logs";
      const files = fs.readdirSync(logDir).sort().reverse().slice(0, 8);
      items.push({ source: "runner_recent_logs_index", files: files });
    } catch {}
  }
  if (["invoice_reconciliation","legal_finance_sentinel","deep_accounting_scan","deep_risk_synthesis","legal_accounting"].includes(category)) {
    const financeReport = safeJson(ROOT + "/finance/reports/finance_report.json", null);
    if (financeReport && financeReport.ok) {
      items.push({
        source: "cfo_stack_finance_report",
        version: financeReport.version,
        status: financeReport.status,
        generatedAt: financeReport.generatedAt,
        summary: financeReport.summary,
        incomeStatement: financeReport.incomeStatement,
        expenseBreakdown: { total: financeReport.expenseBreakdown.total, ranked: (financeReport.expenseBreakdown.ranked || []).slice(0, 10) },
        validation: financeReport.validation,
        missingDocuments: (financeReport.missingDocuments || []).slice(0, 30),
        unclassifiedTransactions: financeReport.unclassifiedTransactions || [],
        facts: financeReport.facts
      });
    }
  }
  return items;
}

const packet = {
  prompt: prompts[category] || prompts.owner_decision_meeting,
  category,
  urgency,
  owner: true,
  force_ovh: true,
  source: "runner_frontdesk_delegate_script",
  channel: "internal_bridge",
  requested_action: "analyze_prepare_only",
  evidence: buildCategoryEvidence(compactEvidence),
  execution_contract: {
    hostinger_collects: true,
    hostinger_sends: true,
    hostinger_writes_crm: true,
    council_analyzes: true,
    council_sends: false,
    council_writes_crm: false
  }
};

const bridge = run("node", [path.join(ROOT, "bin/azzco_route_or_bridge.js")], JSON.stringify(packet), 360000);

let parsed;
try {
  parsed = JSON.parse(bridge.stdout);
} catch (error) {
  parsed = {
    ok: false,
    error: "BAD_BRIDGE_JSON",
    parseError: error.message,
    stdoutHead: bridge.stdout.slice(0, 1600),
    stderrHead: bridge.stderr.slice(0, 1600)
  };
}

const result = {
  ok: Boolean(parsed.ok),
  generatedAt: new Date().toISOString(),
  category,
  urgency,
  durationMs: bridge.durationMs,
  bridge: parsed,
  packet
};

writeJsonAtomic(outPath, result);
console.log(JSON.stringify(result, null, 2));
process.exit(0);
