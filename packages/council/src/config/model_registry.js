"use strict";

const MODEL_REGISTRY = {
  "cheap-default": {
    provider: "huggingface",
    tier: "cheap",
    privacy: "low",
    costRank: 1,
    strengths: ["chat", "short_summary", "classification"],
    model: "openai/gpt-oss-120b"
  },
  "business-workhorse": {
    provider: "huggingface",
    tier: "workhorse",
    privacy: "medium",
    costRank: 2,
    strengths: ["business_analysis", "lead_scoring", "cto_audit", "structured_output"],
    model: "openai/gpt-oss-120b"
  },
  "ovh-legal-specialist": {
    provider: "huggingface",
    tier: "deep",
    privacy: "high",
    costRank: 3,
    strengths: ["legal_review", "confidential_reasoning", "risk_detection"],
    model: "openai/gpt-oss-120b"
  },
  "ovh-accounting-specialist": {
    provider: "huggingface",
    tier: "deep",
    privacy: "high",
    costRank: 3,
    strengths: ["invoice_matching", "expense_review", "tax_social_risk"],
    model: "openai/gpt-oss-120b"
  },
  "ovh-cto-specialist": {
    provider: "ovh-vllm",
    tier: "specialist",
    privacy: "high",
    costRank: 3,
    strengths: ["infra_audit", "security_review", "architecture"],
    model: "local/cto-specialist"
  },
  "premium-judge": {
    provider: "huggingface",
    tier: "judge",
    privacy: "policy-gated",
    costRank: 4,
    strengths: ["synthesis", "conflict_resolution", "high_stakes_decision"],
    model: "openai/gpt-oss-120b"
  },
  "open-source-fallback": {
    provider: "api-or-local",
    tier: "fallback",
    privacy: "medium",
    costRank: 2,
    strengths: ["general_reasoning", "structured_output", "backup_worker"],
    model: "open-source/fallback-70b-class"
  },
  "hf-zero-shot-classifier": {
    provider: "huggingface",
    tier: "free-or-low-cost",
    privacy: "medium",
    costRank: 0,
    strengths: ["classification", "mail_labeling", "compliance_triage"],
    model: "facebook/bart-large-mnli",
    envOverride: "AZZCO_HF_ZERO_SHOT_MODEL"
  },
  "hf-sentiment-worker": {
    provider: "huggingface",
    tier: "free-or-low-cost",
    privacy: "medium",
    costRank: 0,
    strengths: ["sentiment", "lead_temperature", "hot_mail_detection"],
    model: "cardiffnlp/twitter-roberta-base-sentiment-latest",
    envOverride: "AZZCO_HF_SENTIMENT_MODEL"
  },
  "hf-emotion-worker": {
    provider: "huggingface",
    tier: "free-or-low-cost",
    privacy: "medium",
    costRank: 0,
    strengths: ["emotion", "tone", "inbound_message_triage"],
    model: "SamLowe/roberta-base-go_emotions",
    envOverride: "AZZCO_HF_EMOTION_MODEL"
  },
  "hf-summarizer": {
    provider: "huggingface",
    tier: "free-or-low-cost",
    privacy: "medium",
    costRank: 0,
    strengths: ["summary", "thread_compression"],
    model: "sshleifer/distilbart-cnn-12-6",
    envOverride: "AZZCO_HF_SUMMARIZER_MODEL"
  },
  "together-free-writer": {
    provider: "together",
    tier: "free-or-low-cost",
    privacy: "medium",
    costRank: 1,
    strengths: ["short_email", "rewriting", "structured_output"],
    model: "together/free-or-low-cost-instruct",
    envOverride: "AZZCO_TOGETHER_FREE_WRITER_MODEL"
  }
};

module.exports = { MODEL_REGISTRY };
