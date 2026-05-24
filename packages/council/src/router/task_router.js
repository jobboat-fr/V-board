"use strict";

const { TASK_MATRIX } = require("../config/task_matrix");

function containsAny(text, words) {
  const lower = String(text || "").toLowerCase();
  return words.some((word) => lower.includes(word));
}

class TaskRouter {
  classify(request = {}) {
    const prompt = request.prompt || "";
    const category = request.category || this.inferCategory(prompt, request);
    const urgency = request.urgency || this.inferUrgency(prompt);
    const restricted = Boolean(
      request.restricted ||
        TASK_MATRIX[category]?.restricted ||
        containsAny(prompt, ["bank", "invoice", "legal", "tax", "urssaf", "dsn", "statuts", "payroll", "confidential", "internal document"])
    );
    const spec = TASK_MATRIX[category] || TASK_MATRIX.simple_chat;

    return {
      category,
      urgency,
      restricted,
      spec,
      requireCouncil: spec.council.length > 1 || urgency === "P0" || urgency === "P1" || restricted,
      requireOwnerApproval: Boolean(spec.ownerApproval || restricted || urgency === "P0")
    };
  }

  inferCategory(prompt, request = {}) {
    const email = request.email || {};
    const emailText = [
      prompt,
      email.subject,
      email.body,
      email.from,
      request.threadSummary
    ].filter(Boolean).join("\n");

    if (containsAny(emailText, [
      "p0", "urgent today", "breach", "data leak", "server down", "gateway down", "billing spike",
      "runaway cost", "critical incident", "active attack", "exposed secret", "bridge broken"
    ])) return "incident_watchdog";
    if (request.owner === false && (request.sender || request.from || request.channel)) return "daily_communications";
    if (containsAny(prompt, ["weekly board brief", "board brief"])) return "weekly_board_brief";
    if (containsAny(prompt, ["morning brief", "daily executive brief", "strategic daily plan"])) return "morning_brief";
    if (containsAny(prompt, ["mail triage", "email triage", "inbox triage"])) return "mail_triage";
    if (containsAny(prompt, ["approval queue", "pending approval", "blocked sends"])) return "approval_queue";
    if (containsAny(prompt, ["deal desk", "deal room", "high value deal"])) return "deal_desk";
    if (containsAny(prompt, ["legal finance sentinel", "legal and finance sentinel", "risk sentinel"])) return "legal_finance_sentinel";
    if (containsAny(prompt, ["deep legal scan"])) return "deep_legal_scan";
    if (containsAny(prompt, ["deep accounting scan"])) return "deep_accounting_scan";
    if (containsAny(prompt, ["deep risk synthesis"])) return "deep_risk_synthesis";
    if (containsAny(prompt, ["document vault", "document index", "missing company documents"])) return "document_vault";
    if (request.email && containsAny(emailText, [
      "hot email", "interested", "intéressé", "pricing", "price", "devis", "proposal", "contract", "sign",
      "budget", "demo", "meeting", "call", "rendez-vous", "may sign", "client waiting", "negotiate"
    ])) return "sales_reply";
    if (request.email || containsAny(prompt, ["mail label", "label this email", "categorize this email", "classify this email"])) return "mail_labeling";
    if (containsAny(prompt, ["cold email", "cold mail", "campaign", "outreach sequence", "send mail", "email draft"])) return "cold_email_campaign";
    if (containsAny(prompt, ["crm", "pipeline", "lead stage", "follow up", "follow-up", "prospect record"])) return "crm_pipeline";
    if (containsAny(prompt, ["reply to", "respond to", "client asked", "prospect asked", "negotiation", "objection"])) return "sales_reply";
    if (containsAny(prompt, ["daily communication", "whatsapp message", "telegram message", "inbox"])) return "daily_communications";
    if (containsAny(prompt, ["todo", "productivity", "prioritize", "daily plan", "remind", "schedule"])) return "productivity_ops";
    if (containsAny(prompt, ["late night meeting", "owner decision", "decision meeting", "approve today", "open loops"])) return "owner_decision_meeting";
    if (containsAny(prompt, ["gdpr", "cnil", "privacy", "unsubscribe", "opt-out", "suppression list", "data protection"])) return "compliance_privacy";
    if (containsAny(prompt, ["customer success", "client onboarding", "retention", "renewal", "satisfaction", "client follow-up"])) return "customer_success";
    if (containsAny(prompt, ["roadmap", "feature", "bug", "sprint", "project delivery", "product backlog"])) return "product_project_ops";
    if (containsAny(prompt, ["vendor", "supplier", "saas renewal", "subscription renewal", "cancel subscription", "procurement"])) return "vendor_ops";
    if (containsAny(prompt, ["metrics", "kpi", "conversion rate", "pipeline report", "revenue report", "spend report"])) return "bi_metrics";
    if (containsAny(prompt, ["invoice", "receipt", "bank statement", "transaction", "expense"])) return "invoice_reconciliation";
    if (containsAny(prompt, ["legal", "accounting", "fiscal", "social", "tax", "urssaf", "dsn", "statuts", "review contract", "contract review"])) return "legal_accounting";
    if (containsAny(prompt, ["vercel", "railway", "deploy", "outage", "security", "server"])) return "cto_audit";
    if (containsAny(prompt, ["lead", "prospect", "cold email", "business offer", "scout"])) return "lead_scout";
    if (containsAny(prompt, ["urgent", "p0", "breach", "leak", "down", "billing spike"])) return "incident_watchdog";
    return "simple_chat";
  }

  inferUrgency(prompt) {
    const text = String(prompt || "").toLowerCase();
    if (/\bp0\b|urgent today|breach|data leak|payment deadline|server down/.test(text)) return "P0";
    if (/\bp1\b|this week|important|deadline|risk/.test(text)) return "P1";
    if (/\bp2\b|monitor|unclear|missing/.test(text)) return "P2";
    return "P3";
  }
}

module.exports = { TaskRouter };
