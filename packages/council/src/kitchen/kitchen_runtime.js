"use strict";

const { ClassifierProvider } = require("../providers/classifier_provider");

function textForMail(request = {}, workflow = {}) {
  const email = request.email || {};
  return [
    request.prompt,
    email.subject,
    email.from,
    email.to,
    email.body,
    request.message,
    request.notes,
    workflow?.lead ? JSON.stringify(workflow.lead) : ""
  ].filter(Boolean).join("\n").slice(0, 5000);
}

function escalateMailPolicy(policy, vote) {
  if (!policy || !vote?.topLabel) return policy;
  const label = vote.topLabel;
  const confidence = Number(vote.confidence || 0);
  if (confidence < 0.5) return policy;

  if (label === "restricted_internal" || label === "hot_mail") {
    return {
      ...policy,
      label,
      approval_required: true,
      auto_send_allowed: false,
      automation_mode: "owner_approval",
      reasons: [
        ...(policy.reasons || []),
        `classifier worker voted ${label} (${confidence.toFixed(2)})`
      ]
    };
  }

  if (label === "spam") {
    return {
      ...policy,
      label,
      approval_required: true,
      auto_send_allowed: false,
      automation_mode: "no_reply",
      reasons: [
        ...(policy.reasons || []),
        `classifier worker voted spam (${confidence.toFixed(2)})`
      ]
    };
  }

  return policy;
}

async function applyKitchenWorkers({ request, route, workflow, hf = new ClassifierProvider() }) {
  workflow.kitchen_model_votes = workflow.kitchen_model_votes || [];
  if (!["cold_email_campaign", "mail_labeling", "sales_reply", "daily_communications"].includes(route.category)) {
    return workflow;
  }

  if (!hf.available()) {
    workflow.kitchen_model_votes.push({
      worker: "mail_labeler",
      provider: "remote",
      status: "skipped",
      reason: "remote LLM provider token not configured"
    });
    return workflow;
  }

  try {
    const vote = await hf.classifyMail(textForMail(request, workflow));
    workflow.kitchen_model_votes.push({
      worker: "mail_labeler",
      provider: "remote",
      status: "ok",
      model: vote.model,
      topLabel: vote.topLabel,
      confidence: vote.confidence,
      labels: vote.labels.slice(0, 6),
      scores: vote.scores.slice(0, 6)
    });
    if (workflow.mail_policy) {
      workflow.mail_policy = escalateMailPolicy(workflow.mail_policy, vote);
    }
  } catch (error) {
    workflow.kitchen_model_votes.push({
      worker: "mail_labeler",
      provider: "remote",
      status: "error",
      error: error.message
    });
  }

  return workflow;
}

module.exports = {
  applyKitchenWorkers
};
