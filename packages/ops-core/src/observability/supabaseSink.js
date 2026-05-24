"use strict";

let lastSupabaseResult = {
  configured: false,
  ok: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null
};

function supabaseConfigured(config) {
  return Boolean(config.supabase?.url && config.supabase?.serviceRoleKey && config.supabase?.eventsTable);
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

async function shipEventToSupabase(config, event) {
  lastSupabaseResult.configured = supabaseConfigured(config);
  if (!lastSupabaseResult.configured) return { skipped: true, reason: "SUPABASE_NOT_CONFIGURED" };

  lastSupabaseResult.lastAttemptAt = new Date().toISOString();
  const url = `${String(config.supabase.url).replace(/\/$/, "")}/rest/v1/${encodeURIComponent(config.supabase.eventsTable)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: config.supabase.serviceRoleKey,
      authorization: `Bearer ${config.supabase.serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=minimal"
    },
    body: JSON.stringify(rowFromEvent(event))
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const message = `SUPABASE_INSERT_FAILED ${response.status}: ${text.slice(0, 500)}`;
    lastSupabaseResult.ok = false;
    lastSupabaseResult.lastError = message;
    throw new Error(message);
  }
  lastSupabaseResult.ok = true;
  lastSupabaseResult.lastSuccessAt = new Date().toISOString();
  lastSupabaseResult.lastError = null;
  return { ok: true };
}

function supabaseStatus(config) {
  return {
    configured: supabaseConfigured(config),
    urlConfigured: Boolean(config.supabase?.url),
    table: config.supabase?.eventsTable || null,
    serviceRoleConfigured: Boolean(config.supabase?.serviceRoleKey),
    anonConfigured: Boolean(config.supabase?.anonKey),
    ...lastSupabaseResult
  };
}

module.exports = {
  shipEventToSupabase,
  supabaseStatus,
  supabaseConfigured
};
