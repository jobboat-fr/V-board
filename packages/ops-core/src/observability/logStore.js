"use strict";

const fs = require("fs");
const path = require("path");

function logDir(config) {
  return path.resolve(config.observability?.logDir || path.join(config.dataRoot, "ops", "logs"));
}

function eventsFile(config) {
  return path.join(logDir(config), "api-events.jsonl");
}

function ensureLogDir(config) {
  fs.mkdirSync(logDir(config), { recursive: true });
}

function safeString(value, max = 500) {
  if (value == null) return "";
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}...[TRUNCATED]` : text;
}

function sanitizeEvent(event) {
  return {
    id: safeString(event.id, 80),
    ts: event.ts || new Date().toISOString(),
    server: safeString(event.server, 120),
    level: safeString(event.level || "info", 20),
    eventType: safeString(event.eventType || event.type || "api.request", 120),
    requestId: safeString(event.requestId, 120),
    method: safeString(event.method, 12),
    path: safeString(event.path, 300),
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : undefined,
    durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : undefined,
    keyId: safeString(event.keyId, 120),
    keyName: safeString(event.keyName, 120),
    route: safeString(event.route, 120),
    department: safeString(event.department, 120),
    error: safeString(event.error, 500),
    metadata: typeof event.metadata === "object" && event.metadata ? event.metadata : {}
  };
}

function appendEvent(config, event) {
  ensureLogDir(config);
  const clean = sanitizeEvent(event);
  fs.appendFileSync(eventsFile(config), `${JSON.stringify(clean)}\n`, "utf8");
  return clean;
}

function readEvents(config, { limit = 100 } = {}) {
  const file = eventsFile(config);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-Math.max(1, Math.min(Number(limit) || 100, 1000))).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { ts: new Date().toISOString(), level: "error", eventType: "log.parse_error", raw: line.slice(0, 500) };
    }
  }).reverse();
}

function summarizeEvents(config) {
  const file = eventsFile(config);
  const events = readEvents(config, { limit: 1000 });
  const now = Date.now();
  const lastHour = events.filter((event) => now - Date.parse(event.ts || 0) <= 60 * 60 * 1000);
  const byStatus = {};
  const byRoute = {};
  const byKey = {};
  for (const event of events) {
    const status = event.status ? String(event.status) : "n/a";
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (event.route) byRoute[event.route] = (byRoute[event.route] || 0) + 1;
    if (event.keyName) byKey[event.keyName] = (byKey[event.keyName] || 0) + 1;
  }
  const errors = events.filter((event) => Number(event.status) >= 500 || event.level === "error");
  return {
    ok: true,
    logsPath: file,
    logsExist: fs.existsSync(file),
    logBytes: fs.existsSync(file) ? fs.statSync(file).size : 0,
    totalEvents: events.length,
    lastHourEvents: lastHour.length,
    errorEvents: errors.length,
    latestEventAt: events[0]?.ts || null,
    byStatus,
    byRoute,
    byKey,
    recentErrors: errors.slice(0, 10)
  };
}

module.exports = {
  appendEvent,
  readEvents,
  summarizeEvents,
  eventsFile,
  logDir,
  sanitizeEvent
};
