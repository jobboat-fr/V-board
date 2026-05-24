#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");

const target = process.env.TARGET;
const telegramTarget = process.env.TELEGRAM_TARGET || "8602607952";
const deliveryMode = (process.env.AZZCO_WHATSAPP_DELIVERY_MODE || "relay").toLowerCase();
if (!target) {
  console.error("TARGET is required");
  process.exit(2);
}

const body = fs.readFileSync(0, "utf8").trim() || "AZZCO runner produced an empty report.";
const max = 3200;
const chunks = [];
for (let i = 0; i < body.length; i += max) chunks.push(body.slice(i, i + max));

function sendDirectWhatsApp(message) {
  return spawnSync("openclaw", [
    "message",
    "send",
    "--channel",
    "whatsapp",
    "--target",
    target,
    "--message",
    message
  ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4
  });
}

function relayWhatsApp(message) {
  const prompt = [
    "Courier instruction: relay exactly the text between BEGIN_AZZCO_REPORT and END_AZZCO_REPORT to the owner on WhatsApp.",
    "Do not add, remove, summarize, translate, soften, or comment.",
    "BEGIN_AZZCO_REPORT",
    message,
    "END_AZZCO_REPORT"
  ].join("\n");
  return spawnSync("openclaw", [
    "agent",
    "--agent",
    "main",
    "--message",
    prompt,
    "--deliver",
    "--reply-channel",
    "whatsapp",
    "--reply-to",
    target,
    "--timeout",
    "240"
  ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8
  });
}

function sendTelegramFallback(message) {
  return spawnSync("openclaw", [
    "message",
    "send",
    "--channel",
    "telegram",
    "--target",
    telegramTarget,
    "--message",
    `[WhatsApp fallback]\n${message}`
  ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4
  });
}

function deliverWhatsApp(message) {
  if (deliveryMode === "direct" || deliveryMode === "direct_then_relay") {
    const direct = sendDirectWhatsApp(message);
    if (direct.status === 0 || deliveryMode === "direct") return direct;
    process.stderr.write("direct WhatsApp send failed; trying WhatsApp relay\n");
    return relayWhatsApp(message);
  }

  return relayWhatsApp(message);
}

let ok = true;
for (let i = 0; i < chunks.length; i += 1) {
  const prefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}]\n` : "";
  const message = prefix + chunks[i];
  let result = deliverWhatsApp(message);
  if (result.status !== 0) {
    process.stderr.write("WhatsApp relay failed; trying Telegram fallback\n");
    result = sendTelegramFallback(message);
  }
  if (result.status !== 0) {
    ok = false;
    process.stderr.write(result.stderr || result.stdout || `message send failed ${result.status}\n`);
  }
}

process.exit(ok ? 0 : 3);
