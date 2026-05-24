"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { classify } = require("../src/core/routePolicy");
const { compactEvidence } = require("../src/core/compactEvidence");
const { createServer } = require("../src/server/httpServer");
const { handleRequest } = require("../src/mcp/server");
const { getConfig } = require("../src/config/defaults");
const { WorkOrderStore } = require("../src/core/workOrderStore");
const { buildCfoStack, financeStatus, importBankReconciliation } = require("../src/finance/cfoStack");
const { pullBankSnapshot } = require("../src/finance/bankApi");
const { createApiKey } = require("../src/server/apiKeys");

// ─── helpers ────────────────────────────────────────────────────────────────

async function request(port, method, pathname, body, token = "test-token", extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        authorization: `Bearer ${token}`,
        ...extraHeaders
      }
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function requestText(port, method, pathname, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method,
      headers: extraHeaders
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function withServer(config, fn) {
  const server = createServer(config);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// ─── route policy ────────────────────────────────────────────────────────────

function testRoutePolicy() {
  // Cold public campaign → runner local
  assert.strictEqual(classify({
    category: "cold_email_campaign",
    urgency: "P3",
    temperature: 20,
    mail_label: "cold_mail",
    owner: true,
    lead: { email: "test@example.com", website: "https://example.com" },
    prompt: "Cold public website, no commitment"
  }).route, "runner_local", "cold campaign should be runner_local");

  // Hot sales reply → council_required
  assert.strictEqual(classify({
    category: "sales_reply",
    urgency: "P2",
    temperature: 85,
    mail_label: "hot_mail",
    owner: true,
    prompt: "Hot lead asks for pricing, proposal and signature."
  }).route, "council_required", "hot sales reply should be council_required");

  // CRM pipeline low temp → runner_local
  assert.strictEqual(classify({
    category: "crm_pipeline",
    urgency: "P3",
    temperature: 20,
    owner: true,
    prompt: "Add CRM note, no proposal, no commitment."
  }).route, "runner_local", "CRM note should be runner_local");

  // Legal/accounting → council_required
  assert.strictEqual(classify({
    category: "legal_accounting",
    urgency: "P1",
    prompt: "Check bank API bank invoices"
  }).route, "council_required", "legal_accounting should be council_required");

  // Incident watchdog → council_required
  assert.strictEqual(classify({
    prompt: "p0 server down active attack"
  }).route, "council_required", "incident should be council_required");

  // Restricted data → council_required regardless of temperature
  assert.strictEqual(classify({
    urgency: "P3",
    temperature: 10,
    prompt: "Check tax urssaf dsn filing"
  }).route, "council_required", "restricted term should force council_required");

  // Cold email missing evidence → review first
  assert.strictEqual(classify({
    category: "cold_email_campaign",
    urgency: "P3",
    temperature: 20,
    mail_label: "cold_mail",
    owner: true,
    prompt: "Cold campaign with no lead info"
  }).route, "runner_review_first", "cold campaign without evidence should be review_first");

  // Email with invoice content → should NOT be mail_labeling, should be invoice_reconciliation
  const emailWithInvoice = classify({
    email: { from: "client@example.com", subject: "invoice question", body: "need invoice receipt bank transaction" }
  });
  assert.strictEqual(emailWithInvoice.category, "invoice_reconciliation", "email about invoice should be invoice_reconciliation, not mail_labeling");
  assert.strictEqual(emailWithInvoice.route, "council_required", "invoice reconciliation should go to council");

  // P0 incident in email body → should not be swallowed by mail_labeling fallback
  const incidentEmail = classify({
    email: { from: "sys@example.com", subject: "alert", body: "p0 data leak breach detected" }
  });
  assert.strictEqual(incidentEmail.category, "incident_watchdog", "P0 in email body must be incident_watchdog");
}

// ─── council_may_send invariant ─────────────────────────────────────────────

function testCouncilMaySendInvariant() {
  const fixtures = [
    { prompt: "simple chat hello" },
    { category: "sales_reply", urgency: "P2", temperature: 85, mail_label: "hot_mail", prompt: "pricing and signature" },
    { category: "legal_accounting", urgency: "P1", prompt: "tax urssaf filing" },
    { prompt: "p0 data leak breach" },
    { category: "cold_email_campaign", urgency: "P3", temperature: 20, mail_label: "cold_mail", owner: true, lead: { email: "a@b.com", website: "https://example.com" }, prompt: "cold outreach" },
    { prompt: "invoice receipt bank transaction" },
    { prompt: "deploy vercel railway security uptime" },
    { category: "crm_pipeline", urgency: "P3", temperature: 20, prompt: "crm pipeline follow-up" },
    { restricted: true, prompt: "confidential contract review" },
    { urgency: "P0", prompt: "active attack server down" }
  ];

  for (const fixture of fixtures) {
    const result = classify(fixture);
    assert.strictEqual(result.policy.council_may_send, false,
      `council_may_send must ALWAYS be false — failed for: ${JSON.stringify(fixture)}`);
    assert.strictEqual(result.policy.council_prepares_only, true,
      `council_prepares_only must ALWAYS be true — failed for: ${JSON.stringify(fixture)}`);
    assert.strictEqual(result.execution.email_sender, "runner",
      `email_sender must always be runner — failed for: ${JSON.stringify(fixture)}`);
  }
}

// ─── compact evidence ────────────────────────────────────────────────────────

function testCompactEvidence() {
  const result = compactEvidence({
    evidence: Array.from({ length: 40 }, (_, index) => ({ index })),
    full_log: "secret huge log",
    raw_document: "raw content",
    prompt: "x".repeat(100)
  }, { maxEvidenceItems: 10, maxTextChars: 20 });
  assert.strictEqual(result.evidence.length, 10);
  assert.strictEqual(result.evidence_truncated, true);
  assert.strictEqual(result.full_log, "[REMOVED_BY_COMPACT_EVIDENCE_GUARD]");
  assert.strictEqual(result.raw_document, "[REMOVED_BY_COMPACT_EVIDENCE_GUARD]");
  assert.ok(result.prompt.includes("[TRUNCATED]"));
}

// ─── HTTP API ────────────────────────────────────────────────────────────────

async function testHttpApi() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-ops-core-"));
  const crmKey = createApiKey({ name: "crm-test", scopes: "route:read,work_orders:read,work_orders:write,department:dispatch" });
  const financeKey = createApiKey({ name: "finance-test", scopes: "finance:read,finance:write,bank:pull" });
  const opsKey = createApiKey({ name: "ops-test", scopes: "observability:read,observability:write" });
  const keysFile = path.join(dataRoot, "api_keys.json");
  writeJson(keysFile, { keys: [crmKey.entry, financeKey.entry, opsKey.entry] });
  const config = getConfig({ dataRoot, token: "test-token", keysFile, port: 0 });
  await withServer(config, async (port) => {
    const dashboard = await requestText(port, "GET", "/dashboard", { accept: "text/html" });
    assert.strictEqual(dashboard.status, 200);
    assert.ok(dashboard.body.includes("VBOARD Ops Live"));

    // Health (public, no auth)
    const health = await request(port, "GET", "/health");
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.body.ok, true);
    assert.ok(health.body.version, "health should include version");

    // Ready (public, no auth)
    const ready = await request(port, "GET", "/ready");
    assert.strictEqual(ready.status, 200);
    assert.strictEqual(ready.body.authConfigured, true);

    // Auth required on protected routes
    const unauth = await request(port, "GET", "/v1/work-orders", null, "wrong-token");
    assert.strictEqual(unauth.status, 401);

    // Route — legal should go to council
    const route = await request(port, "POST", "/v1/route", {
      category: "legal_accounting",
      urgency: "P1",
      prompt: "Check bank API bank invoices"
    }, crmKey.token);
    assert.strictEqual(route.status, 200);
    assert.strictEqual(route.body.route, "council_required");

    const dispatch = await request(port, "POST", "/v1/departments/dispatch", {
      department: "crm",
      payload: { prompt: "Add CRM note", urgency: "P3" }
    }, crmKey.token);
    assert.strictEqual(dispatch.status, 200);
    assert.strictEqual(dispatch.body.department, "crm");

    const forbiddenFinance = await request(port, "GET", "/v1/finance/status", null, crmKey.token);
    assert.strictEqual(forbiddenFinance.status, 403);
    assert.strictEqual(forbiddenFinance.body.error, "INSUFFICIENT_SCOPE");

    // File write + read
    const write = await request(port, "POST", "/v1/files/write", { path: "notes/test.md", content: "hello" });
    assert.strictEqual(write.body.ok, true);
    const read = await request(port, "POST", "/v1/files/read", { path: "notes/test.md" });
    assert.strictEqual(read.body.content, "hello");

    // Path traversal → 403 (not 500)
    const blocked = await request(port, "POST", "/v1/files/read", { path: "../outside.txt" });
    assert.strictEqual(blocked.status, 403, "path traversal should return 403");
    assert.strictEqual(blocked.body.error, "PATH_OUTSIDE_DATA_ROOT");

    // Work orders with project namespacing
    await request(port, "POST", "/v1/work-orders", { project: "crm", title: "Follow up lead", priority: "P2" });
    await request(port, "POST", "/v1/work-orders", { project: "front-desk", title: "Reply email", priority: "P3" });
    const all = await request(port, "GET", "/v1/work-orders");
    assert.ok(all.body.workOrders.length >= 2);
    const crm = await request(port, "GET", "/v1/work-orders?project=crm");
    assert.ok(crm.body.workOrders.every((wo) => wo.project === "crm"), "project filter must work");

    const finance = await request(port, "POST", "/v1/finance/build", {}, financeKey.token);
    assert.strictEqual(finance.status, 200);
    assert.strictEqual(finance.body.status, "blocked");
    assert.ok(finance.body.blockers.includes("BANK_TRANSACTIONS_MISSING"));

    writeJson(path.join(dataRoot, "reports", "bank.json"), {
      transactions: [
        { id: "api-1", label: "RAILWAY", amount: 12.5, side: "debit", currency: "EUR", settled_at: "2026-02-20T10:00:00Z" }
      ],
      uploads: []
    });
    const imported = await request(port, "POST", "/v1/finance/import-bank", { reportPath: "reports/bank.json" }, financeKey.token);
    assert.strictEqual(imported.status, 200);
    assert.strictEqual(imported.body.status, "imported_debit_only");
    assert.strictEqual(imported.body.transactionCount, 1);

    const obsTest = await request(port, "POST", "/v1/observability/test", { source: "test" }, opsKey.token);
    assert.strictEqual(obsTest.status, 200);
    assert.strictEqual(obsTest.body.ok, true);
    const obsSummary = await request(port, "GET", "/v1/observability/summary", null, opsKey.token);
    assert.strictEqual(obsSummary.status, 200);
    assert.strictEqual(obsSummary.body.ok, true);
    assert.ok(obsSummary.body.totalEvents >= 1);
    assert.strictEqual(obsSummary.body.eventSink.configured, false);
    const obsSink = await request(port, "GET", "/v1/observability/sink", null, opsKey.token);
    assert.strictEqual(obsSink.status, 200);
    assert.strictEqual(obsSink.body.eventSink.configured, false);
    const obsEvents = await request(port, "GET", "/v1/observability/events?limit=10", null, opsKey.token);
    assert.strictEqual(obsEvents.status, 200);
    assert.ok(Array.isArray(obsEvents.body.events));
  });
}

