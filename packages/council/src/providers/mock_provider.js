"use strict";

class MockProvider {
  async runRole({ role, route, request, workflow }) {
    const facts = [];
    const estimates = [];
    const risks = [];
    const missing = [];
    const checks = [];
    const signals = workflow?.signals || {};

    if (route.restricted) {
      facts.push("[EMP] Request is classified as restricted/internal.");
      risks.push("Confidentiality breach if raw documents are exposed to non-owner channels.");
    }

    if (workflow?.lead) {
      facts.push(`[EMP] Lead packet created for ${workflow.lead.name}.`);
      if (workflow.lead.website) facts.push(`[EMP] Public website/contact source present: ${workflow.lead.website}.`);
      if (workflow.lead.email) facts.push("[EMP] Public email/contact channel present.");
      if (!workflow.lead.email) missing.push("Verified public business email");
      estimates.push(`[EST] Best AZZ&CO offer: ${workflow.offer}.`);
      checks.push(`AZZING decision: ${signals.azzing?.decision || "unknown"} (${signals.azzing?.D_fast ?? "n/a"}).`);
      if (workflow.mail_policy) {
        facts.push(`[EMP] Mail labeled ${workflow.mail_policy.label} with temperature ${workflow.mail_policy.temperature_score}/100.`);
        checks.push(`Automation mode: ${workflow.mail_policy.automation_mode}.`);
      }
    }

    if (role === "deal_captain") {
      const deal = workflow?.deal_room || {};
      facts.push(`[EMP] Deal Room active: ${deal.active ? "yes" : "no"}; score ${deal.score ?? "n/a"}/100.`);
      estimates.push("[EST] Premium deal hardening should focus on the strongest next owner action, not more generic drafting.");
      risks.push("A high-temperature lead can be lost if pricing, timing, authority, or scope is unclear.");
      for (const missingItem of deal.required_inputs || []) missing.push(missingItem);
      checks.push("Condense all worker briefs into one owner decision packet.");
      checks.push("Do not send or promise anything externally until owner approves the exact message.");
    }

    if (role.includes("accounting")) {
      estimates.push("[EST] Needs transaction/invoice matching before any fiscal conclusion.");
      missing.push("Current complete invoice list");
      missing.push("Current complete bank transaction export");
    }

    if (role.includes("legal")) {
      estimates.push("[EST] Legal conclusions require accountant/lawyer validation.");
      missing.push("Signed and dated legal source documents, if not already indexed");
    }

    if (role.includes("market")) {
      estimates.push("[EST] Lead fit depends on public evidence, timing, and reachable contact.");
      checks.push("Reject leads with guessed emails, fake personalization, or weak fit.");
    }

    if (role.includes("crm")) {
      facts.push("[EMP] CRM update can be represented as a structured upsert packet.");
      checks.push("Deduplicate by website/email/name before creating a new CRM record.");
    }

    if (role.includes("compliance")) {
      if (workflow?.mail_policy?.auto_send_allowed) {
        checks.push("Cold mail auto-send is allowed because compliance and confidence gates passed.");
      } else {
        risks.push("Warm, hot, restricted, or low-confidence mail requires owner approval before sending.");
      }
      checks.push("Email draft must identify AZZ&CO LABS truthfully and include opt-out.");
    }

    if (role.includes("mail_labeler")) {
      facts.push(`[EMP] Mail automation label: ${workflow?.mail_policy?.label || "unlabeled"}.`);
      checks.push("Cold mail can auto-send only when public contact, relevance, opt-out, and confidence gates pass.");
      checks.push("Hot mail must request owner approval.");
    }

    if (role.includes("relationship")) {
      estimates.push("[EST] Reply should collect need, budget range, timeline, website, and preferred contact channel.");
      checks.push("Avoid binding price, appointment, refund, legal, or delivery commitments.");
    }

    if (role.includes("communications")) {
      facts.push("[EMP] Inbound communication requires sender, channel, topic, urgency, and owner/non-owner classification.");
      checks.push("Restricted non-owner requests require refusal plus owner notification.");
    }

    if (role.includes("operations")) {
      checks.push("Convert vague tasks into owner-visible next actions with due date and blocker.");
    }

    if (role.includes("skeptic") || role.includes("verifier")) {
      risks.push("Model-only reasoning is insufficient without evidence packets.");
      missing.push("Evidence references for every claim");
    }

    if (role.includes("cost")) {
      risks.push("Unbounded model or cloud use can consume trial/API credits.");
    }

    return {
      role,
      modelAlias: role === "deal_captain" ? "premium-judge" : route.spec.defaultModel,
      facts_emp: facts,
      estimates_est: estimates,
      risks,
      missing_documents: [...new Set(missing)],
      checks: [...new Set(checks)],
      contradictions: [],
      recommended_action: this.recommend(role, route),
      confidence: route.restricted ? 0.72 : 0.82,
      requires_owner_approval: route.requireOwnerApproval || role === "deal_captain"
    };
  }

  recommend(role, route) {
    if (role === "deal_captain") return "Prepare the high-value deal brief for owner approval; do not auto-send.";
    if (route.restricted) return "Prepare owner-only report; do not disclose raw documents.";
    if (role.includes("skeptic")) return "Verify assumptions before final answer.";
    if (role.includes("compliance")) return "Keep outreach draft-only until owner approval.";
    if (role.includes("crm")) return "Prepare CRM upsert and follow-up plan.";
    if (role.includes("writer")) return "Draft only; require owner approval before sending.";
    return "Proceed with structured evidence-first analysis.";
  }
}

module.exports = { MockProvider };
