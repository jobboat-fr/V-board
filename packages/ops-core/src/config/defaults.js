"use strict";

const path = require("path");
const os = require("os");

function env(name, fallback) {
  return process.env[name] || fallback;
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function getConfig(overrides = {}) {
  const dataRoot = path.resolve(overrides.dataRoot || env("VBOARD_DATA_ROOT", "./data"));
  return {
    api: {
      host: overrides.host || env("VBOARD_API_HOST", "127.0.0.1"),
      port: Number(overrides.port || intEnv("VBOARD_API_PORT", 8788)),
      token: overrides.token || env("VBOARD_API_TOKEN", ""),
      keysFile: overrides.keysFile || env("VBOARD_API_KEYS_FILE", ""),
      keysJson: overrides.keysJson || env("VBOARD_API_KEYS_JSON", "")
    },
    council: {
      url: overrides.councilUrl || env("VBOARD_COUNCIL_URL", "http://council:8787/route"),
      token: overrides.councilToken || env("VBOARD_COUNCIL_TOKEN", ""),
      timeoutMs: Number(overrides.councilTimeoutMs || intEnv("VBOARD_COUNCIL_TIMEOUT_MS", 120000))
    },
    owner: {
      whatsapp: overrides.ownerWhatsapp || env("VBOARD_OWNER_WHATSAPP", ""),
      telegram: overrides.ownerTelegram || env("VBOARD_OWNER_TELEGRAM", "")
    },
    limits: {
      maxEvidenceItems: Number(overrides.maxEvidenceItems || intEnv("VBOARD_MAX_EVIDENCE_ITEMS", 30)),
      maxTextChars: Number(overrides.maxTextChars || intEnv("VBOARD_MAX_TEXT_CHARS", 6000)),
      maxBodyBytes: Number(overrides.maxBodyBytes || intEnv("VBOARD_MAX_BODY_BYTES", 1024 * 1024))
    },
    observability: {
      serverName: overrides.serverName || env("VBOARD_SERVER_NAME", os.hostname()),
      logDir: overrides.logDir || env("VBOARD_LOG_DIR", path.join(dataRoot, "ops", "logs")),
      level: overrides.logLevel || env("VBOARD_LOG_LEVEL", "info")
    },
    eventSink: {
      enabled: (overrides.eventSinkEnabled ?? env("VBOARD_EVENT_SINK_ENABLED", "false")) !== "false",
      url: overrides.eventSinkUrl || env("VBOARD_EVENT_SINK_URL", ""),
      token: overrides.eventSinkToken || env("VBOARD_EVENT_SINK_TOKEN", ""),
      tokenHeader: overrides.eventSinkTokenHeader || env("VBOARD_EVENT_SINK_TOKEN_HEADER", "authorization")
    },
    dataRoot
  };
}

module.exports = { getConfig };