// ─── work order store ────────────────────────────────────────────────────────

function testWorkOrderStore() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-wos-"));
  const store = new WorkOrderStore(dataRoot);

  store.create({ project: "alpha", title: "Task A", status: "open" });
  store.create({ project: "beta", title: "Task B", status: "done" });
  store.create({ project: "alpha", title: "Task C", status: "open" });

  const all = store.list({});
  assert.strictEqual(all.length, 3);

  const alpha = store.list({ project: "alpha" });
  assert.strictEqual(alpha.length, 2);
  assert.ok(alpha.every((wo) => wo.project === "alpha"));

  const done = store.list({ status: "done" });
  assert.strictEqual(done.length, 1);
  assert.strictEqual(done[0].title, "Task B");
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

async function testMcp() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-mcp-"));
  const config = getConfig({ dataRoot });

  // tools/list — should include all 9 tools
  const list = await handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, config);
  const toolNames = list.result.tools.map((t) => t.name);
  for (const name of ["vboard_route", "vboard_bridge", "vboard_file_read", "vboard_file_write", "vboard_file_list", "vboard_work_order_create", "vboard_work_order_list", "vboard_health", "vboard_finance_build", "vboard_finance_status", "vboard_finance_import_bank", "vboard_finance_pull_bank", "vboard_policy"]) {
    assert.ok(toolNames.includes(name), `tools/list must include ${name}`);
  }

  // vboard_route — simple chat should be runner_local
  const route = await handleRequest({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "vboard_route", arguments: { category: "simple_chat", urgency: "P3", prompt: "hello" } }
  }, config);
  assert.ok(route.result.content[0].text.includes("runner_local"));

  // vboard_health
  const healthResp = await handleRequest({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "vboard_health", arguments: {} }
  }, config);
  const health = JSON.parse(healthResp.result.content[0].text);
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.service, "vboard-ops-core");

  // vboard_policy — must assert council_may_send: false invariant
  const policyResp = await handleRequest({
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "vboard_policy", arguments: {} }
  }, config);
  const policy = JSON.parse(policyResp.result.content[0].text);
  assert.strictEqual(policy.invariants.council_may_send, false);
  assert.strictEqual(policy.invariants.council_prepares_only, true);

  const financeStatusResp = await handleRequest({
    jsonrpc: "2.0", id: 41, method: "tools/call",
    params: { name: "vboard_finance_status", arguments: {} }
  }, config);
  const financeBefore = JSON.parse(financeStatusResp.result.content[0].text);
  assert.strictEqual(financeBefore.status, "missing");

  // vboard_work_order_create + vboard_work_order_list with project filter
  await handleRequest({
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "vboard_work_order_create", arguments: { project: "test-proj", title: "MCP task" } }
  }, config);
  const woList = await handleRequest({
    jsonrpc: "2.0", id: 6, method: "tools/call",
    params: { name: "vboard_work_order_list", arguments: { project: "test-proj" } }
  }, config);
  const wos = JSON.parse(woList.result.content[0].text);
  assert.ok(wos.workOrders.some((wo) => wo.project === "test-proj" && wo.title === "MCP task"));

  // Unknown tool → isError
  const unknown = await handleRequest({
    jsonrpc: "2.0", id: 7, method: "tools/call",
    params: { name: "not_a_tool", arguments: {} }
  }, config);
  assert.strictEqual(unknown.result.isError, true);
}

