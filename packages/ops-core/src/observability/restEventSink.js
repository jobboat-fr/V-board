"use strict";

let lastEventSinkResult = {
  configured: false,
  ok: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null
};

function eventSinkConfigured(config) {
  return Boolean(config.eventSink?.url);
}

function rowFromEvent(event) {
  return {
    created_at: event.ts,
    server_name: event.server || null,
    event_type: event.eventType || "api.request",
    level: event.level || "info",
    request_id: event.requestId || null,
    method: event.method || null,
    path: event.path || null,
    status: event.status || null,
    duration_ms: event.durationMs || null,
    key_id: event.keyId || null,
    key_name: event.keyName || null,
    route: event.route || null,
    department: event.department || null,
    error: event.error || null,
    metadata: event.metadata || {}
  };
}

function authHeaders(config) {
  const token = config.eventSink?.token || "";
  if (!token) return {};
  const header = String(config.eventSink?.tokenHeader || "authorization").toLowerCase();
  return header === "authorization"
    ? { authorization: `Bearer ${token}` }
    : { [header]: token };
}

async function shipEventToRestSink(config, event) {
  lastEventSinkResult.configured = eventSinkConfigured(config);
  if (!lastEventSinkResult.configured) {
    return { skipped: true, reason: "EVENT_SINK_NOT_CONFIGURED" };
  }

  lastEventSinkResult.lastAttemptAt = new Date().toISOString();
  const response = await fetch(String(config.eventSink.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(config)
    },
    body: JSON.stringify(rowFromEvent(event))
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const message = `EVENT_SINK_INSERT_FAILED ${response.status}: ${text.slice(0, 500)}`;
    lastEventSinkResult.ok = false;
    lastEventSinkResult.lastError = message;
    throw new Error(message);
  }

  lastEventSinkResult.ok = true;
  lastEventSinkResult.lastSuccessAt = new Date().toISOString();
  lastEventSinkResult.lastError = null;
  return { ok: true };
}

function eventSinkStatus(config) {
  return {
    configured: eventSinkConfigured(config),
    urlConfigured: Boolean(config.eventSink?.url),
    tokenConfigured: Boolean(config.eventSink?.token),
    tokenHeader: config.eventSink?.tokenHeader || "authorization",
    ...lastEventSinkResult
  };
}

module.exports = {
  shipEventToRestSink,
  eventSinkStatus,
  eventSinkConfigured,
  rowFromEvent
};
