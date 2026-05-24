"use strict";

const { buildCompanySignals } = require("../signals/company_signal_engine");
const { workersForCategory } = require("../config/worker_architecture");

function clean(value, fallback = "") {
  return String(value || fallback).trim();
}

function first(values = [], fallback = null) {
  return Array.isArray(values) && values.length ? values[0] : fallback;
}

function normalizeLead(input = {}, signals = {}) {
  const source = input.lead || input.prospect || input.company || {};
  const entities = signals.entities || {};
  const name = clean(source.name || source.company || input.companyName || input.name, "Unknown prospect");
  const website = clean(source.website || first(entities.websites), "");
  const email = clean(source.email || first(entities.emails), "");
  const phone = clean(source.phone || first(entities.phones), "");
  const sector = clean(source.sector || signals.sector, "unknown");
  const location = clean(source.location || input.location, "");
  const need = clean(source.need || input.need || (signals.painPoints || []).join(", "), "needs discovery");

  return {
    name,
    website,
    email,
    phone,
    sector,
    location,
    need,
    source: clean(input.source || source.source || "openclaw"),
    owner: Boolean(input.owner)
  };
}

function bestOffer(signals = {}) {
  const pains = signals.painPoints || [];
  if (pains.includes("communication_overload")) return "AI assistant + inbox/WhatsApp automation";
  if (pains.includes("lead_generation")) return "B2B funnel, lead scoring, and conversion automation";
  if (pains.includes("appointment_automation")) return "Booking, CRM, and follow-up automation";
  if (pains.includes("digital_presence")) return "Conversion-focused website and acquisition funnel";
  if (pains.includes("mvp_launch")) return "MVP launch sprint and AI-assisted product build";
  return "AI/business automation discovery sprint";
}

function classifyMail(request = {}, lead = {}, signals = {}) {
  const email = request.email || {};
  const text = [
    request.prompt,
    email.subject,
    email.from,
    email.to,
    email.body,
    request.message,
    request.notes
  ].filter(Boolean).join("\n").toLowerCase();

  const hasLead = lead.email || lead.website || lead.name !== "Unknown prospect";
  const sector = lead.sector || signals.sector || "unknown";
  const hasPriorThread = Boolean(email.threadId || email.inReplyTo || request.previousConversation || request.threadSummary);
  const isOutbound = request.direction === "outbound" || request.channel === "openclaw" || /send|campaign|outreach|cold/.test(text);
  const coldEvidence = isOutbound && hasLead && !hasPriorThread;
  const concretePain = (signals.painPoints || []).some((point) => [
    "manual_operations",
    "appointment_automation",
    "lead_generation",
    "mvp_launch"
  ].includes(point));
  const needValue = clean(lead.need).toLowerCase();
  const genericNeedOnly = !needValue || needValue.split(/\s*,\s*/).every((part) => [
    "needs discovery",
    "needs_discovery",
    "communication_overload",
    "digital_presence"
  ].includes(part));
  const professionalRelevance = Boolean(
    sector !== "unknown" ||
      concretePain ||
      !genericNeedOnly
  );

  let temperature = 10;
  if (coldEvidence) temperature += 10;
  if (hasPriorThread) temperature += 20;
  if (/interested|intéressé|rendez-vous|meeting|call|demo|budget|proposal|devis|price|pricing|contract|sign|urgent|asap|today|client|invoice|payment/.test(text)) temperature += 55;
  if (/reply|replied|in reply|following our|suite à|comme convenu|merci pour votre retour/.test(text)) temperature += 25;
  if (signals.restricted) temperature += 50;
  if (request.hot === true || email.hot === true) temperature = Math.max(temperature, 85);
  if (request.cold === true || email.cold === true) temperature = Math.min(temperature, 25);
  temperature = Math.max(0, Math.min(100, temperature));

  let label = "cold_mail";
  if (signals.restricted) label = "restricted_internal";
  else if (/unsubscribe|casino|crypto|loan|viagra|winner|lottery|spam/.test(text)) label = "spam";
  else if (temperature >= 70) label = "hot_mail";
  else if (temperature >= 35 || hasPriorThread) label = "warm_mail";
  else if (!lead.email && !hasLead) label = "unknown_mail";

  const compliancePass = Boolean(
    label === "cold_mail" &&
    lead.email &&
    (lead.website || signals.entities?.websites?.length) &&
    professionalRelevance &&
    !signals.restricted
  );

  const confidence = label === "cold_mail" && compliancePass ? 0.86 : label === "hot_mail" || label === "restricted_internal" ? 0.82 : 0.68;
  const approvalRequired = label !== "cold_mail" || !compliancePass || confidence < 0.75;
  const autoSendAllowed = label === "cold_mail" && compliancePass && !approvalRequired;

  return {
    label,
    temperature_score: temperature,
    confidence,
    approval_required: approvalRequired,
    auto_send_allowed: autoSendAllowed,
    automation_mode: autoSendAllowed ? "auto_send" : "owner_approval",
    reasons: [
      coldEvidence ? "no prior thread and outbound/prospecting context" : null,
      hasPriorThread ? "prior conversation/thread detected" : null,
      signals.restricted ? "restricted/internal topic detected" : null,
      !lead.email ? "missing verified recipient email" : null,
      compliancePass ? "cold B2B compliance precheck passed" : null
    ].filter(Boolean),
    compliance: {
      pass: compliancePass,
      requires_public_business_contact: true,
      requires_professional_relevance: true,
      professional_relevance_pass: professionalRelevance,
      requires_opt_out: true,
      blocks_sensitive_or_internal_data: true
    }
  };
}