// ─── runner ──────────────────────────────────────────────────────────────────

// CFO stack

function seedFinanceContext(dataRoot, validationOverride = {}) {
  const ctx = path.join(dataRoot, "ops", "context");
  writeJson(path.join(ctx, "bank_transactions.json"), [
    { id: "injection-1", date: "2026-02-01", merchant: "Owner Transfer", amount: 1000, sourceDocument: "february_2026.pdf" },
    { id: "client-1", date: "2026-02-10", merchant: "CONSULTING CLIENT", amount: 500, sourceDocument: "february_2026.pdf" },
    { id: "dup-transfer", date: "2026-02-11", merchant: "Owner Transfer", amount: 250, sourceDocument: "february_2026.pdf" },
    { id: "dup-transfer", date: "2026-02-12", merchant: "Owner Transfer", amount: 250, sourceDocument: "february_2026.pdf" },
    { id: "cursor-1", date: "2026-02-13", merchant: "CURSOR, AI POWERED IDE", amount: -20, sourceDocument: "february_2026.pdf" },
    { id: "unknown-1", date: "2026-02-14", merchant: "UNKNOWN VENDOR", amount: 5, side: "debit", sourceDocument: "february_2026.pdf" }
  ]);
  writeJson(path.join(ctx, "bank_statement_validation.json"), {
    ok: true,
    openingBalance: 0,
    closingBalance: 1975,
    declaredCreditsTotal: 2000,
    parsedCreditsTotal: 2000,
    declaredDebitsTotal: -25,
    parsedDebitsTotal: -25,
    ...validationOverride
  });
  writeJson(path.join(ctx, "invoice_matches.json"), [
    { transactionId: "cursor-1", invoicePath: "docs/receipts/cursor.pdf" }
  ]);
}

