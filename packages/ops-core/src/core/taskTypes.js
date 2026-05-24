"use strict";

const HIGH_RISK_CATEGORIES = new Set([
  "legal_accounting",
  "invoice_reconciliation",
  "cto_audit",
  "incident_watchdog",
  "owner_decision_meeting",
  "security_review",
  "cost_guardrail"
]);

// cold_email_campaign is intentionally excluded: it must pass the evidence check
// in localColdAllowed (verified contact + public source) — not the looser routine path.
const LOCAL_CATEGORIES = new Set([
  "simple_chat",
  "daily_communications",
  "mail_labeling",
  "crm_pipeline"
]);

const RESTRICTED_TERMS = [
  "bank", "invoice", "receipt", "tax", "urssaf", "dsn", "payroll", "legal",
  "statuts", "contract", "secret", "token", "api key", "password", "internal",
  "confidential", "accounting", "fiscal", "social", "kbis", "rbe", "qonto"
];

const COMMITMENT_TERMS = [
  "price", "pricing", "devis", "proposal", "sign", "signature", "refund",
  "appointment", "rendez-vous", "guarantee"
];

module.exports = {
  HIGH_RISK_CATEGORIES,
  LOCAL_CATEGORIES,
  RESTRICTED_TERMS,
  COMMITMENT_TERMS
};
