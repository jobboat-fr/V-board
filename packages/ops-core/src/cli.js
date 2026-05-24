#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { getConfig } = require("./config/defaults");
const { startServer } = require("./server/httpServer");
const { startMcpServer } = require("./mcp/server");
const { classify } = require("./core/routePolicy");
const { routeOrBridge } = require("./core/bridgeClient");
const { resolveSafe } = require("./core/safeFs");
const { buildCfoStack, financeStatus, importQontoReconciliation } = require("./finance/cfoStack");
const { pullQontoSnapshot } = require("./finance/qontoApi");
const { createApiKey, saveApiKey } = require("./server/apiKeys");

function readStdinJson() {
  const raw = fs.readFileSync(0, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

const DOCTOR_FIXTURES = [
  // should be hostinger_local
  { name: "cold_local", expect: "hostinger_local", payload: { category: "cold_email_campaign", urgency: "P3", temperature: 20, mail_label: "cold_mail", owner: true, lead: { email: "test@example.com", website: "https://example.com" }, prompt: "Cold verified public source, no commitment." } },
  { name: "crm_routine", expect: "hostinger_local", payload: { category: "crm_pipeline", urgency: "P3", temperature: 20, owner: true, prompt: "Add CRM note." } },
  { name: "simple_chat_local", expect: "hostinger_local", payload: { category: "simple_chat", urgency: "P3", prompt: "hello" } },
  // should be ovh_required
  { name: "hot_sales_ovh", expect: "ovh_required", payload: { category: "sales_reply", urgency: "P2", temperature: 85, mail_label: "hot_mail", owner: true, prompt: "Hot lead asks for pricing and signature." } },
  { name: "legal_ovh", expect: "ovh_required", payload: { category: "legal_accounting", urgency: "P1", prompt: "Check urssaf tax dsn filing." } },
  { name: "incident_ovh", expect: "ovh_required", payload: { prompt: "p0 data leak breach server down active attack." } },
  { name: "restricted_ovh", expect: "ovh_required", payload: { urgency: "P3", temperature: 10, prompt: "Review contract statuts kbis." } },
  { name: "invoice_ovh", expect: "ovh_required", payload: { prompt: "invoice receipt bank transaction qonto." } },
  // should be review first
  { name: "cold_no_evidence", expect: "hostinger_review_first", payload: { category: "cold_email_campaign", urgency: "P3", temperature: 20, mail_label: "cold_mail", owner: true, prompt: "Cold campaign no lead data." } }
];

async function doctor(config) {
  const routeCases = DOCTOR_FIXTURES.map((test) => {
    const result = classify(test.payload);
    return { name: test.name, ok: result.route === test.expect, expected: test.expect, got: result.route };
  });

  // Invariant: ovh_may_send must always be false
  const invariantCases = DOCTOR_FIXTURES.map((test) => {
    const result = classify(test.payload);
    return { name: `${test.name}_ovh_may_send`, ok: result.policy.ovh_may_send === false };
  });

  // Infra guards
  const guards = [];

  const apiAuthConfigured = Boolean(config.api.token || config.api.keysFile || config.api.keysJson);
  if (!apiAuthConfigured && process.env.NODE_ENV === "production") {
    guards.push({ name: "api_auth_required_in_production", ok: false, detail: "AZZCO_API_TOKEN not set" });
  } else {
    guards.push({ name: "api_auth", ok: true, detail: apiAuthConfigured ? "configured" : "not set (dev mode)" });
  }

  guards.push({ name: "council_token", ok: true, detail: config.council.token ? "configured" : "not set (ovh_required flows will return COUNCIL_TOKEN_MISSING)" });

  try {
    resolveSafe(config.dataRoot, ".");
    guards.push({ name: "data_root_accessible", ok: true, detail: config.dataRoot });
  } catch {
    guards.push({ name: "data_root_accessible", ok: false, detail: `Cannot access dataRoot: ${config.dataRoot}` });
  }

  // Owner contact check
  guards.push({
    name: "owner_whatsapp",
    ok: Boolean(config.owner && config.owner.whatsapp),
    detail: config.owner && config.owner.whatsapp ? "configured" : "not set — incident notifications won't reach owner"
  });

  const allCases = [...routeCases, ...invariantCases];
  const allOk = allCases.every((c) => c.ok) && guards.filter((g) => g.name !== "owner_whatsapp" && g.name !== "council_token").every((g) => g.ok);

  return {
    ok: allOk,
    routeCases,
    invariantCases,
    guards,
    config: {
      dataRoot: config.dataRoot,
      councilConfigured: Boolean(config.council.token),
      apiAuthConfigured
    }
  };
}

async function main() {
  const command = process.argv[2] || "api";
  const config = getConfig();
  if (command === "api") return startServer(config);
  if (command === "mcp") return startMcpServer(config);
  if (command === "route") return process.stdout.write(`${JSON.stringify(classify(readStdinJson()), null, 2)}\n`);
  if (command === "bridge") return process.stdout.write(`${JSON.stringify(await routeOrBridge(readStdinJson(), config), null, 2)}\n`);
  if (command === "finance") {
    const subcommand = process.argv[3] || "build";
    if (subcommand === "status") {
      return process.stdout.write(`${JSON.stringify(financeStatus(config.dataRoot), null, 2)}\n`);
    }
    if (subcommand === "import-qonto") {
      const reportPath = process.argv[4];
      const result = importQontoReconciliation(config.dataRoot, reportPath, {
        trustQontoApi: process.argv.includes("--trust-qonto-api"),
        includeDryRunAttach: process.argv.includes("--include-dry-run-attach"),
        allowDebitOnly: process.argv.includes("--allow-debit-only")
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.ok) process.exitCode = 2;
      return;
    }
    if (subcommand === "pull-qonto") {
      const sinceIndex = process.argv.indexOf("--since");
      const since = sinceIndex >= 0 ? process.argv[sinceIndex + 1] : undefined;
      const result = await pullQontoSnapshot(config.dataRoot, { since });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (process.argv.includes("--build")) {
        const build = buildCfoStack(config.dataRoot);
        process.stdout.write(`${JSON.stringify(build, null, 2)}\n`);
        if (!build.ok) process.exitCode = 2;
      }
      return;
    }
    if (subcommand !== "build") {
      process.stderr.write(`Unknown finance subcommand: ${subcommand}\n`);
      process.exitCode = 1;
      return;
    }
    const result = buildCfoStack(config.dataRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 2;
    return;
  }
  if (command === "keys") {
    const subcommand = process.argv[3] || "generate";
    if (!["generate", "issue"].includes(subcommand)) {
      process.stderr.write(`Unknown keys subcommand: ${subcommand}\n`);
      process.exitCode = 1;
      return;
    }
    const nameIndex = process.argv.indexOf("--name");
    const scopesIndex = process.argv.indexOf("--scopes");
    const fileIndex = process.argv.indexOf("--file");
    const name = nameIndex >= 0 ? process.argv[nameIndex + 1] : "";
    const scopes = scopesIndex >= 0 ? process.argv[scopesIndex + 1] : "";
    const file = fileIndex >= 0 ? process.argv[fileIndex + 1] : config.api.keysFile;
    if (!name) {
      process.stderr.write("--name is required\n");
      process.exitCode = 1;
      return;
    }
    if (!scopes) {
      process.stderr.write("--scopes is required, example: route:read,crm:write\n");
      process.exitCode = 1;
      return;
    }
    const generated = createApiKey({ name, scopes });
    const response = {
      ok: true,
      name,
      scopes: generated.entry.scopes,
      token: generated.token,
      entry: generated.entry,
      warning: "Store this token now. Only tokenHash is safe to keep in the server key registry."
    };
    if (subcommand === "issue") {
      if (!file) {
        process.stderr.write("--file or AZZCO_API_KEYS_FILE is required for keys issue\n");
        process.exitCode = 1;
        return;
      }
      response.file = saveApiKey(file, generated.entry);
    }
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }
  if (command === "doctor") {
    const result = await doctor(config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  process.stderr.write(`Unknown command: ${command}\n`);
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
