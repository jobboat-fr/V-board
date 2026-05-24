"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");

const WORKSPACE = process.env.AZZCO_WORKSPACE || "/workspace";
const ROUTE_SCRIPT = process.env.AZZCO_ROUTE_SCRIPT || `${WORKSPACE}/bin/azzco_route_policy.js`;
const JOBS_PATH = process.env.AZZCO_JOBS_PATH || "/workspace/.openclaw/cron/jobs.json";
const RUNNER_ROOT = `${WORKSPACE}/ops/runner`;

function run(command, args, input = null, timeoutMs = 60000) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 5
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    error: result.error ? result.error.message : null,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

function runRoute(payload) {
  const result = run("node", [ROUTE_SCRIPT], JSON.stringify(payload), 30000);
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { ok: false, error: "ROUTE_BAD_OUTPUT", stdoutHead: result.stdout.slice(0, 500), stderrHead: result.stderr.slice(0, 500) };
  }
}

function readCronJobs() {
  try {
    const raw = JSON.parse(fs.readFileSync(JOBS_PATH, "utf8"));
    const jobs = Array.isArray(raw) ? raw : Object.values(raw.jobs || raw);
    return jobs.filter((job) => job && job.name);
  } catch (error) {
    return { error: error.message };
  }
}

function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readRunnerStatus(category) {
  const status = readJsonFile(`${RUNNER_ROOT}/last_${category}.json`);
  if (!status) return { category, ok: false, error: "missing_runner_status" };
  return {
    category,
    ok: status.status === "ok" && status.deliveryStatus === "delivered",
    runId: status.runId,
    status: status.status,
    deliveryStatus: status.deliveryStatus,
    generatedAt: status.generatedAt,
    reportPath: status.reportPath,
    execution: status.execution
  };
}

function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ ok: false, status: res.statusCode, body: body.slice(0, 500) });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "HTTP_TIMEOUT" });
    });
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
  });
}