function buildColdEmailDraft(lead, signals, mailPolicy = null) {
  const language = signals.language === "en" ? "en" : "fr";
  const offer = bestOffer(signals);
  const subject = language === "en"
    ? `Quick idea for ${lead.name}`
    : `Idée rapide pour ${lead.name}`;

  const body = language === "en"
    ? [
        `Hello,`,
        ``,
        `I am contacting you from AZZ&CO LABS after reviewing ${lead.website || "your public presence"}.`,
        `We help small teams save time and convert more opportunities with practical AI, automation, CRM, and funnel systems.`,
        ``,
        `For ${lead.name}, the most relevant starting point seems to be: ${offer}.`,
        `Would a short 15-minute call this week be useful to see if there is a concrete fit?`,
        ``,
        `If this is not relevant, just reply "no" and I will not follow up.`,
        ``,
        `Best regards,`,
        `AZZ&CO LABS`
      ].join("\n")
    : [
        `Bonjour,`,
        ``,
        `Je me permets de vous contacter depuis AZZ&CO LABS après avoir consulté ${lead.website || "vos informations publiques"}.`,
        `Nous aidons les petites équipes à gagner du temps et à convertir davantage d'opportunités avec des systèmes IA, automatisation, CRM et tunnels de conversion.`,
        ``,
        `Pour ${lead.name}, le point de départ le plus pertinent semble être : ${offer}.`,
        `Seriez-vous ouvert à un échange de 15 minutes cette semaine pour voir s'il y a un intérêt concret ?`,
        ``,
        `Si ce n'est pas pertinent, répondez simplement "non" et je ne relancerai pas.`,
        ``,
        `Cordialement,`,
        `AZZ&CO LABS`
      ].join("\n");

  return {
    language,
    subject,
    body,
    compliance: {
      draft_only: !mailPolicy?.auto_send_allowed,
      requires_owner_approval: Boolean(mailPolicy?.approval_required ?? true),
      contains_opt_out: true,
      no_fake_claims: true,
      source: "publicly visible lead context only"
    }
  };
}

