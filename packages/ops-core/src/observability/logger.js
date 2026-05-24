"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const winston = require("winston");
const { appendEvent, logDir, readEvents, summarizeEvents } = require("./logStore");
const { shipEventToSupabase, supabaseStatus } = require("./supabaseSink");

function createWinstonLogger(config) {
  const dir = logDir(config);
  fs.mkdirSync(dir, { recursive: true });
  return winston.createLogger({
    level: config.observability?.level || "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: {
      service: "vboard-ops-core",
      server: config.observability?.serverName || "unknown"
    },
    transports: [
      new winston.transports.File({ filename: path.join(dir, "api.log"), maxsize: 5 * 1024 * 1024, maxFiles: 5 }),
      new winston.transports.File({ filename: path.join(dir, "api-error.log"), level: "error", maxsize: 5 * 1024 * 1024, maxFiles: 5 })
    ]
  });
}

function createObservability(config) {
  const logger = createWinstonLogger(config);

  async function record(event) {
    const clean = appendEvent(config, {
      id: event.id || crypto.randomUUID(),
      ts: event.ts || new Date().toISOString(),
      server: config.observability?.serverName,
      ...event
    });
    logger.log(clean.level || "info", clean.eventType || "api.event", clean);
    if (config.supabase?.enabled !== false) {
      try {
        await shipEventToSupabase(config, clean);
      } catch (error) {
        logger.warn("supabase.log_failed", { error: error.message, requestId: clean.requestId });
      }
    }
    return clean;
  }

  return {
    logger,
    record,
    readEvents: (options) => readEvents(config, options),
    summary: () => ({
      ...summarizeEvents(config),
      supabase: supabaseStatus(config),
      serverName: config.observability?.serverName
    })
  };
}

module.exports = { createObservability };