async function main() {
  const routeTests = [
    {
      name: "cold_low_runner",
      expect: "runner_local",
      payload: {
        category: "cold_email_campaign",
        urgency: "P3",
        owner: true,
        temperature: 20,
        mail_label: "cold_mail",
        prompt: "Cold prospection with verified public website, no commitment.",
        lead: { email: "test@example.com", website: "https://example.com" }
      }
    },
    {
      name: "hot_sales_ovh",
      expect: "council_required",
      payload: {
        category: "sales_reply",
        urgency: "P2",
        owner: true,
        temperature: 85,
        mail_label: "hot_mail",
        prompt: "Hot lead asks for pricing, proposal, demo, and signature this week."
      }
    },
    {
      name: "legal_ovh",
      expect: "council_required",
      payload: {
        category: "legal_accounting",
        urgency: "P1",
        owner: true,
        prompt: "Check legal, bank, invoice and fiscal risk."
      }
    },
    {
      name: "morning_brief_ovh",
      expect: "council_required",
      payload: {
        category: "morning_brief",
        urgency: "P2",
        owner: true,
        prompt: "Morning brief from operational, mail, finance, CRM, and CTO evidence."
      }
    },
    {
      name: "mail_triage_ovh",
      expect: "council_required",
      payload: {
        category: "mail_triage",
        urgency: "P2",
        owner: true,
        prompt: "Mail triage from inbox snapshot, with finance/legal/security labels."
      }
    },
    {
      name: "legal_finance_sentinel_ovh",
      expect: "council_required",
      payload: {
        category: "legal_finance_sentinel",
        urgency: "P1",
        owner: true,
        prompt: "Legal finance sentinel: missing invoices, bank, tax, legal, fiscal and social risk."
      }
    },
    {
      name: "invoice_reconciliation_ovh",
      expect: "council_required",
      payload: {
        category: "invoice_reconciliation",
        urgency: "P2",
        owner: true,
        prompt: "Reconcile bank transactions, receipts, invoices and Qonto evidence."
      }
    },
    {
      name: "cto_audit_ovh",
      expect: "council_required",
      payload: {
        category: "cto_audit",
        urgency: "P2",
        owner: true,
        prompt: "Audit council, runner, Vercel, Railway, security, deployment, uptime and cost risk."
      }
    },
    {
      name: "deal_desk_ovh",
      expect: "council_required",
      payload: {
        category: "deal_desk",
        urgency: "P2",
        owner: true,
        temperature: 82,
        mail_label: "hot_mail",
        prompt: "Deal desk for hot lead asking pricing, proposal, meeting, and signature."
      }
    },
    {
      name: "approval_queue_ovh",
      expect: "council_required",
      payload: {
        category: "approval_queue",
        urgency: "P2",
        owner: true,
        prompt: "Review pending approvals, blocked sends, owner decisions, and hot replies."
      }
    },
    {
      name: "non_owner_restricted_ovh",
      expect: "council_required",
      payload: {
        category: "daily_communications",
        urgency: "P3",
        owner: false,
        prompt: "Non-owner asks for bank statements, legal documents, tokens, invoices and internal files."
      }
    },
    {
      name: "crm_low_local",
      expect: "runner_local",
      payload: {
        category: "crm_pipeline",
        urgency: "P3",
        owner: true,
        temperature: 20,
        prompt: "Low temperature CRM hygiene: update lead stage note and follow-up reminder."
      }
    }
  ].map((test) => {
    const route = runRoute(test.payload);
    return { name: test.name, ok: route.ok && route.route === test.expect, expect: test.expect, got: route.route, reasons: route.reasons || [] };
  });

  const jobs = readCronJobs();
  const cronRows = Array.isArray(jobs)
    ? jobs.filter((job) => job.enabled && job.name.startsWith("AZZCO")).map((job) => {
      const message = job.payload?.message || "";
      return {
        name: job.name,
        has_route_gate: message.includes("azzco_route_policy.js") || message.includes("azzco_route_or_bridge.js"),
        has_task_division: message.includes("hostinger_ovh_task_division.md"),
        delivery: `${job.delivery?.channel || "none"}:${job.delivery?.to || "none"}`,
        last_status: job.state?.lastRunStatus || job.state?.lastStatus || null,
        consecutive_errors: job.state?.consecutiveErrors || 0,
        timeout_seconds: job.payload?.timeoutSeconds || null
      };
    })
    : [];

  const channels = run("openclaw", ["channels", "status", "--probe"], null, 90000);
  const status = run("openclaw", ["status"], null, 90000);
  const activeModel = run("openclaw", ["models", "status", "--plain"], null, 90000);
  const fallbacks = run("openclaw", ["models", "fallbacks", "list"], null, 90000);
  const ovh = await httpGetJson(process.env.AZZCO_COUNCIL_HEALTH_URL || "http://127.0.0.1:8787/health");
  const runnerCategories = [
    "morning_brief",
    "mail_triage",
    "cto_audit",
    "legal_finance_sentinel",
    "invoice_reconciliation",
    "lead_scout",
    "crm_pipeline",
    "deal_desk",
    "approval_queue",
    "incident_watchdog",
    "owner_decision_meeting"
  ];
  const runner = runnerCategories.map(readRunnerStatus);

  const failures = [];
  for (const test of routeTests) if (!test.ok) failures.push(`route:${test.name}`);
  if (cronRows.some((row) => !row.has_route_gate || !row.has_task_division)) failures.push("cron_gate_missing");
  if (!channels.ok) failures.push("channels_probe_failed");
  if (!ovh.ok) failures.push("ovh_health_failed");
  if (!activeModel.ok || /moonshotai\/Kimi-K2\.5/.test(activeModel.stdout)) failures.push("active_model_bad_or_missing");
  if (!fallbacks.ok || !/Fallbacks \([1-9]/.test(fallbacks.stdout)) failures.push("model_fallbacks_missing");
  for (const row of runner) if (!row.ok) failures.push(`runner:${row.category}`);

  console.log(JSON.stringify({
    ok: failures.length === 0,
    generated_at: new Date().toISOString(),
    failures,
    route_tests: routeTests,
    ovh_health: ovh,
    hostinger: {
      status_ok: status.ok,
      channels_probe_ok: channels.ok,
      channels_probe_contains_whatsapp_healthy: /WhatsApp.*health:healthy|WhatsApp.*healthy/s.test(channels.stdout),
      channels_probe_contains_telegram_works: /Telegram.*works/s.test(channels.stdout),
      active_model: activeModel.stdout.trim().split("\n")[0],
      fallbacks_head: fallbacks.stdout.slice(0, 1000),
      status_head: status.stdout.slice(0, 1500),
      channels_head: channels.stdout.slice(0, 2000)
    },
    runner,
    cron: {
      total_azzco_enabled: cronRows.length,
      all_have_route_gate: cronRows.every((row) => row.has_route_gate),
      all_have_task_division: cronRows.every((row) => row.has_task_division),
      rows: cronRows
    }
  }, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
});
