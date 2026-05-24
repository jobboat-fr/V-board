#!/usr/bin/env node
"use strict";

const assert = require("assert");

const ROOT = "/opt/vboard-council/core";
const { VBoardCouncilEngine, CouncilRuntime } = require(`${ROOT}/src/index`);
const { MockProvider } = require(`${ROOT}/src/providers/mock_provider`);

const engine = new VBoardCouncilEngine({
  runtime: new CouncilRuntime({ provider: new MockProvider() }),
  routeLogger: { log() {} }
});

function actionNames(result, allowed) {
  return (result.workflow?.agent_runtime_handoff?.channel_actions || [])
    .filter((action) => Boolean(action.allowed) === allowed)
    .map((action) => `${action.channel}:${action.action}`);
}

async function runCase(input, expected) {
  const result = await engine.handle({
    owner: true,
    channel: "contract_test",
    runId: `contract_${expected.category}_${Date.now()}`,
    ...input
  });

  assert.strictEqual(result.ok, true, `${expected.category}: engine must return ok`);
  assert.strictEqual(result.route.category, expected.category, `${expected.category}: category`);
  assert.strictEqual(result.workflow.work_order.department.key, expected.department, `${expected.category}: department`);

  if (Object.prototype.hasOwnProperty.call(expected, "restricted")) {
    assert.strictEqual(result.route.restricted, expected.restricted, `${expected.category}: restricted`);
  }
  if (expected.ownerApproval) {
    assert.strictEqual(result.decision.owner_approval_required, true, `${expected.category}: owner approval`);
    assert.strictEqual(result.workflow.safety.owner_approval_required, true, `${expected.category}: safety owner approval`);
    assert.strictEqual(result.workflow.work_order.status, "waiting_owner", `${expected.category}: work order waits owner`);
  }

  const allowedExternalSends = actionNames(result, true)
    .filter((name) => /^(email|whatsapp|telegram):.*send/i.test(name));
  assert.deepStrictEqual(allowedExternalSends, [], `${expected.category}: external sends must not be allowed`);

  return {
    category: result.route.category,
    department: result.workflow.work_order.department.key,
    restricted: result.route.restricted,
    ownerApproval: result.decision.owner_approval_required,
    action: result.decision.action,
    workOrderStatus: result.workflow.work_order.status,
    safetyGates: result.workflow.safety.gates,
    allowedActions: actionNames(result, true),
    blockedActions: actionNames(result, false)
  };
}

(async () => {
  const cases = [
    {
      input: { category: "mail_triage", urgency: "P2", prompt: "Classify inbox and approval gates from mail triage evidence." },
      expected: { category: "mail_triage", department: "front_desk", restricted: false }
    },
    {
      input: { category: "morning_brief", urgency: "P2", prompt: "Prepare morning brief across CRM, CTO, mail, finance and owner actions." },
      expected: { category: "morning_brief", department: "chief_of_staff", restricted: false }
    },
    {
      input: { category: "legal_finance_sentinel", urgency: "P1", prompt: "Inspect legal finance sentinel evidence: bank, tax, invoices, urssaf and documents." },
      expected: { category: "legal_finance_sentinel", department: "legal", restricted: true, ownerApproval: true }
    },
    {
      input: { category: "deep_accounting_scan", urgency: "P1", prompt: "Deep accounting scan over bank, invoice, receipt and accountant evidence." },
      expected: { category: "deep_accounting_scan", department: "finance", restricted: true, ownerApproval: true }
    },
    {
      input: { category: "deep_legal_scan", urgency: "P1", prompt: "Deep legal scan over contracts, commitments, legal documents and missing proof." },
      expected: { category: "deep_legal_scan", department: "legal", restricted: true, ownerApproval: true }
    },
    {
      input: { category: "deep_risk_synthesis", urgency: "P1", prompt: "Synthesize legal, finance, CTO, CRM and cost risk into owner-only priorities." },
      expected: { category: "deep_risk_synthesis", department: "quality_council", restricted: true, ownerApproval: true }
    },
    {
      input: { category: "document_vault", urgency: "P2", prompt: "Audit document vault, missing proof, legal accounting evidence and indexed records." },
      expected: { category: "document_vault", department: "memory_records", restricted: true, ownerApproval: true }
    },
    {
      input: { category: "deal_desk", urgency: "P2", prompt: "Deal desk: hot lead asks for pricing, proposal, meeting and signature.", temperature: 86, mail_label: "hot_mail" },
      expected: { category: "deal_desk", department: "crm_sales", restricted: false, ownerApproval: true }
    },
    {
      input: { category: "approval_queue", urgency: "P2", prompt: "Review approval queue, blocked sends, pending owner decisions and restricted items." },
      expected: { category: "approval_queue", department: "quality_council", restricted: false, ownerApproval: true }
    },
    {
      input: { category: "weekly_board_brief", urgency: "P2", prompt: "Weekly board brief across finance, legal, CRM, CTO, operations and risk." },
      expected: { category: "weekly_board_brief", department: "chief_of_staff", restricted: true, ownerApproval: true }
    },
    {
      input: { urgency: "P2", prompt: "Run mail triage for inbox snapshot and approval gates." },
      expected: { category: "mail_triage", department: "front_desk", restricted: false }
    },
    {
      input: { urgency: "P2", prompt: "Prepare the morning brief with operations, finance, CTO and CRM status." },
      expected: { category: "morning_brief", department: "chief_of_staff", restricted: false }
    },
    {
      input: { urgency: "P2", prompt: "Open the deal desk for a hot prospect asking for pricing and a proposal." },
      expected: { category: "deal_desk", department: "crm_sales", restricted: false, ownerApproval: true }
    }
  ];

  const rows = [];
  for (const testCase of cases) {
    rows.push(await runCase(testCase.input, testCase.expected));
  }

  console.log(JSON.stringify({
    ok: true,
    testedAt: new Date().toISOString(),
    count: rows.length,
    rows
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

