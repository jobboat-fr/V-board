"use strict";

const fs = require("fs");

const COUNCIL_REQUIRED_CATEGORIES = new Set([
  "morning_brief",
  "mail_triage",
  "lead_scout",
  "legal_accounting",
  "legal_finance_sentinel",
  "invoice_reconciliation",
  "deep_legal_scan",
  "deep_accounting_scan",
  "deep_risk_synthesis",
  "document_vault",
  "cto_audit",
  "incident_watchdog",
  "owner_decision_meeting",
  "deal_desk",
  "approval_queue",
  "weekly_board_brief",
  "bi_metrics",
  "product_project_ops",
  "vendor_ops"
]);

const RUNNER_LOCAL_CATEGORIES = new Set([
  "simple_chat",
  "daily_communications",
  "mail_labeling",
  "crm_pipeline",
  "cold_email_campaign"
]);

function textOf(input = {}) {
  return [
    input.prompt,
    input.message,
    input.notes,
    input.email?.subject,
    input.email?.body,
    input.email?.from,
    input.lead?.name,
    input.lead?.email,
    input.lead?.website,
    input.lead?.sector,
    input.lead?.need
  ].filter(Boolean).join("\n").toLowerCase();
}

function contains(text, words) {
  return words.some((word) => text.includes(word));
}

function hasCommitmentRisk(text) {
  const sanitized = text
    .replace(/\b(no|without)\s+(price|pricing|devis|proposal|sign(?:ature)?|refund|appointment|rendez-vous|guarantee|commitment|contract)s?\b/g, "")
    .replace(/\bsans\s+(prix|devis|proposition|signature|remboursement|rendez-vous|garantie|engagement|contrat)s?\b/g, "");
  const riskWords = [
    "price", "pricing", "devis", "proposal", "sign", "signature", "refund",
    "appointment", "rendez-vous", "guarantee"
  ];
  if (contains(sanitized, riskWords)) return true;

  const commitmentMentions = ["commitment", "contract"];
  return contains(sanitized, commitmentMentions);
}

function classify(input = {}) {
  const text = textOf(input);
  const owner = input.owner !== false;
  const category = input.category || inferCategory(text, input);
  const restricted = Boolean(input.restricted || contains(text, [
    "bank", "invoice", "receipt", "tax", "urssaf", "dsn", "payroll", "legal", "statuts",
    "contract", "secret", "token", "api key", "password", "internal", "confidential",
    "accounting", "fiscal", "social", "kbis", "rbe"
  ]));
  const urgency = input.urgency || inferUrgency(text);
  const temperature = input.temperature ?? inferTemperature(text, input, restricted, urgency);
  const mailLabel = input.mail_label || inferMailLabel(text, input, restricted, temperature);
  const hasVerifiedContact = Boolean(input.lead?.email || input.email?.from || /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text));
  const publicEvidence = Boolean(input.lead?.website || contains(text, ["public website", "public source", "website:", "https://", "www."]));

  const councilReasons = [];
  if (input.force_council === true || input.force_ovh === true || input.delegate_to_council === true) councilReasons.push("explicit_council_delegation");
  if (!owner && restricted) councilReasons.push("non_owner_restricted");
  if (restricted) councilReasons.push("restricted_legal_accounting_or_internal");
  if (urgency === "P0" || urgency === "P1") councilReasons.push(`urgency_${urgency}`);
  if (temperature >= 70 || mailLabel === "hot_mail") councilReasons.push("hot_temperature");
  if (mailLabel === "warm_mail" && temperature >= 45) councilReasons.push("warm_requires_quality_review");
  if (COUNCIL_REQUIRED_CATEGORIES.has(category)) {
    councilReasons.push(`category_${category}`);
  }
  if (hasCommitmentRisk(text)) {
    councilReasons.push("commitment_or_reputation_risk");
  }
  if (contains(text, ["ambiguous", "unclear", "missing evidence", "not sure", "unknown_mail"])) councilReasons.push("ambiguous_or_missing_evidence");
  if (contains(text, ["morning brief", "daily executive brief", "board brief", "strategic daily plan"])) councilReasons.push("morning brief requires council synthesis");

  const localColdAllowed = Boolean(
    owner &&
      !restricted &&
      urgency === "P3" &&
      (mailLabel === "cold_mail" || mailLabel === "spam" || mailLabel === "none") &&
      temperature < 45 &&
      (
        mailLabel !== "cold_mail" ||
        (hasVerifiedContact && publicEvidence)
      )
  );

  const localRoutineAllowed = Boolean(
    !restricted &&
      urgency === "P3" &&
      temperature < 45 &&
      RUNNER_LOCAL_CATEGORIES.has(category)
  );

  const route = councilReasons.length
    ? "council_required"
    : (localColdAllowed || localRoutineAllowed)
      ? "runner_local"
      : "runner_review_first";

  return {
    ok: true,
    route,
    category,
    urgency,
    restricted,
    owner,
    temperature,
    mail_label: mailLabel,
    execution: {
      sender: "runner",
      communicator: "runner",
      email_sender: "runner",
      whatsapp_sender: "runner",
      crm_writer: "runner",
      hard_analysis: route === "council_required" ? "council" : "runner"
    },
    policy: {
      runner_may_send_without_council: route === "runner_local" && mailLabel === "cold_mail" && hasVerifiedContact && publicEvidence,
      runner_may_reply_without_council: route === "runner_local" && ["simple_chat", "daily_communications", "mail_labeling"].includes(category),
      council_may_send: false,
      council_prepares_only: true,
      owner_approval_required: route === "council_required" || restricted || temperature >= 45 || mailLabel === "warm_mail" || mailLabel === "hot_mail"
    },
    reasons: councilReasons.length ? councilReasons : ["low_temperature_or_routine_runner_work"],
    next_step: route === "council_required"
      ? "Send compact evidence packet to council. runner executes only after council returns a recommendation and owner/policy allows it."
      : route === "runner_local"
        ? "Handle locally on runner. Do not call council."
        : "Ask owner or collect more evidence before council escalation."
  };
}

