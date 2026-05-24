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
  const dataRoot = path.resolve(overrides.dataRoot || env("AZZCO_DATA_ROOT", "./data"));
  return {
    api: {
      host: overrides.host || env("AZZCO_API_HOST", "127.0.0.1"),
      port: Number(overrides.port || intEnv("AZZCO_API_PORT", 8788)),
      token: overrides.token || env("AZZCO_API_TOKEN", ""),
      keysFile: overrides.keysFile || env("AZZCO_API_KEYS_FILE", ""),
      keysJson: overrides.keysJson || env("AZZCO_API_KEYS_JSON", "")
    },
    council: {
      url: overrides.councilUrl || env("AZZCO_COUNCIL_URL", "http://council:8787/route"),
      token: overrides.councilToken || env("AZZCO_COUNCIL_TOKEN", ""),
      timeoutMs: Number(overrides.councilTimeoutMs || intEnv("AZZCO_COUNCIL_TIMEOUT_MS", 120000))
    },
    owner: {
      whatsapp: overrides.ownerWhatsapp || env("AZZCO_OWNER_WHATSAPP", ""),
      telegram: overrides.ownerTelegram || env("AZZCO_OWNER_TELEGRAM", "")
    },
    limits: {
      maxEvidenceItems: Number(overrides.maxEvidenceItems || intEnv("AZZCO_MAX_EVIDENCE_ITEMS", 30)),
      maxTextChars: Number(overrides.maxTextChars || intEnv("AZZCO_MAX_TEXT_CHARS", 6000)),
      maxBodyBytes: Number(overrides.maxBodyBytes || intEnv("AZZCO_MAX_BODY_BYTES", 1024 * 1024))
    },
    observability: {
      serverName: overrides.serverName || env("AZZCO_SERVER_NAME", os.hostname()),
      logDir: overrides.logDir || env("AZZCO_LOG_DIR", path.join(dataRoot, "ops", "logs")),
      level: overrides.logLevel || env("AZZCO_LOG_LEVEL", "info")
    },
    supabase: {
      enabled: (overrides.supabaseEnabled ?? env("AZZCO_SUPABASE_ENABLED", "true")) !== "false",
      url: overrides.supabaseUrl || env("SUPABASE_URL", ""),
      anonKey: overrides.supabaseAnonKey || env("SUPABASE_ANON_KEY", ""),
      serviceRoleKey: overrides.supabaseServiceRoleKey || env("SUPABASE_SERVICE_ROLE_KEY", ""),
      eventsTable: overrides.supabaseEventsTable || env("AZZCO_SUPABASE_EVENTS_TABLE", "azzco_api_events")
    },
    dataRoot
  };
}

module.exports = { getConfig };
