"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TOKEN_PREFIX = "azzco";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

function normalizeScopes(scopes) {
  if (Array.isArray(scopes)) return scopes.map((scope) => String(scope).trim()).filter(Boolean);
  return String(scopes || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function createApiKey({ name, scopes, prefix = TOKEN_PREFIX } = {}) {
  const keyId = randomId(6);
  const secret = crypto.randomBytes(32).toString("base64url");
  const token = `${prefix}_${keyId}_${secret}`;
  const createdAt = new Date().toISOString();
  const entry = {
    id: keyId,
    name: name || `key-${keyId}`,
    tokenHash: sha256(token),
    scopes: normalizeScopes(scopes),
    createdAt,
    status: "active"
  };
  return { token, entry };
}

function loadApiKeys({ file, json } = {}) {
  let raw = null;
  if (json) raw = json;
  if (!raw && file && fs.existsSync(file)) raw = fs.readFileSync(file, "utf8");
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.keys)) return parsed.keys;
  return [];
}

function saveApiKey(file, entry) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : { keys: [] };
  const keys = Array.isArray(current) ? current : Array.isArray(current.keys) ? current.keys : [];
  if (keys.some((item) => item.id === entry.id || item.tokenHash === entry.tokenHash)) {
    const error = new Error("API_KEY_ALREADY_EXISTS");
    error.code = "API_KEY_ALREADY_EXISTS";
    throw error;
  }
  keys.push(entry);
  fs.writeFileSync(target, `${JSON.stringify({ keys }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(target, 0o600); } catch {}
  return target;
}

function hasScope(granted, required) {
  const scopes = normalizeScopes(granted);
  if (!required || required.length === 0) return true;
  if (scopes.includes("*")) return true;
  return required.some((scope) => {
    if (scopes.includes(scope)) return true;
    const [head] = scope.split(":");
    return scopes.includes(`${head}:*`);
  });
}

function matchApiKey(token, keys) {
  if (!token) return null;
  const tokenHash = sha256(token);
  return (keys || []).find((entry) => entry.status !== "disabled" && entry.tokenHash === tokenHash) || null;
}

module.exports = {
  createApiKey,
  loadApiKeys,
  saveApiKey,
  hasScope,
  matchApiKey,
  normalizeScopes,
  sha256
};
