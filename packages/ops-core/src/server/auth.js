"use strict";

const crypto = require("crypto");
const { hasScope, loadApiKeys, matchApiKey } = require("./apiKeys");

function isPublicPath(pathname) {
  return pathname === "/" || pathname === "/dashboard" || pathname === "/health";
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function scopeFor(method, pathname) {
  if (method === "POST" && pathname === "/v1/route") return ["route:read"];
  if (method === "POST" && pathname === "/v1/bridge") return ["bridge:write"];
  if (method === "POST" && pathname === "/v1/departments/dispatch") return ["department:dispatch"];
  if (method === "POST" && pathname === "/v1/files/read") return ["files:read"];
  if (method === "POST" && pathname === "/v1/files/write") return ["files:write"];
  if (method === "GET" && pathname === "/v1/files/list") return ["files:read"];
  if (method === "POST" && pathname === "/v1/work-orders") return ["work_orders:write"];
  if (method === "GET" && pathname === "/v1/work-orders") return ["work_orders:read"];
  if (method === "GET" && pathname === "/v1/finance/status") return ["finance:read"];
  if (method === "POST" && pathname === "/v1/finance/build") return ["finance:write"];
  if (method === "POST" && pathname === "/v1/finance/import-bank") return ["finance:write", "bank:import"];
  if (method === "POST" && pathname === "/v1/finance/pull-bank") return ["finance:write", "bank:pull"];
  if (method === "GET" && pathname === "/v1/observability/summary") return ["observability:read"];
  if (method === "GET" && pathname === "/v1/observability/events") return ["observability:read"];
  if (method === "GET" && pathname === "/v1/observability/supabase") return ["observability:read"];
  if (method === "POST" && pathname === "/v1/observability/test") return ["observability:write"];
  return [];
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function authorize(req, config, pathname) {
  if (isPublicPath(pathname)) return { ok: true };
  const requiredScopes = scopeFor(req.method, pathname);
  const token = bearerToken(req);
  const scopedAuthConfigured = Boolean(config.api.keysFile || config.api.keysJson);
  const keys = loadApiKeys({ file: config.api.keysFile, json: config.api.keysJson });
  const key = matchApiKey(token, keys);
  if (key) {
    if (!hasScope(key.scopes, requiredScopes)) {
      return { ok: false, status: 403, error: "INSUFFICIENT_SCOPE", requiredScopes, keyId: key.id };
    }
    return { ok: true, keyId: key.id, keyName: key.name, scopes: key.scopes };
  }
  if (config.api.token) {
    const header = req.headers.authorization || "";
    const expected = `Bearer ${config.api.token}`;
    return safeEqual(header, expected)
      ? { ok: true, keyId: "legacy-root", keyName: "legacy-root-token", scopes: ["*"] }
      : { ok: false, status: 401, error: "UNAUTHORIZED" };
  }
  if (scopedAuthConfigured) {
    return { ok: false, status: 401, error: "UNAUTHORIZED" };
  }
  if (!config.api.token) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, status: 401, error: "AUTH_NOT_CONFIGURED" };
    }
    return { ok: true, warning: "AUTH_TOKEN_NOT_SET" };
  }
}

module.exports = { authorize, scopeFor };
