"use strict";

const TASK_MATRIX = {
  morning_brief: {
    description: "Owner morning executive brief from Hostinger evidence packets.",
    criticality: "medium",
    defaultModel: "business-workhorse",
    council: ["operations_planner", "crm_analyst", "cto_analyst", "cost_guard", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 12000,
    ownerApproval: false
  },
  mail_triage: {
    description: "Inbox triage synthesis from Hostinger mail collector evidence; labels hot/warm/cold/admin/finance/legal/security and approval gates.",
    criticality: "medium",
    defaultModel: "cheap-default",
    council: ["mail_labeler", "communications_triage", "compliance_guard", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 9000,
    ownerApproval: false
  },
  simple_chat: {
    description: "Short owner/user conversation and lightweight assistance.",
    criticality: "low",
    defaultModel: "cheap-default",
    council: ["responder"],
    judge: "cheap-default",
    maxInputTokens: 2500,
    ownerApproval: false
  },
  lead_scout: {
    description: "Prospect research, lead scoring, cold email drafts.",
    criticality: "medium",
    defaultModel: "business-workhorse",
    council: ["market_analyst", "crm_analyst", "compliance_guard", "outreach_writer", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 12000,
    ownerApproval: true
  },
  crm_pipeline: {
    description: "CRM hygiene, lead stage updates, follow-up planning, and sales pipeline notes.",
    criticality: "medium",
    defaultModel: "cheap-default",
    council: ["crm_analyst", "relationship_manager", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 8000,
    ownerApproval: false
  },
  cold_email_campaign: {
    description: "Prepare and label outbound email packs. Cold mail can auto-send when compliance passes; hot mail requires owner approval.",
    criticality: "high",
    defaultModel: "business-workhorse",
    council: ["mail_labeler", "market_analyst", "crm_analyst", "compliance_guard", "outreach_writer", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 14000,
    ownerApproval: false
  },
  mail_labeling: {
    description: "Label mail temperature and decide automation versus approval.",
    criticality: "medium",
    defaultModel: "cheap-default",
    council: ["mail_labeler", "compliance_guard"],
    judge: "cheap-default",
    maxInputTokens: 4000,
    ownerApproval: false
  },
  daily_communications: {
    description: "Owner communication triage across WhatsApp, Telegram, and email.",
    criticality: "medium",
    defaultModel: "cheap-default",
    council: ["communications_triage", "relationship_manager", "compliance_guard"],
    judge: "cheap-default",
    maxInputTokens: 6000,
    ownerApproval: false
  },
  sales_reply: {
    description: "Prepare owner-safe replies for inbound leads, client questions, and negotiations.",
    criticality: "medium",
    defaultModel: "business-workhorse",
    council: ["relationship_manager", "compliance_guard", "outreach_writer", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 10000,
    ownerApproval: true
  },
  deal_desk: {
    description: "Warm/hot opportunity review, objection handling, deal risk, and owner-ready next action.",
    criticality: "high",
    defaultModel: "business-workhorse",
    council: ["relationship_manager", "crm_analyst", "compliance_guard", "cost_guard", "skeptic"],
    judge: "premium-judge",
    maxInputTokens: 14000,
    ownerApproval: true
  },
  approval_queue: {
    description: "Pending approvals, blocked sends, restricted tasks, and owner decision queue.",
    criticality: "high",
    defaultModel: "business-workhorse",
    council: ["operations_planner", "compliance_guard", "document_verifier", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 12000,
    ownerApproval: true
  },
  productivity_ops: {
    description: "Daily productivity planning, reminders, missing inputs, and operational follow-up.",
    criticality: "low",
    defaultModel: "cheap-default",
    council: ["operations_planner", "skeptic"],
    judge: "cheap-default",
    maxInputTokens: 5000,
    ownerApproval: false
  },
  owner_decision_meeting: {
    description: "Late-night owner decision meeting, open loops, approvals, objections, and execution plan.",
    criticality: "high",
    defaultModel: "business-workhorse",
    council: ["operations_planner", "crm_analyst", "cost_guard", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 12000,
    ownerApproval: true
  },
  weekly_board_brief: {
    description: "Weekly owner board brief across finance, legal, CRM, CTO, operations, and risk.",
    criticality: "high",
    defaultModel: "business-workhorse",
    council: ["operations_planner", "crm_analyst", "accounting_analyst", "legal_analyst", "cto_analyst", "cost_guard", "skeptic"],
    judge: "premium-judge",
    maxInputTokens: 22000,
    ownerApproval: true
  },
  compliance_privacy: {
    description: "Opt-outs, suppression lists, GDPR/CNIL, privacy, and campaign compliance.",
    criticality: "high",
    defaultModel: "cheap-default",
    council: ["compliance_guard", "document_verifier", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 8000,
    ownerApproval: true
  },
  customer_success: {
    description: "Client onboarding, satisfaction, retention, renewal, and service follow-up.",
    criticality: "medium",
    defaultModel: "cheap-default",
    council: ["relationship_manager", "operations_planner", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 9000,
    ownerApproval: false
  },
  product_project_ops: {
    description: "Roadmap, delivery planning, bugs, feature ideas, and project execution.",
    criticality: "medium",
    defaultModel: "cheap-default",
    council: ["operations_planner", "cto_analyst", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 10000,
    ownerApproval: false
  },
  vendor_ops: {
    description: "Supplier contracts, SaaS renewals, cancellations, vendor spend, and vendor risk.",
    criticality: "medium",
    defaultModel: "cheap-default",
    council: ["operations_planner", "cost_guard", "skeptic"],
    judge: "cheap-default",
    maxInputTokens: 8000,
    ownerApproval: false
  },
  bi_metrics: {
    description: "Pipeline, revenue, conversion, cost, model spend, and operating metrics.",
    criticality: "medium",
    defaultModel: "cheap-default",
    council: ["cost_guard", "operations_planner", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 9000,
    ownerApproval: false
  },
  cto_audit: {
    description: "Vercel/Railway/platform operations and engineering risk report.",
    criticality: "high",
    defaultModel: "business-workhorse",
    council: ["cto_analyst", "security_skeptic", "cost_guard"],
    judge: "ovh-cto-specialist",
    maxInputTokens: 18000,
    ownerApproval: false
  },
  legal_accounting: {
    description: "Legal, accounting, fiscal, social, bank, invoice, expense review.",
    criticality: "critical",
    defaultModel: "ovh-legal-specialist",
    council: ["legal_analyst", "accounting_analyst", "skeptic", "document_verifier"],
    judge: "premium-judge",
    maxInputTokens: 24000,
    ownerApproval: true,
    restricted: true
  },
  legal_finance_sentinel: {
    description: "Preventive legal, accounting, fiscal, document, bank, and social-risk sentinel.",
    criticality: "critical",
    defaultModel: "ovh-legal-specialist",
    council: ["legal_analyst", "accounting_analyst", "document_verifier", "cost_guard", "skeptic"],
    judge: "premium-judge",
    maxInputTokens: 24000,
    ownerApproval: true,
    restricted: true
  },
  invoice_reconciliation: {
    description: "Match bank transactions to invoices and detect missing documents.",
    criticality: "high",
    defaultModel: "ovh-accounting-specialist",
    council: ["accounting_analyst", "document_verifier", "skeptic"],
    judge: "ovh-accounting-specialist",
    maxInputTokens: 18000,
    ownerApproval: true,
    restricted: true
  },
  deep_legal_scan: {
    description: "Deep owner-only legal scan of indexed company evidence, commitments, contracts, and missing proof.",
    criticality: "critical",
    defaultModel: "ovh-legal-specialist",
    council: ["legal_analyst", "document_verifier", "skeptic"],
    judge: "premium-judge",
    maxInputTokens: 26000,
    ownerApproval: true,
    restricted: true
  },
  deep_accounting_scan: {
    description: "Deep owner-only accounting scan of bank, invoice, receipt, and accountant-ready evidence.",
    criticality: "critical",
    defaultModel: "ovh-accounting-specialist",
    council: ["accounting_analyst", "document_verifier", "cost_guard", "skeptic"],
    judge: "ovh-accounting-specialist",
    maxInputTokens: 26000,
    ownerApproval: true,
    restricted: true
  },
  deep_risk_synthesis: {
    description: "Cross-functional owner-only synthesis of legal, finance, CTO, CRM, cost, and execution risks.",
    criticality: "critical",
    defaultModel: "business-workhorse",
    council: ["operations_planner", "legal_analyst", "accounting_analyst", "cto_analyst", "cost_guard", "skeptic"],
    judge: "premium-judge",
    maxInputTokens: 26000,
    ownerApproval: true,
    restricted: true
  },
  document_vault: {
    description: "Audit indexed company documents, missing legal/accounting evidence, and document-memory gaps.",
    criticality: "high",
    defaultModel: "ovh-legal-specialist",
    council: ["document_verifier", "legal_analyst", "accounting_analyst", "skeptic"],
    judge: "business-workhorse",
    maxInputTokens: 20000,
    ownerApproval: true,
    restricted: true
  },
  incident_watchdog: {
    description: "Operational incident, cost spike, channel outage, or security alert.",
    criticality: "critical",
    defaultModel: "business-workhorse",
    council: ["incident_commander", "security_skeptic", "cost_guard"],
    judge: "premium-judge",
    maxInputTokens: 10000,
    ownerApproval: false
  }
};

module.exports = { TASK_MATRIX };
