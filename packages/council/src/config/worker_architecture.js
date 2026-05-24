"use strict";

const KITCHEN_WORKERS = {
  mail_labeler: {
    purpose: "Label incoming/outbound email as cold, warm, hot, restricted, support, or spam.",
    preferredModel: "hf-zero-shot-classifier",
    fallbackModel: "cheap-default",
    maxInputTokens: 1200,
    outputSchema: ["label", "temperature_score", "confidence", "approval_required", "reason"]
  },
  mail_compliance_guard: {
    purpose: "Check outreach safety, opt-out, truthful claims, B2B relevance, and owner-approval gates.",
    preferredModel: "hf-zero-shot-classifier",
    fallbackModel: "cheap-default",
    maxInputTokens: 900,
    outputSchema: ["compliance_pass", "blocked_reason", "required_edits"]
  },
  cold_outreach_writer: {
    purpose: "Write short personalized B2B cold emails from structured evidence packets.",
    preferredModel: "together-free-writer",
    fallbackModel: "business-workhorse",
    maxInputTokens: 1800,
    outputSchema: ["subject", "body", "language", "opt_out_present"]
  },
  crm_enricher: {
    purpose: "Build CRM upsert packets, dedupe keys, stages, tags, and next follow-up.",
    preferredModel: "cheap-default",
    fallbackModel: "open-source-fallback",
    maxInputTokens: 1200,
    outputSchema: ["lead_id_hint", "stage", "priority", "tags", "next_action"]
  },
  hot_mail_reviewer: {
    purpose: "Analyze hot opportunities, pricing/commitment risk, negotiation context, and owner decision needs.",
    preferredModel: "business-workhorse",
    fallbackModel: "premium-judge",
    maxInputTokens: 4000,
    outputSchema: ["summary", "risk", "recommended_reply", "owner_decision_needed"]
  },
  restricted_info_guard: {
    purpose: "Refuse non-owner requests for internal/legal/accounting/security information and notify owner.",
    preferredModel: "cheap-default",
    fallbackModel: "open-source-fallback",
    maxInputTokens: 700,
    outputSchema: ["refusal_text", "owner_alert"]
  }
};

function workersForCategory(category) {
  if (category === "cold_email_campaign") return ["mail_labeler", "mail_compliance_guard", "cold_outreach_writer", "crm_enricher"];
  if (category === "crm_pipeline") return ["crm_enricher", "mail_labeler"];
  if (category === "sales_reply") return ["mail_labeler", "hot_mail_reviewer", "mail_compliance_guard"];
  if (category === "daily_communications") return ["mail_labeler", "restricted_info_guard"];
  return [];
}

module.exports = {
  KITCHEN_WORKERS,
  workersForCategory
};