function testCfoStackBuildsEvidenceBoundLedger() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-cfo-ok-"));
  seedFinanceContext(dataRoot);
  const report = buildCfoStack(dataRoot);

  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.status, "ok");
  assert.strictEqual(report.validation.transactionCount, 6);
  assert.strictEqual(report.summary.periodNetMovement, 1975);
  assert.strictEqual(report.summary.computedClosingBalance, 1975);
  assert.strictEqual(report.summary.declaredClosingBalance, 1975);
  assert.strictEqual(report.validation.invoiceLinkedCount, 1);
  assert.strictEqual(report.validation.unclassifiedCount, 1);
  assert.deepStrictEqual(report.validation.duplicateSourceIds, [{ sourceId: "dup-transfer", occurrenceId: "dup-transfer#2" }]);
  assert.ok(fs.existsSync(path.join(dataRoot, "finance", "ledger", "main.beancount")), "main ledger should be written");
  assert.ok(fs.existsSync(path.join(dataRoot, "finance", "reports", "manifest.json")), "manifest should be written");

  const status = financeStatus(dataRoot);
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.status, "ok");
}

function testKnownSaasClassifiers() {
  assert.strictEqual(buildCfoStack.name, "buildCfoStack");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-cfo-saas-"));
  const ctx = path.join(dataRoot, "ops", "context");
  writeJson(path.join(ctx, "bank_transactions.json"), [
    { id: "cloud-host-1", date: "2026-05-01", merchant: "CLOUD HOST BASIC", amount: -9.99 },
    { id: "zoho-1", date: "2026-05-02", merchant: "ZOHO-ZOHO CORP", amount: -3.6 }
  ]);
  writeJson(path.join(ctx, "bank_statement_validation.json"), {
    ok: true,
    declaredCreditsTotal: 0,
    parsedCreditsTotal: 0,
    declaredDebitsTotal: -13.59,
    parsedDebitsTotal: -13.59
  });
  writeJson(path.join(ctx, "invoice_matches.json"), []);

  const report = buildCfoStack(dataRoot);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.validation.unclassifiedCount, 0);
  assert.ok(report.expenseBreakdown.ranked.some((item) => item.account === "Expenses:Cloud:VPS"));
  assert.ok(report.expenseBreakdown.ranked.some((item) => item.account === "Expenses:Software:Zoho"));
}

