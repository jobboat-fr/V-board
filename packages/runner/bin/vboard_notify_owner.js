"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");

const OWNER_WHATSAPP = process.env.VBOARD_OWNER_WHATSAPP || "";
const OWNER_TELEGRAM = process.env.VBOARD_OWNER_TELEGRAM || "";
const DEFAULT_MODEL = process.env.VBOARD_NOTIFY_MODEL || "fallback/default-chat-model";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readMessage() {
  const direct = arg("--message");
  if (direct) return direct;
  const file = arg("--file");
  if (file) return fs.readFileSync(file, "utf8");
  return fs.readFileSync(0, "utf8");
}

function run(command, args, timeoutMs = 60000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 3
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    error: result.error ? result.error.message : null,
    stdout: String(result.stdout || "").slice(0, 2000),
    stderr: String(result.stderr || "").slice(0, 2000)
  };
}

function sendMessage(channel, target, message) {
  return run("agent_runtime", ["message", "send", "--channel", channel, "--target", target, "--message", message], 90000);
}

function queueWhatsappCron(message, priority) {
  const name = `VBOARD owner notify ${priority} ${Date.now()}`;
  const prompt = [
    "Reply exactly with this owner notification. Do not analyze, expand, or add anything:",
    message
  ].join("\n\n");
  return run("agent_runtime", [
    "cron", "add",
    "--name", name,
    "--at", "1m",
    "--session", "isolated",
    "--model", DEFAULT_MODEL,
    "--light-context",
    "--announce",
    "--channel", "whatsapp",
    "--to", OWNER_WHATSAPP,
    "--message", prompt
  ], 120000);
}

function main() {
  const priority = arg("--priority", "P3").toUpperCase();
  const channel = arg("--channel", "auto");
  const dryRun = hasFlag("--dry-run");
  const queueWhatsapp = hasFlag("--queue-whatsapp") || ["P0", "P1"].includes(priority);
  const message = readMessage().trim();

  if (!message) {
    console.log(JSON.stringify({ ok: false, error: "EMPTY_MESSAGE" }, null, 2));
    process.exit(0);
  }

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      priority,
      channel,
      would_try: channel === "telegram" ? ["telegram"] : ["whatsapp_direct", "telegram_fallback", queueWhatsapp ? "whatsapp_cron_retry" : null].filter(Boolean),
      message_preview: message.slice(0, 500)
    }, null, 2));
    return;
  }

  const attempts = [];
  if (channel === "telegram") {
    attempts.push({ method: "telegram", result: sendMessage("telegram", OWNER_TELEGRAM, message) });
  } else {
    const whatsapp = sendMessage("whatsapp", OWNER_WHATSAPP, message);
    attempts.push({ method: "whatsapp_direct", result: whatsapp });
    if (!whatsapp.ok) {
      attempts.push({ method: "telegram_fallback", result: sendMessage("telegram", OWNER_TELEGRAM, message) });
      if (queueWhatsapp) {
        attempts.push({ method: "whatsapp_cron_retry", result: queueWhatsappCron(message, priority) });
      }
    }
  }

  const deliveredNow = attempts.some((item) => item.result.ok && item.method !== "whatsapp_cron_retry");
  const queued = attempts.some((item) => item.result.ok && item.method === "whatsapp_cron_retry");
  console.log(JSON.stringify({
    ok: deliveredNow || queued,
    delivered_now: deliveredNow,
    queued_whatsapp_retry: queued,
    priority,
    attempts: attempts.map((item) => ({
      method: item.method,
      ok: item.result.ok,
      status: item.result.status,
      error: item.result.error,
      stdout: item.result.stdout,
      stderr: item.result.stderr
    }))
  }, null, 2));
}

main();
