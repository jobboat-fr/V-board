"use strict";

const crypto = require("crypto");
const http = require("http");
const { URL } = require("url");
const { classify } = require("../core/routePolicy");
const { routeOrBridge } = require("../core/bridgeClient");
const { WorkOrderStore } = require("../core/workOrderStore");
const { readText, writeText, listFiles } = require("../core/safeFs");
const { sendJson, sendHtml, readJson } = require("./json");
const { authorize } = require("./auth");
const { buildCfoStack, financeStatus, importBankReconciliation } = require("../finance/cfoStack");
const { pullBankSnapshot } = require("../finance/bankApi");
const { dashboardHtml } = require("./dashboard");
const { createObservability } = require("../observability/logger");

function wantsHtml(req) {
  return String(req.headers.accept || "").includes("text/html");
}

function createServer(config) {
  const store = new WorkOrderStore(config.dataRoot);
  const observability = createObservability(config);

  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    const eventContext = {
      requestId,
      method: req.method,
      path: requestUrl.pathname,
      metadata: {}
    };
    res.setHeader("x-request-id", requestId);
    res.on("finish", () => {
      observability.record({
        ...eventContext,
        level: res.statusCode >= 500 ? "error" : "info",
        eventType: "api.request",
        status: res.statusCode,
        durationMs: Date.now() - startedAt
      }).catch(() => {});
    });

    if (req.method === "GET" && ["/", "/dashboard"].includes(requestUrl.pathname)) {
      return sendHtml(res, 200, dashboardHtml());
    }
    if (req.method === "GET" && requestUrl.pathname === "/v1/departments/dispatch" && wantsHtml(req)) {
      return sendHtml(res, 200, dashboardHtml());
    }

    const auth = authorize(req, config, requestUrl.pathname);
    eventContext.keyId = auth.keyId;
    eventContext.keyName = auth.keyName;
    if (!auth.ok) {
      eventContext.error = auth.error;
      return sendJson(res, auth.status, { ok: false, error: auth.error, requestId });
    }

    try {
      if (req.method === "GET" && requestUrl.pathname === "/health") {
        return sendJson(res, 200, {
          ok: true,
          service: "vboard-ops-core",
          version: "0.1.0",
          role: "runner-operator-or-council-gateway",
          serverName: config.observability.serverName,
          time: new Date().toISOString()
        });
      }

      if (req.method === "GET" && requestUrl.pathname === "/ready") {
        return sendJson(res, 200, {
          ok: true,
          councilConfigured: Boolean(config.council.token),
          authConfigured: Boolean(config.api.token || config.api.keysFile || config.api.keysJson),
          observabilityConfigured: true,
          supabaseConfigured: Boolean(config.supabase.url && config.supabase.serviceRoleKey)
        });
      }

      if (req.method === "POST" && requestUrl.pathname === "/v1/route") {
        const body = await readJson(req, config.limits.maxBodyBytes);
        const result = classify(body);
        eventContext.route = result.route;
        eventContext.metadata.category = result.category;
        return sendJson(res, 200, result);
      }

      if (req.method === "POST" && requestUrl.pathname === "/v1/bridge") {
        const body = await readJson(req, config.limits.maxBodyBytes);
        const result = await routeOrBridge(body, config);
        eventContext.route = result.route?.route || result.route || result.decision?.route;
        eventContext.metadata.bridge = true;
        return sendJson(res, 200, result);
      }

      if (req.method === "POST" && requestUrl.pathname === "/v1/departments/dispatch") {
        const body = await readJson(req, config.limits.maxBodyBytes);
        const department = String(body.department || "").trim();
        if (!department) return sendJson(res, 400, { ok: false, error: "DEPARTMENT_REQUIRED" });
        const payload = {
          ...body.payload,
          department,
          category: body.category || body.payload?.category || department,
          urgency: body.urgency || body.payload?.urgency || "P3",
          prompt: body.prompt || body.payload?.prompt || `Department dispatch: ${department}`
        };
        const route = classify(payload);
        eventContext.route = route.route;
        eventContext.department = department;
        eventContext.metadata.category = route.category;
        const result = route.route === "council_required"
          ? await routeOrBridge(payload, config)
          : { ok: true, route, action: "runner_handle_locally", department };
        return sendJson(res, 200, { ok: true, department, route, result });
      }

      if (req.method === "GET" && requestUrl.pathname === "/v1/observability/summary") {
        return sendJson(res, 200, observability.summary());
      }

      if (req.method === "GET" && requestUrl.pathname === "/v1/observability/events") {
        const limit = Number(requestUrl.searchParams.get("limit") || 100);
        return sendJson(res, 200, { ok: true, events: observability.readEvents({ limit }) });
      }

      if (req.method === "GET" && requestUrl.pathname === "/v1/observability/supabase") {
        return sendJson(res, 200, { ok: true, supabase: observability.summary().supabase });
      }

      if (req.method === "POST" && requestUrl.pathname === "/v1/observability/test") {
        const body = await readJson(req, config.limits.maxBodyBytes);
        const event = await observability.record({
          level: "info",
          eventType: "observability.test",
          requestId,
          keyId: auth.keyId,
          keyName: auth.keyName,
          metadata: { source: body.source || "api" }
        });
        return sendJson(res, 200, { ok: true, event });
      }

      if (req.method === "POST" && requestUrl.pathname === "/v1/files/read") {
        const body = await readJson(req, config.limits.maxBodyBytes);
        return sendJson(res, 200, { ok: true, path: body.path, content: readText(config.dataRoot, body.path) });
      }

      if (req.method === "POST" && requestUrl.pathname === "/v1/files/write") {
        const body = await readJson(req, config.limits.maxBodyBytes);
        if (typeof body.content !== "string") return sendJson(res, 400, { ok: false, error: "CONTENT_MUST_BE_STRING" });
        return sendJson(res, 200, { ok: true, ...writeText(config.dataRoot, body.path, body.content) });
      }

      if (req.method === "GET" && requestUrl.pathname === "/v1/files/list") {
        const target = requestUrl.searchParams.get("path") || ".";
        return sendJson(res, 200, { ok: true, path: target, entries: listFiles(config.dataRoot, target) });
      }

      if (req.method === "POST" && requestUrl.pathname === "/v1/work-orders") {
        const body = await readJson(req, config.limits.maxBodyBytes);
        return sendJson(res, 201, { ok: true, workOrder: store.create(body) });
      }

      if (req.method === "GET" && requestUrl.pathname === "/v1/work-orders") {
        const limit = Number(requestUrl.searchParams.get("limit") || 100);
        const project = requestUrl.searchParams.get("project") || undefined;
        const status = requestUrl.searchParams.get("status") || undefined;
        return sendJson(res, 200, { ok: true, workOrders: store.list({ limit, project, status }) });
      }

      if (req.method === "POST" && requestUrl.pathname === "/v1/finance/build") {
        const body = await readJson(req, config.limits.maxBodyBytes);
        return sendJson(res, 200, buildCfoStack(config.dataRoot, body || {}));
      }

      if (req.method === "GET" && requestUrl.pathname === "/v1/finance/status") {
        return sendJson(res, 200, financeStatus(config.dataRoot));
      }

      if (req.method === "POST" && requestUrl.pathname === "/v1/finance/import-bank") {
        const body = await readJson(req, config.limits.maxBodyBytes);
        if (!body.reportPath) return sendJson(res, 400, { ok: false, error: "BANK_REPORT_PATH_REQUIRED" });
        return sendJson(res, 200, importBankReconciliation(config.dataRoot, body.reportPath, {
          restrictToDataRoot: true,
          contextDir: body.contextDir,
          trustBankApi: body.trustBankApi === true,
          includeDryRunAttach: body.includeDryRunAttach === true,
          allowDebitOnly: body.allowDebitOnly === true,
          openingBalance: body.openingBalance,
          closingBalance: body.closingBalance
        }));
      }

      if (req.method === "POST" && requestUrl.pathname === "/v1/finance/pull-bank") {
        const body = await readJson(req, config.limits.maxBodyBytes);
        return sendJson(res, 200, await pullBankSnapshot(config.dataRoot, {
          contextDir: body.contextDir,
          since: body.since,
          openingBalance: body.openingBalance,
          closingBalance: body.closingBalance
        }));
      }

      return sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
    } catch (error) {
      const status = error.status || 500;
      eventContext.error = error.code || error.message;
      return sendJson(res, status, { ok: false, error: error.code || error.message, requestId });
    }
  });
}

function startServer(config) {
  const server = createServer(config);
  server.listen(config.api.port, config.api.host, () => {
    process.stdout.write(`vboard-ops-core listening on http://${config.api.host}:${config.api.port}\n`);
  });
  return server;
}

module.exports = { createServer, startServer };
