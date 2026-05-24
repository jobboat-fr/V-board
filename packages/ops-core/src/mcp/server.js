"use strict";

const { classify } = require("../core/routePolicy");
const { routeOrBridge } = require("../core/bridgeClient");
const { WorkOrderStore } = require("../core/workOrderStore");
const { readText, writeText, listFiles } = require("../core/safeFs");
const { HIGH_RISK_CATEGORIES, LOCAL_CATEGORIES, RESTRICTED_TERMS, COMMITMENT_TERMS } = require("../core/taskTypes");
const { buildCfoStack, financeStatus, importBankReconciliation } = require("../finance/cfoStack");
const { pullBankSnapshot } = require("../finance/bankApi");

function textContent(value) {
  return [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
}

const TOOL_DEFS = [
  {
    name: "vboard_route",
    description: "Classify a task and return a deterministic routing decision: runner_local, runner_review_first, or council_required. Does not call council — pure policy logic.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Calling project name (e.g. 'crm', 'front-desk')" },
        category: { type: "string", description: "Task category override (skips inference if provided)" },
        urgency: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
        temperature: { type: "number", description: "0–100, hot = high" },
        mail_label: { type: "string" },
        prompt: { type: "string" },
        restricted: { type: "boolean" },
        owner: { type: "boolean" }
      },
      additionalProperties: true
    }
  },
  {
    name: "vboard_bridge",
    description: "Route a task and, only when route=council_required, call the configured council endpoint with compact evidence. Returns the routing decision plus the council response when called.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        category: { type: "string" },
        urgency: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
        temperature: { type: "number" },
        prompt: { type: "string" },
        restricted: { type: "boolean" },
        owner: { type: "boolean" }
      },
      additionalProperties: true
    }
  },
  {
    name: "vboard_file_read",
    description: "Read a text file inside VBOARD_DATA_ROOT. Path must be relative to the data root.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path within VBOARD_DATA_ROOT" } },
      required: ["path"]
    }
  },
  {
    name: "vboard_file_write",
    description: "Write a text file inside VBOARD_DATA_ROOT. Creates parent directories as needed.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within VBOARD_DATA_ROOT" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "vboard_file_list",
    description: "List files and directories inside VBOARD_DATA_ROOT at the given path.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path within VBOARD_DATA_ROOT (default: root)" } }
    }
  },
  {
    name: "vboard_work_order_create",
    description: "Create a durable work order stored as JSONL under VBOARD_DATA_ROOT. Returns the created work order with a UUID.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project namespace (default: 'default')" },
        title: { type: "string" },
        category: { type: "string" },
        priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
        status: { type: "string", enum: ["open", "in_progress", "done", "blocked"] },
        owner: { type: "boolean" },
        payload: { type: "object" }
      },
      additionalProperties: true
    }
  },
  {
    name: "vboard_work_order_list",
    description: "List recent work orders, optionally filtered by project or status.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max items to return (default: 100)" },
        project: { type: "string", description: "Filter by project name" },
        status: { type: "string", description: "Filter by status (open, in_progress, done, blocked)" }
      }
    }
  },
  {
    name: "vboard_health",
    description: "Returns service health: version, data root, council and auth configuration status. Use to verify connectivity from other projects.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "vboard_finance_build",
    description: "Build the CFO stack artifacts from normalized bank, validation, and invoice-match context under VBOARD_DATA_ROOT. Fails closed when bank validation is missing or not ok.",
    inputSchema: {
      type: "object",
      properties: {
        contextDir: { type: "string", description: "Relative context directory, default ops/context" },
        outputDir: { type: "string", description: "Relative output directory, default finance" },
        strict: { type: "boolean", description: "Default true. When true, failed bank validation blocks accounting output." },
        allowUnverified: { type: "boolean", description: "Default false. Only use for explicit draft/debug runs." }
      },
      additionalProperties: false
    }
  },
  {
    name: "vboard_finance_status",
    description: "Read the latest CFO stack report status from VBOARD_DATA_ROOT.",
    inputSchema: {
      type: "object",
      properties: {
        outputDir: { type: "string", description: "Relative output directory, default finance" }
      },
      additionalProperties: false
    }
  },
  {
    name: "vboard_finance_import_bank",
    description: "Import a bank reconciliation report JSON from VBOARD_DATA_ROOT into normalized CFO context. By default it remains unverified; set trustBankApi only for explicit working-pack generation.",
    inputSchema: {
      type: "object",
      properties: {
        reportPath: { type: "string", description: "Relative path to bank_receipt_reconcile*.json under VBOARD_DATA_ROOT" },
        contextDir: { type: "string", description: "Relative context directory, default ops/context" },
        trustBankApi: { type: "boolean", description: "Default false. True marks the API snapshot as ready for CFO working-pack generation." },
        includeDryRunAttach: { type: "boolean", description: "Default false. True imports dry-run attach decisions as tentative invoice matches." },
        allowDebitOnly: { type: "boolean", description: "Default false. Only use for explicit expenses-only working packs." },
        openingBalance: { type: "number" },
        closingBalance: { type: "number" }
      },
      required: ["reportPath"],
      additionalProperties: false
    }
  },
  {
    name: "vboard_finance_pull_bank",
    description: "Pull a full credit+debit bank API snapshot into normalized CFO context. Requires BANK_API_AUTH or BANK_API_LOGIN/BANK_API_SECRET in the environment.",
    inputSchema: {
      type: "object",
      properties: {
        contextDir: { type: "string", description: "Relative context directory, default ops/context" },
        since: { type: "string", description: "ISO date/time, default current year start" },
        openingBalance: { type: "number" },
        closingBalance: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "vboard_policy",
    description: "Returns the current routing policy constants: high-risk categories, local categories, restricted terms, commitment terms. Useful for callers to understand routing behaviour.",
    inputSchema: { type: "object", properties: {} }
  }
];

async function callTool(name, args, config, store) {
  switch (name) {
    case "vboard_route":
      return { content: textContent(classify(args || {})) };

    case "vboard_bridge":
      return { content: textContent(await routeOrBridge(args || {}, config)) };

    case "vboard_file_read":
      return { content: textContent({ ok: true, path: args.path, content: readText(config.dataRoot, args.path) }) };

    case "vboard_file_write":
      return { content: textContent({ ok: true, ...writeText(config.dataRoot, args.path, args.content || "") }) };

    case "vboard_file_list":
      return { content: textContent({ ok: true, entries: listFiles(config.dataRoot, args.path || ".") }) };

    case "vboard_work_order_create":
      return { content: textContent({ ok: true, workOrder: store.create(args || {}) }) };

    case "vboard_work_order_list":
      return {
        content: textContent({
          ok: true,
          workOrders: store.list({
            limit: args && args.limit,
            project: args && args.project,
            status: args && args.status
          })
        })
      };

    case "vboard_health":
      return {
        content: textContent({
          ok: true,
          service: "vboard-ops-core",
          version: "0.1.0",
          dataRoot: config.dataRoot,
          councilConfigured: Boolean(config.council.token),
          authConfigured: Boolean(config.api.token),
          time: new Date().toISOString()
        })
      };

    case "vboard_finance_build":
      return { content: textContent(buildCfoStack(config.dataRoot, args || {})) };

    case "vboard_finance_status":
      return { content: textContent(financeStatus(config.dataRoot, args || {})) };

    case "vboard_finance_import_bank":
      return {
        content: textContent(importBankReconciliation(config.dataRoot, args.reportPath, {
          restrictToDataRoot: true,
          contextDir: args.contextDir,
          trustBankApi: args.trustBankApi === true,
          includeDryRunAttach: args.includeDryRunAttach === true,
          allowDebitOnly: args.allowDebitOnly === true,
          openingBalance: args.openingBalance,
          closingBalance: args.closingBalance
        }))
      };

    case "vboard_finance_pull_bank":
      return {
        content: textContent(await pullBankSnapshot(config.dataRoot, {
          contextDir: args.contextDir,
          since: args.since,
          openingBalance: args.openingBalance,
          closingBalance: args.closingBalance
        }))
      };

    case "vboard_policy":
      return {
        content: textContent({
          ok: true,
          highRiskCategories: [...HIGH_RISK_CATEGORIES],
          localCategories: [...LOCAL_CATEGORIES],
          restrictedTerms: RESTRICTED_TERMS,
          commitmentTerms: COMMITMENT_TERMS,
          invariants: {
            council_may_send: false,
            council_prepares_only: true,
            runner_executes: true
          }
        })
      };

    default:
      return { isError: true, content: textContent({ ok: false, error: "UNKNOWN_TOOL", tool: name }) };
  }
}

function startMcpServer(config, input = process.stdin, output = process.stdout) {
  const store = new WorkOrderStore(config.dataRoot);
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", async (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
        continue;
      }
      const response = await handleRequest(request, config, store);
      if (response) output.write(`${JSON.stringify(response)}\n`);
    }
  });
}

async function handleRequest(request, config, store) {
  if (!store) store = new WorkOrderStore(config.dataRoot);
  const id = request.id == null ? null : request.id;
  try {
    if (request.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "vboard-ops-core", version: "0.1.0" }
        }
      };
    }
    if (request.method === "notifications/initialized") return null;
    if (request.method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOL_DEFS } };
    }
    if (request.method === "tools/call") {
      const params = request.params || {};
      return { jsonrpc: "2.0", id, result: await callTool(params.name, params.arguments || {}, config, store) };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  } catch (error) {
    return { jsonrpc: "2.0", id, error: { code: -32000, message: error.code || error.message } };
  }
}

module.exports = { startMcpServer, handleRequest, TOOL_DEFS };
