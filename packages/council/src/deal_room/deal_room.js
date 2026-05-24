"use strict";

const DEAL_ROOM_THRESHOLD = 82;
const OWNER_PASS_THRESHOLD = 92;

const DEAL_ROOM_CATEGORIES = new Set([
  "lead_scout",
  "crm_pipeline",
  "cold_email_campaign",
  "sales_reply",
  "mail_labeling"
]);

function textOf(request = {}) {
  return [
    request.prompt,
    request.message,
    request.notes,
    request.email?.subject,
    request.email?.body,
    request.threadSummary
  ].filter(Boolean).join("\n").toLowerCase();
}

function hasAny(text, words) {
  return words.some((word) => text.includes(word));
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function leadEvidenceScore(workflow = {}) {
  const lead = workflow.lead || {};
  let score = 0;
  if (lead.name && lead.name !== "Unknown prospect") score += 8;
  if (lead.website) score += 10;
  if (lead.email) score += 12;
  if (lead.sector && lead.sector !== "unknown") score += 5;
  if (lead.location) score += 3;
  return score;
}

function computeDealScore({ request = {}, route = {}, workflow = {} } = {}) {
  if (!DEAL_ROOM_CATEGORIES.has(route.category)) return 0;

  const mail = workflow.mail_policy || {};
  const signals = workflow.signals || {};
  const text = textOf(request);
  let score = Number(mail.temperature_score || 0);

  score += leadEvidenceScore(workflow);

  if (mail.label === "hot_mail") score = Math.max(score, 88);
  if (mail.label === "warm_mail") score = Math.max(score, 58);
  if (mail.label === "cold_mail" && mail.auto_send_allowed) score = Math.max(score, 36);

  if (signals.azzing?.decision === "strong_pick") score += 7;
  if (signals.azzing?.decision === "maybe") score += 3;
  if (signals.azzing?.decision === "reject") score -= 30;

  if (hasAny(text, ["budget", "pricing", "price", "devis", "proposal", "proposition"])) score += 8;
  if (hasAny(text, ["contract", "sign", "signature", "terms", "conditions"])) score += 10;
  if (hasAny(text, ["meeting", "call", "demo", "rendez-vous", "rdv"])) score += 8;
  if (hasAny(text, ["urgent", "today", "this week", "asap", "deadline"])) score += 7;
  if (hasAny(text, ["decision maker", "founder", "ceo", "owner", "directeur", "dirigeant"])) score += 5;

  if (route.restricted || signals.restricted) score -= 10;
  return clamp(score);
}

function missingInputs({ request = {}, workflow = {} } = {}) {
  const text = textOf(request);
  const lead = workflow.lead || {};
  const missing = [];

  if (!lead.email) missing.push("verified recipient email");
  if (!lead.website) missing.push("public website or public source");
  if (!hasAny(text, ["budget", "pricing", "price", "devis"])) missing.push("budget or pricing context");
  if (!hasAny(text, ["timeline", "this week", "deadline", "urgent", "today", "month"])) missing.push("timeline");
  if (!hasAny(text, ["decision maker", "founder", "ceo", "owner", "directeur", "dirigeant"])) missing.push("decision-maker authority");
  if (!workflow.crm_update?.fields?.need_est || workflow.crm_update.fields.need_est === "needs discovery") missing.push("specific business pain");

  return [...new Set(missing)];
}

function teamBriefs({ workflow = {}, score = 0 } = {}) {
  const lead = workflow.lead || {};
  const mail = workflow.mail_policy || {};
  return [
    {
      office: "crm_sales",
      brief: `Lead ${lead.name || "unknown"} is ${mail.label || "unlabeled"} at ${score}/100. Prepare next-step sales angle and CRM stage.`
    },
    {
      office: "compliance_privacy",
      brief: "Verify opt-out, truthful identity, public-contact basis, suppression list, and no fake claims."
    },
    {
      office: "finance",
      brief: "Flag pricing/budget ambiguity and avoid binding commercial terms without owner approval."
    },
    {
      office: "legal",
      brief: "Check for contract, signature, liability, confidentiality, and commitment language."
    },
    {
      office: "memory_records",
      brief: "Attach prior thread, approvals, CRM history, and source evidence before escalation."
    },
    {
      office: "quality_council",
      brief: "Harden the final owner brief: facts, assumptions, risks, next ask, and confidence."
    }
  ];
}

function evaluateDealRoom({ request = {}, route = {}, workflow = {}, budget = {} } = {}) {
  const score = computeDealScore({ request, route, workflow });
  const active = score >= DEAL_ROOM_THRESHOLD;
  const missing = missingInputs({ request, workflow });
  const confidence = clamp(score - missing.length * 4) / 100;

  return {
    active,
    crm_temperature: score >= 82 ? "hot" : score >= 55 ? "warm" : "cold",
    score,
    threshold: DEAL_ROOM_THRESHOLD,
    owner_pass_threshold: OWNER_PASS_THRESHOLD,
    confidence_estimate: Number(confidence.toFixed(2)),
    decision: active
      ? (score >= OWNER_PASS_THRESHOLD && missing.length <= 1 ? "owner_brief_ready" : "deal_room_required")
      : "standard_pipeline",
    captain: active ? {
      role: "deal_captain",
      modelAlias: "premium-judge",
      model: "together/moonshotai/Kimi-K2.5",
      purpose: "Synthesize the team briefs, sharpen the deal strategy, and decide what to ask the owner.",
      execution_mode: process.env.AZZCO_SYNC_DEAL_CAPTAIN === "1" ? "sync" : "async_recommended"
    } : null,
    team_briefs: active ? teamBriefs({ workflow, score }) : [],
    required_inputs: missing,
    budget_mode: budget.mode || "normal",
    async_premium_recommended: active && process.env.AZZCO_SYNC_DEAL_CAPTAIN !== "1",
    owner_approval_required: active,
    external_send_allowed: !active && workflow.mail_policy?.auto_send_allowed === true
  };
}

module.exports = {
  DEAL_ROOM_THRESHOLD,
  OWNER_PASS_THRESHOLD,
  evaluateDealRoom,
  computeDealScore
};
