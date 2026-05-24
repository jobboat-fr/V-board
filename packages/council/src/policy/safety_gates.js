"use strict";

function isSendAction(action = {}) {
  return ["email", "whatsapp", "telegram"].includes(action.channel) && /send/i.test(action.action || "");
}

function isOwnerChannel(action = {}) {
  return action.channel === "owner_whatsapp" || action.channel === "owner_telegram";
}

function evaluateSafetyGates({ request = {}, route = {}, workflow = {}, budget = {} } = {}) {
  const gates = [];
  const mailPolicy = workflow.mail_policy || null;
  const owner = request.owner !== false;
  const nonOwnerRestricted = !owner && (route.restricted || workflow?.signals?.restricted);

  if (nonOwnerRestricted) gates.push("NON_OWNER_RESTRICTED_REFUSAL");
  if (route.restricted) gates.push("OWNER_ONLY_RESTRICTED_DATA");
  if (mailPolicy?.label === "hot_mail") gates.push("HOT_MAIL_OWNER_APPROVAL");
  if (mailPolicy?.label === "warm_mail") gates.push("WARM_MAIL_OWNER_APPROVAL");
  if (mailPolicy?.label === "restricted_internal") gates.push("RESTRICTED_MAIL_OWNER_ONLY");
  if (mailPolicy?.label === "spam") gates.push("SPAM_NO_REPLY");
  if (workflow?.deal_room?.active) gates.push("DEAL_ROOM_OWNER_REVIEW");
  const prospectEval = workflow?.signals?.prospect_score || {};
  const coldRejectShouldBlock = Boolean(
    mailPolicy?.label === "cold_mail" &&
      prospectEval.decision === "reject" &&
      (
        !mailPolicy?.compliance?.pass ||
        Number(prospectEval.E || 0) < 7 ||
        Number(prospectEval.S || 0) < 7
      )
  );
  if (coldRejectShouldBlock) {
    gates.push("COLD_REJECT_BLOCKS_AUTOSEND");
  }
  if (budget.mode === "force_cheap") gates.push("BUDGET_FORCE_CHEAP_MODE");
  if (budget.mode === "hard_stop") gates.push("BUDGET_HARD_STOP");
  for (const gate of budget.gates || []) gates.push(gate);

  const autoSendBlocked = gates.some((gate) => [
    "NON_OWNER_RESTRICTED_REFUSAL",
    "OWNER_ONLY_RESTRICTED_DATA",
    "HOT_MAIL_OWNER_APPROVAL",
    "WARM_MAIL_OWNER_APPROVAL",
    "RESTRICTED_MAIL_OWNER_ONLY",
    "SPAM_NO_REPLY",
    "DEAL_ROOM_OWNER_REVIEW",
    "COLD_REJECT_BLOCKS_AUTOSEND",
    "BUDGET_FORCE_CHEAP_MODE",
    "BUDGET_HARD_STOP"
  ].includes(gate));

  return {
    gates: [...new Set(gates)],
    autoSendBlocked,
    ownerApprovalRequired: autoSendBlocked || Boolean(route.requireOwnerApproval || mailPolicy?.approval_required),
    nonOwnerRestricted
  };
}

function blockAction(action, reason) {
  return {
    ...action,
    allowed: false,
    approval_required: true,
    blocked_reason: reason || action.blocked_reason || "Blocked by VBOARD safety gates."
  };
}

function enforceSafetyGates({ request = {}, route = {}, workflow = {}, budget = {} } = {}) {
  const safety = evaluateSafetyGates({ request, route, workflow, budget });
  const handoff = workflow.agent_runtime_handoff || { target_system: "agent-runtime", channel_actions: [] };
  const actions = handoff.channel_actions || [];

  const enforcedActions = actions.map((action) => {
    if (isSendAction(action) && (safety.autoSendBlocked || safety.ownerApprovalRequired)) {
      const reason = safety.gates.length
        ? `Blocked by safety gates: ${safety.gates.join(", ")}`
        : "Blocked until owner approval is explicitly recorded.";
      return blockAction(action, reason);
    }
    if (action.channel === "crm" && budget.mode === "hard_stop") {
      return blockAction(action, "Budget hard stop: avoid non-essential downstream actions until owner review.");
    }
    if (!isOwnerChannel(action) && safety.nonOwnerRestricted && action.action !== "refuse") {
      return blockAction(action, "Non-owner restricted request: only refusal and owner notification are allowed.");
    }
    return action;
  });

  if (safety.gates.length && !enforcedActions.some((action) => isOwnerChannel(action))) {
    enforcedActions.push({
      channel: "owner_whatsapp",
      action: "notify_owner",
      allowed: true,
      payload: {
        title: "VBOARD safety gate triggered",
        gates: safety.gates,
        category: route.category,
        urgency: route.urgency
      }
    });
  }

  const nextWorkflow = {
    ...workflow,
    safety: {
      gates: safety.gates,
      auto_send_blocked: safety.autoSendBlocked,
      owner_approval_required: safety.ownerApprovalRequired,
      budget_mode: budget.mode || "normal"
    },
    agent_runtime_handoff: {
      ...handoff,
      channel_actions: enforcedActions,
      safety: {
        ...(handoff.safety || {}),
        gates: safety.gates,
        auto_send_blocked: safety.autoSendBlocked,
        owner_approval_required: safety.ownerApprovalRequired
      }
    }
  };

  return {
    workflow: nextWorkflow,
    safety
  };
}

module.exports = {
  evaluateSafetyGates,
  enforceSafetyGates
};