function testCfoStackFailsClosedOnBadValidation() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-cfo-blocked-"));
  seedFinanceContext(dataRoot, {
    ok: false,
    declaredDebitsTotal: -31.59,
    parsedDebitsTotal: -25
  });
  const report = buildCfoStack(dataRoot);

  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.status, "blocked");
  assert.ok(report.blockers.includes("BANK_VALIDATION_NOT_OK"));
  assert.ok(report.blockers.includes("BANK_STATEMENT_VALIDATION_FAILED"));
  assert.ok(fs.existsSync(path.join(dataRoot, "finance", "reports", "finance_report.json")), "blocked report should be written");
  assert.strictEqual(fs.existsSync(path.join(dataRoot, "finance", "ledger", "main.beancount")), false, "ledger must not be generated when validation fails");
}

function testCfoStackRejectsOkFlagWhenTotalsMismatch() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-cfo-mismatch-"));
  seedFinanceContext(dataRoot, {
    ok: true,
    declaredDebitsTotal: -31.59,
    parsedDebitsTotal: -25
  });
  const report = buildCfoStack(dataRoot);

  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.status, "blocked");
  assert.ok(report.blockers.includes("BANK_STATEMENT_TOTALS_MISMATCH"));
  assert.strictEqual(fs.existsSync(path.join(dataRoot, "finance", "ledger", "main.beancount")), false, "explicit ok must not override mismatched totals");
}

function testCfoStackRejectsOutputTraversal() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-cfo-traversal-"));
  seedFinanceContext(dataRoot);
  assert.throws(() => buildCfoStack(dataRoot, { outputDir: "../outside" }), /PATH_OUTSIDE_DATA_ROOT/);
  assert.throws(() => financeStatus(dataRoot, { outputDir: "../outside" }), /PATH_OUTSIDE_DATA_ROOT/);
}

function testBankImportFeedsCfoStack() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-bank-import-"));
  const reportPath = path.join(dataRoot, "reports", "bank_receipt_reconcile_test.json");
  writeJson(reportPath, {
    transactions: [
      { id: "bank-1", transaction_id: "tx-1", label: "CONSULTING CLIENT", amount: 500, side: "credit", currency: "EUR", settled_at: "2026-03-01T09:00:00Z" },
      { id: "bank-2", transaction_id: "tx-2", label: "RAILWAY", amount: 12.5, side: "debit", currency: "EUR", settled_at: "2026-03-02T09:00:00Z", attachment_ids: [] }
    ],
    decisions: [
      { action: "attach", score: 0.91, transaction: { id: "bank-2" }, receipt: { file: "receipts/railway.pdf" } }
    ],
    uploads: [
      { ok: true, transactionId: "bank-2", file: "receipts/railway.pdf", idempotencyKey: "idem" }
    ]
  });

  const imported = importBankReconciliation(dataRoot, reportPath, { trustBankApi: true });
  assert.strictEqual(imported.status, "ready");
  assert.strictEqual(imported.transactionCount, 2);
  assert.strictEqual(imported.invoiceMatchCount, 1);
  assert.strictEqual(imported.credits, 500);
  assert.strictEqual(imported.debits, -12.5);

  const report = buildCfoStack(dataRoot);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.validation.invoiceLinkedCount, 1);
  assert.strictEqual(report.summary.periodNetMovement, 487.5);
}

