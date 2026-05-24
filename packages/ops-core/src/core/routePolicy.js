"use strict";

const { HIGH_RISK_CATEGORIES, LOCAL_CATEGORIES, RESTRICTED_TERMS, COMMITMENT_TERMS } = require("./taskTypes");
const { contains, textOf, hasEmail } = require("./text");

function inferCategory(text, input = {}) {
  // Incident check must be unconditional and first
  if (contains(text, ["p0", "data leak", "breach", "server down", "active attack"])) return "incident_watchdog";
  // High-value content checks before general email shortcut so an email about invoices
  // or legal matters routes to the correct high-risk category
  if (contains(text, ["invoice", "receipt", "bank transaction", "qonto"])) return "invoice_reconciliation";
  if (contains(text, ["legal", "accounting", "fiscal", "tax", "urssaf", "dsn", "statuts"])) return "legal_accounting";
  if (contains(text, ["vercel", "railway", "ovh", "hostinger", "deploy", "uptime", "security"])) return "cto_audit";
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

  const ovhReasons = [];
  if (!owner && restricted) ovhReasons.push("non_owner_restricted");
  if (restricted) ovhReasons.push("restricted_legal_accounting_or_internal");
  if (urgency === "P0" || urgency === "P1") ovhReasons.push(`urgency_${urgency}`);
  if (temperature >= 70 || mailLabel === "hot_mail") ovhReasons.push("hot_temperature");
  if (mailLabel === "warm_mail" && temperature >= 45) ovhReasons.push("warm_requires_quality_review");
  if (HIGH_RISK_CATEGORIES.has(category)) ovhReasons.push(`category_${category}`);
  if (hasCommitmentRisk(text)) ovhReasons.push("commitment_or_reputation_risk");
  if (contains(text, ["ambiguous", "unclear", "missing evidence", "not sure", "unknown_mail"])) ovhReasons.push("ambiguous_or_missing_evidence");

  const localColdAllowed = Boolean(
    owner &&
    !restricted &&
    urgency === "P3" &&
    (mailLabel === "cold_mail" || mailLabel === "spam" || mailLabel === "none") &&
    temperature < 45 &&
    (mailLabel !== "cold_mail" || (hasVerifiedContact && publicEvidence))
  );

  const localRoutineAllowed = Boolean(!restricted && urgency === "P3" && temperature < 45 && LOCAL_CATEGORIES.has(category));
  const route = ovhReasons.length ? "ovh_required" : (localColdAllowed || localRoutineAllowed) ? "hostinger_local" : "hostinger_review_first";

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
      sender: "hostinger",
      communicator: "hostinger",
      email_sender: "hostinger",
      whatsapp_sender: "hostinger",
      crm_writer: "hostinger",
      hard_analysis: route === "ovh_required" ? "ovh" : "hostinger"
    },
    policy: {
      hostinger_may_send_without_ovh: route === "hostinger_local" && mailLabel === "cold_mail" && hasVerifiedContact && publicEvidence,
      hostinger_may_reply_without_ovh: route === "hostinger_local" && ["simple_chat", "daily_communications", "mail_labeling"].includes(category),
      ovh_may_send: false,
      ovh_prepares_only: true,
      owner_approval_required: route === "ovh_required" || restricted || temperature >= 45 || mailLabel === "warm_mail" || mailLabel === "hot_mail"
    },
    reasons: ovhReasons.length ? ovhReasons : ["low_temperature_or_routine_hostinger_work"],
    next_step: route === "ovh_required"
      ? "Send compact evidence packet to OVH. Hostinger executes only after OVH returns a recommendation and owner/policy allows it."
      : route === "hostinger_local"
        ? "Handle locally on Hostinger. Do not call OVH."
        : "Ask owner or collect more evidence before OVH escalation."
  };
}

module.exports = { classify, inferCategory, inferUrgency, inferMailLabel, inferTemperature, hasCommitmentRisk };
