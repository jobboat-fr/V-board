"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");
const { compactEvidence } = require("./compactEvidence");
const { classify } = require("./routePolicy");

function requestJson(url, token, payload, timeoutMs) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const body = JSON.stringify(payload);
    const req = client.request({
      method: "POST",
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      timeout: timeoutMs,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        try {
          resolve({ ok, status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ ok: false, status: res.statusCode, error: "BAD_JSON_RESPONSE", raw: raw.slice(0, 1000) });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "COUNCIL_TIMEOUT" });
    });
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
    req.write(body);
    req.end();
  });
}

async function routeOrBridge(input, config) {
  const compact = compactEvidence(input, config.limits);
  const route = classify(compact);
  if (route.route !== "council_required") {
    return {
      ok: true,
      stage: "route",
      route,
      bridge_called: false,
      decision: {
        action: route.route === "runner_local" ? "runner_handle_locally" : "runner_review_first",
        owner_approval_required: route.policy.owner_approval_required,
        openclaw_allowed_actions: [],
        openclaw_blocked_actions: []
      },
      production_guard: {
        runner_executes: true,
        council_may_send: false,
        council_prepares_only: true
      }
    };
  }

  if (!config.council.token) {
    return {
      ok: false,
      stage: "bridge",
      route,
      bridge_called: false,
      error: "COUNCIL_TOKEN_MISSING",
      policy: {
        owner_approval_required: true,
        auto_send_allowed: false
      }
    };
  }

  const bridge = await requestJson(config.council.url, config.council.token, compact, config.council.timeoutMs);
  return {
    ok: Boolean(bridge.ok),
    stage: "bridge",
    route,
    bridge_called: true,
    bridge_status: bridge.status || null,
    bridge,
    production_guard: {
      runner_executes: true,
      council_may_send: false,
      council_prepares_only: true,
      execute_only_allowed_actions: true
    }
  };
}

module.exports = { routeOrBridge, requestJson };