function inferCategory(text, input = {}) {
  if (contains(text, ["p0", "data leak", "breach", "server down", "billing spike", "active attack"])) return "incident_watchdog";
  if (contains(text, ["weekly board brief", "board brief"])) return "weekly_board_brief";
  if (contains(text, ["morning brief", "daily executive brief", "strategic daily plan"])) return "morning_brief";
  if (contains(text, ["mail triage", "email triage", "inbox triage"])) return "mail_triage";
  if (contains(text, ["approval queue", "pending approval", "blocked sends"])) return "approval_queue";
  if (contains(text, ["deal desk", "deal room", "high value deal"])) return "deal_desk";
  if (contains(text, ["legal finance sentinel", "legal and finance sentinel", "risk sentinel"])) return "legal_finance_sentinel";
  if (contains(text, ["deep legal scan"])) return "deep_legal_scan";
  if (contains(text, ["deep accounting scan"])) return "deep_accounting_scan";
  if (contains(text, ["deep risk synthesis"])) return "deep_risk_synthesis";
  if (contains(text, ["document vault", "document index", "missing documents"])) return "document_vault";
  if (input.email || contains(text, ["classify email", "mail label", "newsletter", "unsubscribe"])) return "mail_labeling";
  if (contains(text, ["cold email", "cold mail", "prospection", "campaign", "outreach"])) return "cold_email_campaign";
  if (contains(text, ["hot lead", "interested", "pricing", "devis", "demo", "sign this week"])) return "sales_reply";
  if (contains(text, ["crm", "pipeline", "follow-up", "follow up", "lead stage"])) return "crm_pipeline";
  if (contains(text, ["invoice", "receipt", "bank transaction", "qonto"])) return "invoice_reconciliation";
  if (contains(text, ["legal", "accounting", "fiscal", "tax", "urssaf", "dsn", "statuts"])) return "legal_accounting";
  if (contains(text, ["vercel", "railway", "council", "runner", "deploy", "uptime", "security"])) return "cto_audit";
  if (contains(text, ["whatsapp", "telegram", "customer asks", "client asks"])) return "daily_communications";
  return "simple_chat";
}

function inferUrgency(text) {
  if (/\bp0\b|urgent today|data leak|breach|server down|active attack/.test(text)) return "P0";
  if (/\bp1\b|deadline|this week|client waiting|blocked|important/.test(text)) return "P1";
  if (/\bp2\b|missing|unclear|monitor|verify/.test(text)) return "P2";
  return "P3";
}

function inferTemperature(text, input, restricted, urgency) {
  let score = 10;
  if (input.hot === true) score = Math.max(score, 85);
  if (input.cold === true) score = Math.min(score, 25);
  if (restricted) score += 40;
  if (urgency === "P0") score += 50;
  else if (urgency === "P1") score += 30;
  if (contains(text, ["interested", "intéressé", "demo", "pricing", "price", "devis", "proposal", "sign", "contract", "rendez-vous", "meeting"])) score += 55;
  if (contains(text, ["reply", "replied", "suite à", "as discussed", "following our"])) score += 25;
  if (contains(text, ["newsletter", "unsubscribe", "promo", "sale"])) score = Math.min(score, 15);
  return Math.max(0, Math.min(100, score));
}

function inferMailLabel(text, input, restricted, temperature) {
  if (restricted) return "restricted_internal";
  if (contains(text, ["newsletter", "unsubscribe", "promo", "lottery", "casino", "viagra"])) return "spam";
  if (input.hot === true || temperature >= 70) return "hot_mail";
  if (temperature >= 45) return "warm_mail";
  if (input.email || contains(text, ["email", "mail", "prospection", "cold"])) return "cold_mail";
  return "none";
}

let raw = "";
process.stdin.on("data", (chunk) => raw += chunk);
process.stdin.on("end", () => {
  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: `BAD_JSON: ${error.message}` }, null, 2));
    process.exit(0);
  }
  console.log(JSON.stringify(classify(input), null, 2));
});
