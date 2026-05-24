"use strict";

const { HIGH_RISK_CATEGORIES, LOCAL_CATEGORIES, RESTRICTED_TERMS, COMMITMENT_TERMS } = require("./taskTypes");
const { contains, textOf, hasEmail } = require("./text");

function inferCategory(text, input = {}) {
  // Incident check must be unconditional and first
  if (contains(text, ["p0", "data leak", "breach", "server down", "active attack"])) return "incident_watchdog";
  // High-value content checks before general email shortcut so an email about invoices
  // or legal matters routes to the correct high-risk category
  if (contains(text, ["invoice", "receipt", "bank transaction", "bank"])) return "invoice_reconciliation";
  if (contains(text, ["legal", "accounting", "fiscal", "tax", "urssaf", "dsn", "statuts"])) return "legal_accounting";
  if (contains(text, ["vercel", "railway", "council", "runner", "deploy", "uptime", "security"])) return "cto_audit";
  // Generic email labeling — only when the request is explicitly about labeling/classifying
  if (contains(text, ["classify email", "mail label", "newsletter", "unsubscribe"])) return "mail_labeling";
  if (contains(text, ["cold email", "cold mail", "prospection", "campaign", "outreach"])) return "cold_email_campaign";
  if (contains(text, ["hot lead", "interested", "pricing", "devis", "demo", "sign this week"])) return "sales_reply";
  if (contains(text, ["crm", "pipeline", "follow-up", "follow up", "lead stage"])) return "crm_pipeline";
  if (contains(text, ["whatsapp", "telegram", "customer asks", "client asks"])) return "daily_communications";
  // Fall back to mail_labeling only when an email object is present and nothing matched above
  if (input.email) return "mail_labeling";
  return "simple_chat";
}

function inferUrgency(text) {
  if (/\bp0\b|urgent today|data leak|breach|server down|active attack/.test(text)) return "P0";
  if (/\bp1\b|deadline|this week|client waiting|blocked|important/.test(text)) return "P1";
  if (/\bp2\b|missing|unclear|monitor|verify/.test(text)) return "P2";
  return "P3";
}

function hasCommitmentRisk(text) {
  const sanitized = text
    .replace(/\b(no|without)\s+(price|pricing|devis|proposal|sign(?:ature)?|refund|appointment|rendez-vous|guarantee|commitment|contract)s?\b/g, "")
    .replace(/\bsans\s+(prix|devis|proposition|signature|remboursement|rendez-vous|garantie|engagement|contrat)s?\b/g, "");
  if (contains(sanitized, COMMITMENT_TERMS)) return true;
  return contains(sanitized, ["commitment", "contract"]);
}

function inferTemperature(text, input, restricted, urgency) {
  let score = 10;
  if (input.hot === true) score = Math.max(score, 85);
  if (input.cold === true) score = Math.min(score, 25);
  if (restricted) score += 40;
  if (urgency === "P0") score += 50;
  else if (urgency === "P1") score += 30;
  if (contains(text, ["interested", "interesse", "intéressé", "demo", "pricing", "price", "devis", "proposal", "sign", "contract", "rendez-vous", "meeting"])) score += 55;
  if (contains(text, ["reply", "replied", "suite a", "suite à", "as discussed", "following our"])) score += 25;
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

function classify(input = {}) {
  const text = textOf(input);
  const owner = input.owner !== false;
  const category = input.category || inferCategory(text, input);
  const restricted = Boolean(input.restricted || contains(text, RESTRICTED_TERMS));
  const urgency = input.urgency || inferUrgency(text);
  const temperature = input.temperature == null ? inferTemperature(text, input, restricted, urgency) : Number(input.temperature);
  const mailLabel = input.mail_label || inferMailLabel(text, input, restricted, temperature);
  const hasVerifiedContact = Boolean((input.lead && input.lead.email) || (input.email && input.email.from) || hasEmail(text));
  const publicEvidence = Boolean((input.lead && input.lead.website) || contains(text, ["public website", "public source", "website:", "https://", "www."]));

  const councilReasons = [];
  if (!owner && restricted) councilReasons.push("non_owner_restricted");
  if (restricted) councilReasons.push("restricted_legal_accounting_or_internal");
  if (urgency === "P0" || urgency === "P1") councilReasons.push(`urgency_${urgency}`);
  if (temperature >= 70 || mailLabel === "hot_mail") councilReasons.push("hot_temperature");
  if (mailLabel === "warm_mail" && temperature >= 45) councilReasons.push("warm_requires_quality_review");
  if (HIGH_RISK_CATEGORIES.has(category)) councilReasons.push(`category_${category}`);
  if (hasCommitmentRisk(text)) councilReasons.push("commitment_or_reputation_risk");
  if (contains(text, ["ambiguous", "unclear", "missing evidence", "not sure", "unknown_mail"])) councilReasons.push("ambiguous_or_missing_evidence");

  const localColdAllowed = Boolean(
    owner &&
    !restricted &&
    urgency === "P3" &&
    (mailLabel === "cold_mail" || mailLabel === "spam" || mailLabel === "none") &&
    temperature < 45 &&
    (mailLabel !== "cold_mail" || (hasVerifiedContact && publicEvidence))
  );

  const localRoutineAllowed = Boolean(!restricted && urgency === "P3" && temperature < 45 && LOCAL_CATEGORIES.has(category));
  const route = councilReasons.length ? "council_required" : (localColdAllowed || localRoutineAllowed) ? "runner_local" : "runner_review_first";

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
      ? "Send compact evidence packet to council. Runner executes only after council returns a recommendation and owner/policy allows it."
      : route === "runner_local"
        ? "Handle locally on runner. Do not call council."
        : "Ask owner or collect more evidence before council escalation."
  };
}

module.exports = { classify, inferCategory, inferUrgency, inferMailLabel, inferTemperature, hasCommitmentRisk };
