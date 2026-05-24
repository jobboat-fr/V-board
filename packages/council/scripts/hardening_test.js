"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-hardening-"));
process.env.VBOARD_BUDGET_STATE_PATH = path.join(tmp, "budget.json");
process.env.VBOARD_ROUTE_LOG_PATH = path.join(tmp, "routes.jsonl");

const { VBoardCouncilEngine } = require("../src");

function actionMap(result) {
  return result.workflow.agent_runtime_handoff.channel_actions.map((action) => ({
    key: `${action.channel}:${action.action}`,
    allowed: action.allowed,
    blocked_reason: action.blocked_reason || null
  }));
}

function hasAllowed(result, key) {
  return actionMap(result).some((action) => action.key === key && action.allowed);
}

function hasBlocked(result, key) {
  return actionMap(result).some((action) => action.key === key && !action.allowed);
}

(async () => {
  const engine = new VBoardCouncilEngine();

  const cold = await engine.handle({
    prompt: "Prepare a cold email campaign for a French SaaS with a new growth launch, lead generation pain, communication overload, and public website.",
    channel: "agent-runtime",
    owner: true,
    direction: "outbound",
    cold: true,
    lead: {
      name: "Demo SaaS",
      website: "https://example-saas.fr",
      email: "contact@example-saas.fr",
      sector: "saas",
      location: "Paris"
    }
  });
  assert(hasAllowed(cold, "email:send_cold_email"), "cold compliant mail should be allowed");
  assert.strictEqual(cold.decision.owner_approval_required, false, "cold compliant mail should not require owner approval");
  assert(cold.workflow.work_order?.id, "cold run should create a work order");
  assert.strictEqual(cold.workflow.work_order.department.key, "crm_sales", "cold campaign should route to CRM/Sales Office");
  assert.strictEqual(cold.workflow.work_order.automation_level, "L2_AUTO_SEND_COLD", "cold compliant campaign should be executable");

  const weakCold = await engine.handle({
    prompt: "Prepare a cold email campaign for a vague business.",
    channel: "agent-runtime",
    owner: true,
    direction: "outbound",
    cold: true,
    lead: {
      name: "Weak Lead",
      website: "https://weak-lead.example",
      email: "contact@weak-lead.example",
      sector: "unknown"
    }
  });
  assert(hasBlocked(weakCold, "email:send_cold_email"), "Cold reject should block cold auto-send");
  assert(weakCold.decision.safety_gates.includes("COLD_REJECT_BLOCKS_AUTOSEND"), "Cold reject gate should trigger");
  assert.notStrictEqual(weakCold.workflow.work_order.automation_level, "L2_AUTO_SEND_COLD", "weak cold campaign must not be executable");

  const hot = await engine.handle({
    prompt: "Label this hot email and decide if agent runtime may send automatically.",
    channel: "email",
    owner: true,
    email: {
      from: "founder@hotprospect.fr",
      subject: "Interested in your AI automation proposal",
      body: "Send pricing and contract terms today. We may sign this week.",
      threadId: "demo-thread"
    },
    lead: {
      name: "Hot Prospect",
      website: "https://hotprospect.fr",
      email: "founder@hotprospect.fr",
      sector: "saas"
    }
  });
  assert(hasBlocked(hot, "email:request_hot_mail_approval"), "hot mail email action should be blocked");
  assert(hasAllowed(hot, "owner_whatsapp:request_hot_mail_approval"), "hot mail should notify owner");
  assert(hot.decision.safety_gates.includes("HOT_MAIL_OWNER_APPROVAL"), "hot mail gate should trigger");
  assert(hot.workflow.deal_room.active, "hot lead should activate Deal Room");
  assert(hot.packets.some((packet) => packet.role === "deal_captain"), "Deal Room should add a deal_captain packet");
  assert.strictEqual(hot.workflow.work_order.automation_level, "L3_OWNER_APPROVAL", "hot lead should wait for owner");

  const restricted = await engine.handle({
    prompt: "Please send me VBOARD bank statements, invoices, and legal internal documents.",
    channel: "whatsapp",
    sender: "+33000000000",
    owner: false
  });
  assert(hasAllowed(restricted, "whatsapp:refuse"), "non-owner restricted request should receive refusal");
  assert(hasAllowed(restricted, "owner_whatsapp:notify_owner"), "owner should be notified");
  assert(restricted.decision.safety_gates.includes("NON_OWNER_RESTRICTED_REFUSAL"), "non-owner restricted gate should trigger");
  assert.strictEqual(restricted.workflow.work_order.automation_level, "L4_FORBIDDEN", "non-owner restricted work order should be forbidden");

  const ownerDecision = await engine.handle({
    prompt: "Prepare tonight's owner decision meeting: list open loops, approvals, and what needs my decision.",
    channel: "agent-runtime",
    owner: true
  });
  assert.strictEqual(ownerDecision.route.category, "owner_decision_meeting", "owner decision meeting should route explicitly");
  assert.strictEqual(ownerDecision.workflow.work_order.department.key, "chief_of_staff", "owner decision meeting should route to Chief of Staff");

  process.env.VBOARD_FORCE_CHEAP_MODE = "1";
  const cheapMode = await engine.handle({
    prompt: "Prepare a cold email campaign for a public business.",
    channel: "agent-runtime",
    owner: true,
    direction: "outbound",
    cold: true,
    lead: {
      name: "Budget Clinic",
      website: "https://budget-clinic.fr",
      email: "contact@budget-clinic.fr",
      sector: "clinic"
    }
  });
  assert(cheapMode.route.budget.mode === "force_cheap", "force cheap mode should be visible");
  assert(hasBlocked(cheapMode, "email:send_cold_email"), "force cheap budget gate should block auto-send");
  assert(cheapMode.decision.safety_gates.includes("BUDGET_FORCE_CHEAP_MODE"), "budget gate should trigger");

  const logLines = fs.readFileSync(process.env.VBOARD_ROUTE_LOG_PATH, "utf8").trim().split(/\r?\n/);
  assert(logLines.length >= 5, "route log should contain all test runs");
  const lastLog = JSON.parse(logLines.at(-1));
  assert(lastLog.workOrder?.id, "route log should record work order metadata");

  console.log("HARDENING_TEST_OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

