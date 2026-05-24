#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const LIMIT = Number(process.env.MAIL_TRIAGE_LIMIT || 20);
const COUNCIL = "/data/.openclaw/workspace/bin/azzco_council_call.sh";
const OUT_DIR = "/data/.openclaw/workspace/mail/triage";
const SNAPSHOT = path.join(OUT_DIR, "latest_inbox_snapshot.json");
const COMMAND_TIMEOUT_MS = Number(process.env.MAIL_COMMAND_TIMEOUT_MS || 20000);

function emit(payload) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
}

function run(command, args, input = null, timeout = COMMAND_TIMEOUT_MS) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
    timeout,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : null,
  };
}

function stringifyAddress(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringifyAddress).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return value.address || value.email || value.name || JSON.stringify(value);
  }
  return String(value);
}

function normalizeEnvelope(item, index) {
  const id = item.id || item.uid || item.seq || item.index || String(index + 1);
  const subject = String(item.subject || item.headers?.subject || "");
  const from = stringifyAddress(item.from || item.sender || item.headers?.from);
  const to = stringifyAddress(item.to || item.headers?.to);
  const date = String(item.date || item.headers?.date || "");
  const flags = item.flags || item.flag || [];
  return { id, subject, from, to, date, flags };
}

function parseEnvelopes(raw) {
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.envelopes)
      ? parsed.envelopes
      : Array.isArray(parsed.items)
        ? parsed.items
        : Array.isArray(parsed.data)
          ? parsed.data
          : [];
  return items.map(normalizeEnvelope);
}

const riskPattern = /\b(invoice|receipt|payment|paid|refund|renewal|subscription|tax|vat|legal|contract|security|login|password|account|closure|delete|deletion|suspend|deadline|client|meeting|proposal|quote|devis|partnership|investor|bank|qonto|urssaf|impots?|ovh|vercel|railway|zoho|domain|dns|transaction|reverted|verification|code|kms|ram user)\b/i;
const noisePattern = /\b(newsletter|digest|promo|promotion|discount|sale|webinar|event invite|product update|release notes|welcome|bienvenue|unsubscribe|desabonnement|marketing|community|tips|guide|whitepaper|free trial|project ready)\b/i;
const spamPattern = /\b(casino|crypto|loan|viagra|winner|lottery|forex|get rich|dating)\b/i;

function classifyLocal(env) {
  const text = `${env.from}\n${env.subject}`.toLowerCase();
  const hasRisk = riskPattern.test(text);
  if (spamPattern.test(text)) return { localLabel: "spam/no action", ignored: true, reason: "spam pattern" };
  if (noisePattern.test(text) && !hasRisk) return { localLabel: "ignored_marketing", ignored: true, reason: "marketing/newsletter without risk keyword" };
  if (/qonto|payment|transaction|invoice|receipt|zoho|bank|refund|reverted/i.test(text)) return { localLabel: "finance/invoice", ignored: false };
  if (/security|login|verification|code|password|ram user|kms/i.test(text)) return { localLabel: "security", ignored: false };
  if (/ovh|closure|contract|legal|domain|dns|railway|vercel/i.test(text)) return { localLabel: "admin/legal", ignored: false };
  if (/meeting|proposal|devis|quote|partnership|client/i.test(text)) return { localLabel: "client", ignored: false };
  return { localLabel: "low priority", ignored: false };
}

function councilFor(env, local) {
  if (!fs.existsSync(COUNCIL)) {
    return { ok: false, error: "COUNCIL_SCRIPT_MISSING" };
  }

  const payload = {
    prompt: "Classify mail and harden reply draft",
    owner: true,
    channel: "openclaw",
    direction: "inbound",
    email: {
      id: String(env.id),
      from: env.from,
      subject: env.subject,
      body: `${local.localLabel}. ${local.reason || ""}`.trim(),
    },
    notes: "Mail triage candidate; metadata only, no private body.",
  };

  const result = run(COUNCIL, [], JSON.stringify(payload), 25000);
  if (result.code !== 0) return { ok: false, error: "COUNCIL_CALL_FAILED", stderr: (result.stderr || result.error || "").slice(0, 300) };
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      ok: Boolean(parsed.ok),
      category: parsed.route?.category,
      urgency: parsed.route?.urgency,
      safetyGates: parsed.route?.safety?.gates || parsed.decision?.safety_gates || [],
      mailLabel: parsed.decision?.mail_label || parsed.workflow?.mail_policy?.label || null,
      automationMode: parsed.decision?.mail_automation_mode || parsed.workflow?.mail_policy?.automation_mode || null,
      ownerApprovalRequired: Boolean(parsed.decision?.owner_approval_required || parsed.route?.safety?.owner_approval_required),
      allowedActions: parsed.decision?.openclaw_allowed_actions || [],
      blockedActions: parsed.decision?.openclaw_blocked_actions || [],
      estimatedUsd: parsed.route?.budget?.estimatedUsd || null,
    };
  } catch (error) {
    return { ok: false, error: "COUNCIL_JSON_PARSE_FAILED", rawPrefix: result.stdout.slice(0, 160) };
  }
}

const mail = run("himalaya", ["-o", "json", "envelope", "list", "--page-size", String(LIMIT)]);

if (mail.code !== 0) {
  emit({
    ok: false,
    status: "[BLOCKED]",
    error: "MAIL_CHECK_FAILED",
    commandError: mail.error,
    stderr: mail.stderr.slice(0, 500),
    checkedAt: new Date().toISOString(),
    rows: [],
  });
  process.exit(0);
}

let envelopes = [];
try {
  envelopes = parseEnvelopes(mail.stdout);
} catch (error) {
  emit({
    ok: false,
    status: "[BLOCKED]",
    error: "MAIL_JSON_PARSE_FAILED",
    detail: error.message,
    checkedAt: new Date().toISOString(),
    rows: [],
  });
  process.exit(0);
}

const rows = [];
let ignoredCount = 0;
for (const env of envelopes) {
  const local = classifyLocal(env);
  if (local.ignored) {
    ignoredCount += 1;
    rows.push({
      id: env.id,
      subject: env.subject,
      from: env.from,
      date: env.date,
      localLabel: local.localLabel,
      ignored: true,
      reason: local.reason,
    });
    continue;
  }

  const council = councilFor(env, local);
  rows.push({
    id: env.id,
    subject: env.subject,
    from: env.from,
    date: env.date,
    flags: env.flags,
    localLabel: local.localLabel,
    ignored: false,
    council,
  });
}

emit({
  ok: true,
  status: "OK",
  checkedAt: new Date().toISOString(),
  account: "default",
  inspected: envelopes.length,
  ignoredMarketingOrSpam: ignoredCount,
  actionable: rows.filter((row) => !row.ignored).length,
  rows,
  policy: {
    adsNewslettersIgnoredByDefault: true,
    repliesRequireCouncilGate: true,
    sendWithoutOwnerApproval: false,
    noRawBodiesRead: true,
  },
});
