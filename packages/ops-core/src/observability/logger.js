"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const winston = require("winston");
const { appendEvent, logDir, readEvents, summarizeEvents } = require("./logStore");
const { shipEventToRestSink, eventSinkStatus } = require("./restEventSink");

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
    if (config.eventSink?.enabled !== false) {
      try {
        await shipEventToRestSink(config, clean);
      } catch (error) {
        logger.warn("event_sink.log_failed", { error: error.message, requestId: clean.requestId });
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
      eventSink: eventSinkStatus(config),
      serverName: config.observability?.serverName
    })
  };
}

module.exports = { createObservability };