function testBankDebitOnlyImportFailsClosed() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-bank-debit-only-"));
  const reportPath = path.join(dataRoot, "reports", "bank_receipt_reconcile_debit_only.json");
  writeJson(reportPath, {
    transactions: [
      { id: "bank-1", transaction_id: "tx-1", label: "RAILWAY", amount: 12.5, side: "debit", currency: "EUR", settled_at: "2026-03-02T09:00:00Z" }
    ],
    decisions: [],
    uploads: []
  });

  const imported = importBankReconciliation(dataRoot, reportPath, { trustBankApi: true });
  assert.strictEqual(imported.status, "imported_debit_only");
  assert.strictEqual(imported.validation.ok, false);
  assert.strictEqual(imported.validation.scope, "debit_only_expense_reconciliation");

  const report = buildCfoStack(dataRoot);
  assert.strictEqual(report.status, "blocked");
  assert.ok(report.blockers.includes("BANK_VALIDATION_NOT_OK"));
}

async function testBankFullPullFeedsCfoStack() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vboard-bank-pull-"));
  writeJson(path.join(dataRoot, "ops", "context", "invoice_matches.json"), [
    { transactionId: "stale-old-id", invoicePath: "receipts/old.pdf" }
  ]);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const pathname = url.pathname;
    const side = url.searchParams.get("side");
    const page = Number(url.searchParams.get("page") || 1);
    if (pathname.endsWith("/organization")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ organization: { id: "org-1", slug: "demo", name: "Demo Org", bank_accounts: [{ id: "ba-1", name: "Main" }] } })
      };
    }
    if (pathname.endsWith("/transactions") && side === "credit" && page === 1) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ transactions: [{ id: "credit-1", label: "CONSULTING CLIENT", amount: 700, side: "credit", currency: "EUR", settled_at: "2026-04-01T10:00:00Z" }], meta: {} })
      };
    }
    if (pathname.endsWith("/transactions") && side === "debit" && page === 1) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ transactions: [{ id: "debit-1", label: "VERCEL INC.", amount: 30, side: "debit", currency: "EUR", settled_at: "2026-04-02T10:00:00Z", attachment_ids: ["att-1"] }], meta: {} })
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ transactions: [], meta: {} }) };
  };

  const pulled = await pullBankSnapshot(dataRoot, { auth: "login:secret", fetchImpl, since: "2026-04-01T00:00:00Z" });
  assert.strictEqual(pulled.status, "ready");
  assert.strictEqual(pulled.transactionCount, 2);
  assert.strictEqual(pulled.invoiceMatchCount, 1);
  assert.strictEqual(pulled.credits, 700);
  assert.strictEqual(pulled.debits, -30);
  assert.ok(calls.some((url) => url.includes("side=credit")), "must fetch credit side");
  assert.ok(calls.some((url) => url.includes("side=debit")), "must fetch debit side");

  const report = buildCfoStack(dataRoot);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.summary.periodNetMovement, 670);
  assert.strictEqual(report.validation.invoiceLinkedCount, 1);
}

async function main() {
  testRoutePolicy();
  testCouncilMaySendInvariant();
  testCompactEvidence();
  testWorkOrderStore();
  await testHttpApi();
  await testMcp();
  testCfoStackBuildsEvidenceBoundLedger();
  testCfoStackFailsClosedOnBadValidation();
  testCfoStackRejectsOkFlagWhenTotalsMismatch();
  testCfoStackRejectsOutputTraversal();
  testKnownSaasClassifiers();
  testBankImportFeedsCfoStack();
  testBankDebitOnlyImportFailsClosed();
  await testBankFullPullFeedsCfoStack();
  process.stdout.write("All tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