function buildCrmUpdate(lead, signals, route) {
  const stage = signals.azzing.decision === "strong_pick" ? "qualified_draft_ready" : "research_needed";
  const nextAction = lead.email
    ? "Owner review: approve exact email draft before OpenClaw sends."
    : "Find public business email or use contact form; do not guess an address.";

  return {
    lead_id_hint: lead.website || lead.email || lead.name,
    stage,
    priority: route.urgency === "P0" || route.urgency === "P1" ? "high" : signals.azzing.decision === "strong_pick" ? "medium" : "low",
    tags: ["azzco", route.category, lead.sector, ...signals.painPoints].filter(Boolean),
    fields: {
      company: lead.name,
      website: lead.website || null,
      email: lead.email || null,
      phone: lead.phone || null,
      location: lead.location || null,
      need_est: lead.need,
      best_offer_est: bestOffer(signals),
      azzing_score: signals.azzing
    },
    next_action: nextAction,
    follow_up: {
      owner_review_due: "next available work block",
      prospect_followup_after_send_days: 4
    }
  };
}

function buildOpenClawHandoff({ route, lead, signals, draft, crmUpdate, mailPolicy }) {
  const canSend = Boolean(lead.email) && Boolean(mailPolicy?.auto_send_allowed);
  const approvalRequired = Boolean(mailPolicy?.approval_required || route.requireOwnerApproval);
  const emailAction = mailPolicy?.label === "hot_mail" ? "request_hot_mail_approval" : "send_cold_email";
  return {
    target_system: "openclaw",
    channel_actions: [
      {
        channel: "owner_whatsapp",
        action: mailPolicy?.label === "hot_mail" ? "request_hot_mail_approval" : "send_owner_brief",
        allowed: true,
        payload: {
          title: mailPolicy?.label === "hot_mail" ? "Hot mail requires approval" : "Lead prepared for review",
          company: lead.name,
          mail_label: mailPolicy?.label || "unlabeled",
          score: signals.azzing,
          next_action: crmUpdate.next_action
        }
      },
      {
        channel: "email",
        action: emailAction,
        allowed: canSend,
        approval_required: approvalRequired,
        blocked_reason: canSend ? null : (mailPolicy?.label === "hot_mail"
          ? "Hot mail requires owner approval before sending."
          : mailPolicy?.label === "cold_mail"
            ? "Cold mail automation blocked because compliance/confidence precheck failed."
            : "Only cold_mail can auto-send; warm/hot/restricted mail requires owner approval."),
        payload: {
          to: lead.email || null,
          subject: draft.subject,
          body: draft.body,
          mail_label: mailPolicy?.label || "unlabeled",
          temperature_score: mailPolicy?.temperature_score ?? null
        }
      },
      {
        channel: "crm",
        action: "upsert_lead",
        allowed: true,
        payload: crmUpdate
      }
    ],
    idempotency_key: `${route.category}:${lead.website || lead.email || lead.name}`.toLowerCase().replace(/\s+/g, "-"),
    safety: {
      expose_confidential_docs: false,
      send_without_owner_approval: canSend,
      owner_only_if_restricted: signals.restricted
    }
  };
}

function buildLeadWorkflow({ request, route }) {
  const signals = buildCompanySignals(request, route);
  const lead = normalizeLead(request, signals);
  const mailPolicy = classifyMail(request, lead, signals);
  const draft = buildColdEmailDraft(lead, signals, mailPolicy);
  const crmUpdate = buildCrmUpdate(lead, signals, route);

  return {
    kind: "company_work_packet",
    workflow: route.category,
    signals,
    kitchen_workers: workersForCategory(route.category),
    mail_policy: mailPolicy,
    lead,
    offer: bestOffer(signals),
    crm_update: crmUpdate,
    cold_email_draft: draft,
    openclaw_handoff: buildOpenClawHandoff({ route, lead, signals, draft, crmUpdate, mailPolicy })
  };
}

