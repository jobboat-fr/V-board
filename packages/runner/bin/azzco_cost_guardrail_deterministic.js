#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || "/data/.openclaw";
const OWNER_WHATSAPP = process.env.AZZCO_OWNER_WHATSAPP || "";
const OWNER_TELEGRAM = process.env.AZZCO_OWNER_TELEGRAM || "8602607952";
const DAILY_TOKEN_WARN = Number(process.env.AZZCO_DAILY_TOKEN_WARN || 750000);
const SINGLE_RUN_INPUT_WARN = Number(process.env.AZZCO_SINGLE_RUN_INPUT_WARN || 200000);
const SMALL_MODEL_INPUT_WARN = Number(process.env.AZZCO_SMALL_MODEL_INPUT_WARN || 100000);
const LOOKBACK_MS = Number(process.env.AZZCO_GUARDRAIL_LOOKBACK_MS || 24 * 60 * 60 * 1000);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonl(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function last(arr) {
  return arr.length ? arr[arr.length - 1] : null;
}

function fmtInt(n) {
  return Math.round(Number(n || 0)).toLocaleString("en-US");
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "n/a";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function isSmallModel(model = "") {
  return /qwen3\.5-9b|gpt-oss-20b|gemma.*(9b|12b)/i.test(model);
}

function jobNameById(jobs) {
  const map = new Map();
  for (const job of jobs) map.set(job.id, job.name || job.id);
  return map;
}

function buildReport() {
  const now = Date.now();
  const since = now - LOOKBACK_MS;
  const jobsPath = path.join(STATE_DIR, "cron", "jobs.json");
  const runsDir = path.join(STATE_DIR, "cron", "runs");
  const jobsDoc = readJson(jobsPath, { jobs: [] });
  const jobs = Array.isArray(jobsDoc.jobs) ? jobsDoc.jobs : [];
  const names = jobNameById(jobs);

  const allRuns = [];
  for (const job of jobs) {
    const file = path.join(runsDir, `${job.id}.jsonl`);
    for (const run of readJsonl(file)) {
      if (run.action === "finished" && Number(run.ts || 0) >= since) {
        allRuns.push({
          ...run,
          jobName: names.get(run.jobId) || run.jobId
        });
      }
    }
  }

  const failures = allRuns.filter((run) => run.status !== "ok");
  const usageRuns = allRuns.filter((run) => run.usage);
  const totalInput = usageRuns.reduce((sum, run) => sum + Number(run.usage?.input_tokens || 0), 0);
  const totalOutput = usageRuns.reduce((sum, run) => sum + Number(run.usage?.output_tokens || 0), 0);
  const byModel = new Map();
  for (const run of usageRuns) {
    const key = `${run.provider || "unknown"}/${run.model || "unknown"}`;
    const current = byModel.get(key) || { input: 0, output: 0, runs: 0 };
    current.input += Number(run.usage?.input_tokens || 0);
    current.output += Number(run.usage?.output_tokens || 0);
    current.runs += 1;
    byModel.set(key, current);
  }

  const hugeRuns = usageRuns
    .filter((run) => Number(run.usage?.input_tokens || 0) >= SINGLE_RUN_INPUT_WARN)
    .sort((a, b) => Number(b.usage?.input_tokens || 0) - Number(a.usage?.input_tokens || 0));
  const smallModelHugeRuns = hugeRuns.filter((run) => isSmallModel(run.model) && Number(run.usage?.input_tokens || 0) >= SMALL_MODEL_INPUT_WARN);
  const longRuns = allRuns
    .filter((run) => Number(run.durationMs || 0) >= 300000)
    .sort((a, b) => Number(b.durationMs || 0) - Number(a.durationMs || 0));

  let status = "LOW";
  if (failures.length || totalInput >= DAILY_TOKEN_WARN || smallModelHugeRuns.length) status = "HIGH";
  else if (hugeRuns.length || longRuns.length) status = "MEDIUM";

  const topModels = [...byModel.entries()]
    .sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))
    .slice(0, 5)
    .map(([model, u]) => `- ${model}: ${fmtInt(u.input)} in / ${fmtInt(u.output)} out across ${u.runs} run(s)`);

  const topFailures = failures.slice(-6).map((run) => {
    const err = String(run.error || run.summary || "unknown error").replace(/\s+/g, " ").slice(0, 180);
    return `- ${run.jobName}: ${err}`;
  });

  const topHuge = hugeRuns.slice(0, 6).map((run) => {
    return `- ${run.jobName}: ${fmtInt(run.usage?.input_tokens)} input tokens on ${run.provider || "?"}/${run.model || "?"} (${fmtDuration(run.durationMs)})`;
  });

  const recommendations = [];
  if (smallModelHugeRuns.length) recommendations.push("Do not run Qwen 9B on huge cron contexts; use deterministic collectors or a stronger model after compaction.");
  if (failures.length) recommendations.push("Patch failing crons before trusting green reports; failed jobs are cost leakage plus operational blind spots.");
  if (hugeRuns.length) recommendations.push("Disable global MCP/tool loading for non-platform jobs, especially Vercel/Railway schemas.");
  if (!recommendations.length) recommendations.push("No immediate cost action required; continue monitoring.");

  return [
    `AZZCO Deterministic Cost Guardrail`,
    `Window: last 24h`,
    `Status: ${status}`,
    ``,
    `Evidence [EMP]:`,
    `- Finished cron runs inspected: ${allRuns.length}`,
    `- Failed runs: ${failures.length}`,
    `- Usage-bearing runs: ${usageRuns.length}`,
    `- Total observed model tokens: ${fmtInt(totalInput)} input / ${fmtInt(totalOutput)} output`,
    `- Huge-context runs >= ${fmtInt(SINGLE_RUN_INPUT_WARN)} input tokens: ${hugeRuns.length}`,
    ``,
    `Top model usage:`,
    ...(topModels.length ? topModels : ["- No usage records found."]),
    ``,
    `Failures:`,
    ...(topFailures.length ? topFailures : ["- None observed in this window."]),
    ``,
    `Cost leaks / oversized jobs:`,
    ...(topHuge.length ? topHuge : ["- None above threshold."]),
    ``,
    `Recommended action:`,
    ...recommendations.map((line) => `- ${line}`),
    ``,
    `Reliability: deterministic; no LLM used.`
  ].join("\n");
}

function sendWhatsApp(message) {
  try {
    execFileSync(
      "openclaw",
      ["message", "send", "--channel", "whatsapp", "--target", OWNER_WHATSAPP, "--message", message],
      { stdio: "inherit" }
    );
    return "whatsapp";
  } catch (error) {
    console.error(`[warn] WhatsApp delivery failed: ${error.message}`);
  }

  try {
    execFileSync(
      "openclaw",
      ["message", "send", "--channel", "telegram", "--target", OWNER_TELEGRAM, "--message", message],
      { stdio: "inherit" }
    );
    return "telegram";
  } catch (error) {
    console.error(`[warn] Telegram fallback delivery failed: ${error.message}`);
  }

  return "none";
}

const report = buildReport();
console.log(report);

if (process.argv.includes("--send")) {
  const channel = sendWhatsApp(report);
  console.log(`Delivery result: ${channel}`);
}
