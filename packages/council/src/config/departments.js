"use strict";

const DEPARTMENTS = {
  front_desk: {
    label: "Front Desk",
    purpose: "Receive channels, filter noise, create work orders, and hand off safely."
  },
  chief_of_staff: {
    label: "Chief of Staff",
    purpose: "Prioritize the day, prepare owner decisions, and keep execution focused."
  },
  crm_sales: {
    label: "CRM / Sales Office",
    purpose: "Prospecting, lead scoring, outreach, follow-ups, and pipeline hygiene."
  },
  finance: {
    label: "Finance Office",
    purpose: "Invoices, receipts, subscriptions, bank matching, and accountant-ready packs."
  },
  legal: {
    label: "Legal Office",
    purpose: "Contracts, statutes, confidentiality, signatures, and legal risk flags."
  },
  devops_cto: {
    label: "DevOps / CTO Office",
    purpose: "Cloud platforms, uptime, deployments, billing, secrets, and incidents."
  },
  quality_council: {
    label: "Quality Council",
    purpose: "Truth, tone, safety, compliance, evidence, and final hardening."
  },
  memory_records: {
    label: "Memory / Records Office",
    purpose: "Decisions, approvals, CRM history, daily summaries, and audit trails."
  },
  compliance_privacy: {
    label: "Compliance / Privacy Office",
    purpose: "Opt-outs, suppression lists, outreach compliance, GDPR/CNIL/CAN-SPAM checks."
  },
  customer_success: {
    label: "Customer Success Office",
    purpose: "Client onboarding, satisfaction, retention, renewals, and delivery check-ins."
  },
  product_ops: {
    label: "Product / Project Office",
    purpose: "Roadmap, delivery, bugs, feature ideas, and project execution."
  },
  vendor_ops: {
    label: "Procurement / Vendor Office",
    purpose: "Supplier contracts, SaaS renewals, cancellations, and vendor risk."
  },
  bi_metrics: {
    label: "BI / Metrics Office",
    purpose: "Pipeline, revenue, conversion, cost, model spend, and operating metrics."
  }
};

const CATEGORY_DEPARTMENT = {
  simple_chat: "front_desk",
  daily_communications: "front_desk",
  productivity_ops: "chief_of_staff",
  owner_decision_meeting: "chief_of_staff",
  lead_scout: "crm_sales",
  crm_pipeline: "crm_sales",
  cold_email_campaign: "crm_sales",
  sales_reply: "crm_sales",
  deal_desk: "crm_sales",
  mail_labeling: "front_desk",
  mail_triage: "front_desk",
  morning_brief: "chief_of_staff",
  approval_queue: "quality_council",
  weekly_board_brief: "chief_of_staff",
  invoice_reconciliation: "finance",
  legal_accounting: "legal",
  legal_finance_sentinel: "legal",
  deep_legal_scan: "legal",
  deep_accounting_scan: "finance",
  deep_risk_synthesis: "quality_council",
  document_vault: "memory_records",
  cto_audit: "devops_cto",
  incident_watchdog: "devops_cto",
  compliance_privacy: "compliance_privacy",
  customer_success: "customer_success",
  product_project_ops: "product_ops",
  vendor_ops: "vendor_ops",
  bi_metrics: "bi_metrics"
};

function departmentForCategory(category) {
  return CATEGORY_DEPARTMENT[category] || "front_desk";
}

module.exports = {
  DEPARTMENTS,
  CATEGORY_DEPARTMENT,
  departmentForCategory
};
