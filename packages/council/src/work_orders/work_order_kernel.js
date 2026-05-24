"use strict";

const crypto = require("crypto");
const { DEPARTMENTS, departmentForCategory } = require("../config/departments");

const AUTOMATION_LEVELS = {
  L0_OBSERVE: "L0_OBSERVE",
  L1_DRAFT: "L1_DRAFT",
  L2_AUTO_SEND_COLD: "L2_AUTO_SEND_COLD",
  L3_OWNER_APPROVAL: "L3_OWNER_APPROVAL",
  L4_FORBIDDEN: "L4_FORBIDDEN"
};

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 12);
}

function dateKey(now = new Date()) {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

function workOrderId({ route = {}, request = {}, workflow = {} } = {}) {
  const seed = {
    category: route.category,
    channel: request.channel,
    prompt: request.prompt,
    lead: workflow.lead && {
      name: workflow.lead.name,
      website: workflow.lead.website,
      email: workflow.lead.email
    },
    email: request.email && {
      from: request.email.from,
      subject: request.email.subject,
      threadId: request.email.threadId
    }
  };
  return `WO-${dateKey()}-${stableHash(seed).toUpperCase()}`;
}

function automationLevelFor({ request = {}, route = {}, workflow = {}, safety = {} } = {}) {
  const mailPolicy = workflow.mail_policy || null;
  const restricted = Boolean(route.restricted || workflow?.signals?.restricted);

  if (safety.gates?.includes("NON_OWNER_RESTRICTED_REFUSAL")) return AUTOMATION_LEVELS.L4_FORBIDDEN;
  if (restricted && request.owner === false) return AUTOMATION_LEVELS.L4_FORBIDDEN;
  if (safety.gates?.includes("BUDGET_HARD_STOP")) return AUTOMATION_LEVELS.L3_OWNER_APPROVAL;
  if (mailPolicy?.label === "spam" || mailPolicy?.automation_mode === "no_reply") return AUTOMATION_LEVELS.L0_OBSERVE;
  if (mailPolicy?.label === "restricted_internal") return AUTOMATION_LEVELS.L3_OWNER_APPROVAL;
  if (mailPolicy?.label === "hot_mail" || mailPolicy?.label === "warm_mail") return AUTOMATION_LEVELS.L3_OWNER_APPROVAL;
  if (mailPolicy?.label === "cold_mail" && mailPolicy.auto_send_allowed && !safety.autoSendBlocked) {
    return AUTOMATION_LEVELS.L2_AUTO_SEND_COLD;
  }
  if (route.requireOwnerApproval || mailPolicy?.approval_required || safety.ownerApprovalRequired) {
    return AUTOMATION_LEVELS.L3_OWNER_APPROVAL;
  }
  return AUTOMATION_LEVELS.L1_DRAFT;
}

function statusForLevel(level) {
  if (level === AUTOMATION_LEVELS.L0_OBSERVE) return "archived_no_action";
  if (level === AUTOMATION_LEVELS.L2_AUTO_SEND_COLD) return "ready_to_execute";
  if (level === AUTOMATION_LEVELS.L3_OWNER_APPROVAL) return "waiting_owner";
  if (level === AUTOMATION_LEVELS.L4_FORBIDDEN) return "blocked";
  return "draft_ready";
}

function permissionsForLevel(level) {
  return {
    can_read_confidential: level !== AUTOMATION_LEVELS.L4_FORBIDDEN,
    can_send_owner_notification: true,
    can_update_crm: level !== AUTOMATION_LEVELS.L4_FORBIDDEN,
    can_send_external_email: level === AUTOMATION_LEVELS.L2_AUTO_SEND_COLD,
    requires_owner_approval: level === AUTOMATION_LEVELS.L3_OWNER_APPROVAL,
    forbidden_external_action: level === AUTOMATION_LEVELS.L4_FORBIDDEN,
    can_pay_or_sign_or_file: false
  };
}

function evidenceSummary(request = {}, workflow = {}) {
  const email = request.email || {};
  const lead = workflow.lead || {};
  return {
    source_channel: request.channel || "unknown",
    prompt_present: Boolean(request.prompt),
    email: email.from || email.subject ? {
      from: email.from || null,
      subject: email.subject || null,
      threadId: email.threadId || null
    } : null,
    lead: lead.name || lead.email || lead.website ? {
      name: lead.name || null,
      website: lead.website || null,
      email: lead.email || null,
      sector: lead.sector || null,
      location: lead.location || null
    } : null,
    raw_body_included: false
  };
}

function buildWorkOrder({ request = {}, route = {}, workflow = {}, safety = {}, runId = null } = {}) {
  const departmentKey = departmentForCategory(route.category);
  const level = automationLevelFor({ request, route, workflow, safety });
  const status = statusForLevel(level);
  const owner = request.owner !== false;

  return {
    id: workOrderId({ route, request, workflow }),
    runId,
    type: route.category,
    department: {
      key: departmentKey,
      ...(DEPARTMENTS[departmentKey] || DEPARTMENTS.front_desk)
    },
    status,
    urgency: route.urgency || "P3",
    owner,
    restricted: Boolean(route.restricted || workflow?.signals?.restricted),
    automation_level: level,
    permissions: permissionsForLevel(level),
    evidence: evidenceSummary(request, workflow),
    lifecycle: {
      created_at: new Date().toISOString(),
      next_status: status === "waiting_owner" ? "approved_or_rejected_by_owner" : "execute_or_archive",
      next_required_actor: status === "waiting_owner" ? "owner" : departmentKey,
      close_condition: status === "ready_to_execute"
        ? "OpenClaw executes allowed action and writes CRM/audit result"
        : status === "blocked"
          ? "Owner reviews blocked request or leaves archived"
          : "Report/draft delivered and recorded"
    }
  };
}

module.exports = {
  AUTOMATION_LEVELS,
  buildWorkOrder,
  automationLevelFor
};
