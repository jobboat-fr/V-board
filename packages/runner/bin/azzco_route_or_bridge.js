"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");

const ROUTE_SCRIPT = "/data/.openclaw/workspace/bin/azzco_route_policy.js";
const BRIDGE_SCRIPT = "/data/.openclaw/workspace/bin/azzco_council_call.sh";

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function runJson(command, args, input, timeoutMs) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 10
  });
  if (result.error) {
    return {
      ok: false,
      error: result.error.code === "ETIMEDOUT" ? "COMMAND_TIMEOUT" : result.error.message,
      stderr: String(result.stderr || "").slice(0, 1000)
    };
  }
  const stdout = String(result.stdout || "").trim();
  try {
    return JSON.parse(stdout);
  } catch (error) {
    return {
      ok: false,
      error: `BAD_JSON_OUTPUT: ${error.message}`,
      stdoutHead: stdout.slice(0, 1000),
      stderrHead: String(result.stderr || "").slice(0, 1000)
    };
  }
}

function safePacket(input) {
  const packet = { ...input };
  if (Array.isArray(packet.evidence) && packet.evidence.length > 30) {
    packet.evidence = packet.evidence.slice(0, 30);
    packet.evidence_truncated = true;
  }
  for (const key of ["raw", "raw_document", "full_log", "full_inbox", "attachments_raw"]) {
    if (packet[key]) {
      packet[key] = "[REMOVED_BY_HOSTINGER_COMPACT_PACKET_GUARD]";
      packet.compacted = true;
    }
  }
  return packet;
}

function main() {
  const raw = readStdin().trim();
  let input;
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      error: `BAD_JSON: ${error.message}`,
      route: "blocked",
      owner_approval_required: true
    }, null, 2));
    return;
  }

  const compact = safePacket(input);
  const compactRaw = JSON.stringify(compact);
  const route = runJson("node", [ROUTE_SCRIPT], compactRaw, 30000);

  if (!route.ok) {
    console.log(JSON.stringify({
      ok: false,
      stage: "route",
      route,
      bridge_called: false,
      execution: {
        sender: "hostinger",
        communicator: "hostinger",
        hard_analysis: "blocked"
      },
      policy: {
        ovh_may_send: false,
        ovh_prepares_only: true,
        owner_approval_required: true
      }
    }, null, 2));
    return;
  }

  if (route.route !== "ovh_required") {
    console.log(JSON.stringify({
      ok: true,
      stage: "route",
      route,
      bridge_called: false,
      decision: {
        action: route.route === "hostinger_local" ? "hostinger_handle_locally" : "hostinger_review_first",
        owner_approval_required: route.policy?.owner_approval_required ?? true,
        openclaw_allowed_actions: [],
        openclaw_blocked_actions: []
      },
      production_guard: {
        hostinger_executes: true,
        ovh_may_send: false,
        ovh_prepares_only: true
      }
    }, null, 2));
    return;
  }

  const bridge = runJson(BRIDGE_SCRIPT, [], compactRaw, 180000);
  console.log(JSON.stringify({
    ok: Boolean(bridge.ok),
    stage: "bridge",
    route,
    bridge_called: true,
    bridge,
    production_guard: {
      hostinger_executes: true,
      ovh_may_send: false,
      ovh_prepares_only: true,
      execute_only_allowed_actions: true
    }
  }, null, 2));
}

main();
