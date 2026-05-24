#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = "/data/.openclaw/workspace";
const now = new Date();
const iso = now.toISOString();
function ensureDir(p){ fs.mkdirSync(p,{recursive:true}); }
function read(file, fallback="") { try { return fs.readFileSync(file,"utf8"); } catch { return fallback; } }
function readJson(file, fallback=null) { try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch { return fallback; } }
function write(file, text){ ensureDir(path.dirname(file)); fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, "utf8"); }
function listReports(){
  const index = read(path.join(ROOT,"reports/INDEX.md"));
  return index.split(/\n/).filter(l=>l.startsWith("- ")).slice(-14).join("\n") || "- No report index entries found.";
}
function latestRunner(){
  const dir = path.join(ROOT,"ops/runner");
  const out=[];
  for (const f of fs.existsSync(dir)?fs.readdirSync(dir):[]) {
    if (!/^last_.*\.json$/.test(f) || f === "last_run.json") continue;
    const j = readJson(path.join(dir,f));
    if (j) out.push(`- ${j.category}: ${j.status}/${j.deliveryStatus || "unknown"} at ${j.generatedAt || "unknown"} (${j.reportPath || "no report path"})`);
  }
  return out.sort().join("\n") || "- No runner status JSON found.";
}
const finance = readJson(path.join(ROOT,"finance/reports/finance_report.json"));
const mail = readJson(path.join(ROOT,"mail/triage/latest_inbox_snapshot.json"));
const leads = read(path.join(ROOT,"crm/leads.md"), "# AZZCO CRM Leads\n\nNo leads recorded yet.\n");
const qontoStatus = readJson("/var/log/azzco/qonto-finance-status.last.json") || finance;
const financeSummary = finance?.summary || qontoStatus?.summary || {};
const financeValidation = finance?.validation || qontoStatus?.validation || {};
const unclassified = Array.isArray(finance?.unclassifiedTransactions) ? finance.unclassifiedTransactions : [];
const missingDocs = Array.isArray(finance?.missingDocuments) ? finance.missingDocuments : [];
const actionableRows = Array.isArray(mail?.rows) ? mail.rows.filter(r=>!r.ignored) : [];
const activeLeadCount = (leads.match(/^### /gm) || []).length;

write(path.join(ROOT,"KNOWLEDGE.md"), `# AZZCO Operational Knowledge\n\nLast refreshed: ${iso}\n\n## Architecture Source Of Truth\n- Hostinger is the front desk, communicator, Qonto credential holder, WhatsApp/Telegram/email courier, CRM writer, and deterministic scheduler.\n- OVH is the heavy analysis worker/council. OVH prepares analysis only and must not send WhatsApp, email, or write CRM directly.\n- Canonical scheduled jobs live in host Linux cron: /etc/cron.d/azzco-openclaw-runner. OpenClaw native cron is not the source of truth for hard jobs.\n- Finance/Qonto deterministic sync lives at /usr/local/bin/azzco-qonto-finance-sync.sh and runs daily at 07:17 Europe/Paris.\n\n## Verified Finance Facts\n- Qonto transaction count: ${financeValidation.transactionCount ?? "unknown"}\n- Classification rate: ${financeValidation.classificationRate ?? "unknown"}%\n- Invoice-linked transactions: ${financeValidation.invoiceLinkedCount ?? "unknown"}\n- Period net movement: ${financeSummary.periodNetMovement ?? "unknown"} EUR\n- Client revenue: ${financeSummary.clientRevenue ?? "unknown"} EUR\n- Expenses: ${financeSummary.totalExpenses ?? "unknown"} EUR\n- Remaining unclassified transactions: ${financeValidation.unclassifiedCount ?? "unknown"}\n\n## Known Open Issues\n${unclassified.map(tx=>`- Classify: ${tx.date} ${tx.merchant} ${tx.amount} EUR`).join("\n") || "- No unclassified finance transactions observed."}\n${missingDocs.slice(0,10).map(tx=>`- Missing proof candidate: ${tx.date} ${tx.merchant} ${tx.amount} EUR`).join("\n")}\n\n## Latest Runner Status\n${latestRunner()}\n\n## Latest Report Archive Entries\n${listReports()}\n`);

write(path.join(ROOT,"HEARTBEAT.md"), `# AZZCO Heartbeat\n\nLast refreshed: ${iso}\n\n## What To Check Every Day\n- 07:17 Europe/Paris: deterministic Qonto finance sync must finish with status ok.\n- 07:30 Europe/Paris: morning brief should use persisted runner state, not OpenClaw native cron.\n- 08:00/18:00 Europe/Paris: lead scout should produce evidence-backed candidates or explicitly say blocked/no candidates.\n- 08:30/18:30 Europe/Paris: mail triage should update mail/triage/latest_inbox_snapshot.json and mail/triage.md.\n- 19:15 Europe/Paris: CRM pipeline should update crm/leads.md and crm/pipeline.md.\n- Weekly Sunday: deep legal/accounting scans should run from indexed docs and Qonto evidence.\n\n## Escalation Rule\nIf a report is missing, stale, hallucinated, or lacks concrete source evidence, mark it BLOCKED and notify owner. Never invent CRM, mail, finance, or legal facts.\n\n## Source Of Truth\n- Reports: /data/.openclaw/workspace/reports/INDEX.md\n- Runner status: /data/.openclaw/workspace/ops/runner/CURRENT_STATUS.md\n- Finance status: /data/.openclaw/workspace/finance/reports/finance_report.json\n- CRM leads: /data/.openclaw/workspace/crm/leads.md\n- Mail triage snapshot: /data/.openclaw/workspace/mail/triage/latest_inbox_snapshot.json\n`);

write(path.join(ROOT,"mail/triage.md"), `# AZZCO Mail Triage\n\nLast refreshed: ${iso}\n\nSnapshot status: ${mail?.status || "missing"}\nChecked at: ${mail?.checkedAt || "unknown"}\nInspected: ${mail?.inspected ?? 0}\nIgnored marketing/spam: ${mail?.ignoredMarketingOrSpam ?? 0}\nActionable: ${mail?.actionable ?? actionableRows.length}\n\n## Actionable Mail\n${actionableRows.slice(0,20).map(r=>`- ${r.id}: ${r.council?.mailLabel || r.localLabel || "unlabeled"} / ${r.localLabel || "unknown"} / approval=${r.council?.ownerApprovalRequired === true} — ${r.from} — ${r.subject}`).join("\n") || "- No actionable mail snapshot available."}\n\n## Policy\n- Ads/newsletters/spam are ignored by default unless risk keywords appear.\n- Hot/warm/client/finance/security mail requires owner approval before sending.\n- No raw mail body is sent to OVH; metadata only.\n`);

write(path.join(ROOT,"crm/pipeline.md"), `# AZZCO CRM Pipeline\n\nLast refreshed: ${iso}\n\nActive lead records found: ${activeLeadCount}\n\n## Current Leads Snapshot\n${leads.split(/\n/).slice(0,120).join("\n")}\n\n## Automation Policy\n- Cold/low-temperature outreach can be drafted and queued locally only when public contact evidence exists.\n- Hot mail, client replies, legal/accounting, pricing, proposals, contracts, and commitments require OVH preparation plus owner approval.\n- Hostinger sends and writes CRM; OVH prepares only.\n`);

const memPath = path.join(ROOT,"MEMORY.md");
let memory = read(memPath, "# MEMORY.md\n");
const marker = "<!-- AZZCO_DAILY_OPS_MEMORY_START -->";
const end = "<!-- AZZCO_DAILY_OPS_MEMORY_END -->";
const block = `${marker}\n\n## Daily Ops Memory\nLast refreshed: ${iso}\n\n- Hostinger is the communicator/courier/Qonto holder; OVH is heavy analysis only.\n- Canonical hard-job scheduler is host Linux cron /etc/cron.d/azzco-openclaw-runner.\n- Qonto/CFO deterministic pipeline is active and evidence-bound.\n- Current finance pack: ${financeValidation.transactionCount ?? "unknown"} transactions, ${financeValidation.classificationRate ?? "unknown"}% classified, ${financeValidation.invoiceLinkedCount ?? "unknown"} invoice-linked, ${financeValidation.unclassifiedCount ?? "unknown"} unclassified.\n- Current CRM leads file contains ${activeLeadCount} lead sections.\n- Mail triage latest snapshot inspected ${mail?.inspected ?? 0} envelopes and found ${mail?.actionable ?? actionableRows.length} actionable items.\n- Reports must be read from /data/.openclaw/workspace/reports/INDEX.md; WhatsApp delivery is not the source of truth.\n\n${end}`;
const re = new RegExp(`${marker}[\\s\\S]*?${end}`);
memory = re.test(memory) ? memory.replace(re, block) : `${memory.trim()}\n\n${block}\n`;
write(memPath, memory);
write(path.join(ROOT,"ops/runner/daily_records_status.json"), JSON.stringify({ ok:true, refreshedAt: iso, activeLeadCount, finance: { transactionCount: financeValidation.transactionCount, classificationRate: financeValidation.classificationRate, invoiceLinkedCount: financeValidation.invoiceLinkedCount, unclassifiedCount: financeValidation.unclassifiedCount }, mail: { inspected: mail?.inspected || 0, actionable: mail?.actionable || actionableRows.length }}, null, 2));
console.log(JSON.stringify({ ok:true, refreshedAt: iso, activeLeadCount, files:["KNOWLEDGE.md","HEARTBEAT.md","crm/pipeline.md","mail/triage.md","MEMORY.md"]}, null, 2));