function buildCommunicationWorkflow({ request, route }) {
  const signals = buildCompanySignals(request, route);
  const sender = clean(request.sender || request.from || "unknown");
  const owner = Boolean(request.owner);
  const restricted = signals.restricted;
  const promptText = [request.prompt, request.message, request.notes].filter(Boolean).join("\n").toLowerCase();
  const requested = request.requested_action || {};
  const targetPhone = clean(requested.to || first(signals.entities?.phones || []), "");
  const wantsWhatsappSend = Boolean(
    requested.channel === "whatsapp" ||
      (targetPhone && /whatsapp|text|send|message|sms/.test(promptText))
  );
  const commitmentRisk = Boolean(restricted || /price|pricing|devis|contract|sign|refund|payment|legal|tax|appointment|rendez-vous/.test(promptText));
  const action = !owner && restricted
    ? "refuse_and_escalate_owner"
    : wantsWhatsappSend
      ? owner
        ? "owner_authorized_whatsapp_send"
        : "reject_non_owner_outbound"
      : "reply_or_summarize";

  const channelActions = [
    {
      channel: request.channel || "whatsapp",
      action: action === "reply_or_summarize" ? "reply" : action === "refuse_and_escalate_owner" ? "refuse" : "acknowledge",
      allowed: action === "reply_or_summarize" || action === "refuse_and_escalate_owner",
      blocked_reason: action === "reject_non_owner_outbound" ? "Non-owner users cannot command outbound WhatsApp messages." : null
    },
    {
      channel: "owner_whatsapp",
      action: "notify_owner",
      allowed: restricted && !owner,
      payload: {
        sender,
        urgency: signals.urgency,
        risk: "non-owner requested restricted company information"
      }
    }
  ];

  if (wantsWhatsappSend) {
    channelActions.push({
      channel: "whatsapp",
      action: "send_message",
      allowed: Boolean(owner && targetPhone && !commitmentRisk),
      approval_required: Boolean(commitmentRisk),
      blocked_reason: !owner
        ? "Non-owner users cannot command outbound WhatsApp messages."
        : !targetPhone
          ? "Missing E.164 target phone number."
          : commitmentRisk
            ? "Message may create legal, financial, pricing, appointment, or restricted commitment; owner approval/clarification required."
            : null,
      payload: {
        to: targetPhone || null,
        message: clean(requested.message || request.message || request.prompt, "").slice(0, 1000),
        source: "owner_authorized_whatsapp"
      }
    });
  }

  return {
    kind: "communication_work_packet",
    workflow: route.category,
    signals,
    kitchen_workers: workersForCategory(route.category),
    inbound: {
      sender,
      channel: request.channel || "unknown",
      owner,
      restricted
    },
    recommended_action: action,
    response_policy: {
      can_answer_directly: !(restricted && !owner),
      owner_escalation_required: restricted && !owner,
      refusal_text: "I cannot share AZZ&CO LABS internal, legal, accounting, or confidential information here. Please contact Azer Rached directly for authorization."
    },
    openclaw_handoff: {
      target_system: "openclaw",
      channel_actions: channelActions
    }
  };
}

function buildWorkflow({ request, route }) {
  if (["lead_scout", "cold_email_campaign", "crm_pipeline", "sales_reply"].includes(route.category)) {
    return buildLeadWorkflow({ request, route });
  }
  if (route.category === "mail_labeling") {
    return buildLeadWorkflow({ request, route });
  }
  if (["daily_communications", "productivity_ops"].includes(route.category)) {
    return buildCommunicationWorkflow({ request, route });
  }
  return {
    kind: "generic_work_packet",
    workflow: route.category,
    signals: buildCompanySignals(request, route),
    openclaw_handoff: {
      target_system: "openclaw",
      channel_actions: []
    }
  };
}

module.exports = {
  buildWorkflow,
  buildLeadWorkflow,
  buildCommunicationWorkflow,
  classifyMail
};
