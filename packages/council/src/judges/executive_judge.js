"use strict";

class ExecutiveJudge {
  decide({ route, packets, workflow }) {
    const allRisks = packets.flatMap((packet) => packet.risks || []);
    const allMissing = packets.flatMap((packet) => packet.missing_documents || []);
    const allChecks = packets.flatMap((packet) => packet.checks || []);
    const minConfidence = Math.min(...packets.map((packet) => Number(packet.confidence || 0)));
    const disagreement = packets.some((packet) => (packet.contradictions || []).length > 0);
    const mailPolicy = workflow?.mail_policy || null;
    const safety = workflow?.safety || null;
    const dealRoom = workflow?.deal_room || null;
    const mailRequiresOwner = Boolean(mailPolicy && mailPolicy.approval_required);
    const safetyRequiresOwner = Boolean(safety?.owner_approval_required || safety?.auto_send_blocked);
    const dealRoomRequiresOwner = Boolean(dealRoom?.active);
    const safeDirectCommunication = Boolean(
      route.category === "daily_communications" &&
        workflow?.response_policy?.can_answer_directly &&
        !route.restricted &&
        !safetyRequiresOwner
    );
    const safeColdAutomation = Boolean(
      mailPolicy?.label === "cold_mail" &&
        mailPolicy?.auto_send_allowed &&
        !route.restricted &&
        !safetyRequiresOwner
    );
    const lowConfidenceNeedsOwner = minConfidence < 0.7 && !safeDirectCommunication && !safeColdAutomation;
    const disagreementNeedsOwner = disagreement && !safeDirectCommunication && !safeColdAutomation;
    const requiresOwner = route.requireOwnerApproval || mailRequiresOwner || safetyRequiresOwner || dealRoomRequiresOwner || lowConfidenceNeedsOwner || disagreementNeedsOwner;

    let action = "approve";
    if (requiresOwner) action = "owner_review";
    if (route.urgency === "P0" && allRisks.length) action = "urgent_owner_alert";
    if (dealRoom?.active) action = dealRoom.decision === "owner_brief_ready" ? "owner_review" : "owner_review";
    if (safety?.gates?.includes("BUDGET_HARD_STOP")) action = "owner_review";
    if (safety?.gates?.includes("NON_OWNER_RESTRICTED_REFUSAL")) action = "owner_review";

    return {
      action,
      category: route.category,
      urgency: route.urgency,
      restricted: route.restricted,
      confidence: Number((packets.reduce((sum, p) => sum + Number(p.confidence || 0), 0) / packets.length).toFixed(2)),
      evidence_policy: "facts_emp and estimates_est must stay separated; evidence beats model votes.",
      owner_approval_required: requiresOwner,
      top_risks: [...new Set(allRisks)].slice(0, 8),
      missing_documents: [...new Set(allMissing)].slice(0, 12),
      mandatory_checks: [...new Set(allChecks)].slice(0, 12),
      agent_runtime_handoff_ready: Boolean(workflow?.agent_runtime_handoff),
      mail_label: mailPolicy?.label || null,
      mail_automation_mode: mailPolicy?.automation_mode || null,
      deal_room: dealRoom ? {
        active: dealRoom.active,
        score: dealRoom.score,
        temperature: dealRoom.crm_temperature,
        decision: dealRoom.decision,
        confidence_estimate: dealRoom.confidence_estimate,
        owner_pass_threshold: dealRoom.owner_pass_threshold
      } : null,
      safety_gates: safety?.gates || [],
      agent_runtime_allowed_actions: (workflow?.agent_runtime_handoff?.channel_actions || [])
        .filter((item) => this.actionAllowedForDecision({ action: item, requiresOwner }))
        .map((action) => `${action.channel}:${action.action}`),
      agent_runtime_blocked_actions: (workflow?.agent_runtime_handoff?.channel_actions || [])
        .filter((item) => !this.actionAllowedForDecision({ action: item, requiresOwner }))
        .map((action) => `${action.channel}:${action.action}`),
      next_step: this.nextStep(action, route, dealRoom)
    };
  }

  actionAllowedForDecision({ action, requiresOwner }) {
    if (!action?.allowed) return false;
    if (action.approval_required) return false;
    const externalSend = ["email", "whatsapp", "telegram"].includes(action.channel) && /send/i.test(action.action || "");
    if (requiresOwner && externalSend) return false;
    return true;
  }

  nextStep(action, route, dealRoom = null) {
    if (action === "urgent_owner_alert") return "Notify owner immediately with issue, evidence, risk, and safest next action.";
    if (dealRoom?.active) return "Run Deal Room: combine specialist briefs, sharpen the exact owner decision, and wait for explicit approval.";
    if (action === "owner_review") return "Prepare owner-only decision brief and wait for explicit approval.";
    if (route.category === "lead_scout" || route.category === "cold_email_campaign") return "Return CRM packet and draft-only outreach for owner approval.";
    if (route.category === "crm_pipeline") return "Upsert CRM data, deduplicate, and schedule follow-up.";
    if (route.category === "daily_communications") return "Reply or escalate according to owner/confidentiality policy.";
    return "Deliver concise structured result.";
  }
}

module.exports = { ExecutiveJudge };
