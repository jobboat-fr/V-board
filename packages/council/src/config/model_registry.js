"use strict";

const MODEL_REGISTRY = {
  "cheap-default": {
    provider: "remote",
    tier: "cheap",
    privacy: "low",
    costRank: 1,
    strengths: ["chat", "short_summary", "classification"],
    model: "remote/default-large-model"
  },
  "business-workhorse": {
    provider: "remote",
    tier: "workhorse",
    privacy: "medium",
    costRank: 2,
    strengths: ["business_analysis", "lead_scoring", "cto_audit", "structured_output"],
    model: "remote/default-large-model"
  },
  "back-office-legal-specialist": {
    provider: "remote",
    tier: "deep",
    privacy: "high",
    costRank: 3,
    strengths: ["legal_review", "confidential_reasoning", "risk_detection"],
    model: "remote/default-large-model"
  },
  "back-office-accounting-specialist": {
    provider: "remote",
    tier: "deep",
    privacy: "high",
    costRank: 3,
    strengths: ["invoice_matching", "expense_review", "tax_social_risk"],
    model: "remote/default-large-model"
  },
  "back-office-cto-specialist": {
    provider: "back-office-vllm",
    tier: "specialist",
    privacy: "high",
    costRank: 3,
    strengths: ["infra_audit", "security_review", "architecture"],
    model: "local/cto-specialist"
  },
  "premium-judge": {
    provider: "remote",
    tier: "judge",
    privacy: "policy-gated",
    costRank: 4,
    strengths: ["synthesis", "conflict_resolution", "high_stakes_decision"],
    model: "remote/default-large-model"
  },
  "open-source-fallback": {
    provider: "api-or-local",
    tier: "fallback",
    privacy: "medium",
    costRank: 2,
    strengths: ["general_reasoning", "structured_output", "backup_worker"],
    model: "open-source/fallback-70b-class"
  },
  "classifier-zero-shot": {
    provider: "remote",
    tier: "free-or-low-cost",
    privacy: "medium",
    costRank: 0,
    strengths: ["classification", "mail_labeling", "compliance_triage"],
    model: "classifier/zero-shot-default",
    envOverride: "VBOARD_ZERO_SHOT_MODEL"
  },
  "classifier-sentiment": {
    provider: "remote",
    tier: "free-or-low-cost",
    privacy: "medium",
    costRank: 0,
    strengths: ["sentiment", "lead_temperature", "hot_mail_detection"],
    model: "classifier/sentiment-default",
    envOverride: "VBOARD_SENTIMENT_MODEL"
  },
  "classifier-emotion": {
    provider: "remote",
    tier: "free-or-low-cost",
    privacy: "medium",
    costRank: 0,
    strengths: ["emotion", "tone", "inbound_message_triage"],
    model: "classifier/emotion-default",
    envOverride: "VBOARD_EMOTION_MODEL"
  },
  "classifier-summarizer": {
    provider: "remote",
    tier: "free-or-low-cost",
    privacy: "medium",
    costRank: 0,
    strengths: ["summary", "thread_compression"],
    model: "classifier/summarizer-default",
    envOverride: "VBOARD_SUMMARIZER_MODEL"
  },
  "fallback-free-writer": {
    provider: "fallback",
    tier: "free-or-low-cost",
    privacy: "medium",
    costRank: 1,
    strengths: ["short_email", "rewriting", "structured_output"],
    model: "fallback/free-or-low-cost-instruct",
    envOverride: "VBOARD_FALLBACK_WRITER_MODEL"
  }
};

module.exports = { MODEL_REGISTRY };


