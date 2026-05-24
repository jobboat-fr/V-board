"use strict";

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const { AzzcoCouncilEngine } = require("./index");
const { BudgetStore } = require("./ops/budget_store");
const { RouteLogger } = require("./ops/route_logger");

const engine = new AzzcoCouncilEngine();
const budgetStore = new BudgetStore();
const routeLogger = new RouteLogger();
const host = process.env.AZZCO_COUNCIL_HOST || "127.0.0.1";
const port = Number(process.env.AZZCO_COUNCIL_PORT || 8787);
const apiToken = process.env.AZZCO_COUNCIL_TOKEN || "";

// Work-order dedup cache — prevents repeated calls for the same request
// from burning budget. TTL is category-dependent.
const dedupCache = new Map();
const DEDUP_TTL_MS = {
  mail_labeling: 10 * 60 * 1000,   // 10 min — most loop-prone
  mail_triage: 10 * 60 * 1000,
  lead_scout: 15 * 60 * 1000,
  default: 5 * 60 * 1000
};

function dedupKey(request) {
  const seed = {
    category: request.category || null,
    channel: request.channel || null,
    prompt: typeof request.prompt === "string" ? request.prompt.slice(0, 400) : null,
    email: request.email ? {
      id: request.email.id || null,
      from: request.email.from || null,
      subject: request.email.subject || null,
      threadId: request.email.threadId || null
    } : null
  };
  return crypto.createHash("sha256").update(JSON.stringify(seed)).digest("hex").slice(0, 16);
}

function dedupTtl(category) {
  return DEDUP_TTL_MS[category] || DEDUP_TTL_MS.default;
}

function dedupGet(key, category) {
  const entry = dedupCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > dedupTtl(category)) {
    dedupCache.delete(key);
    return null;
  }
  return entry.result;
}

function dedupSet(key, result) {
  // Evict entries older than 30 min to prevent unbounded growth
  if (dedupCache.size > 2000) {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [k, v] of dedupCache) {
      if (v.ts < cutoff) dedupCache.delete(k);
    }
  }
  dedupCache.set(key, { result, ts: Date.now() });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function send(res, statusCode, data) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data, null, 2));
}

function isAuthorized(req) {
  if (!apiToken) return true;
  const header = req.headers.authorization || "";
  return header === `Bearer ${apiToken}`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      send(res, 200, { ok: true, service: "azzco-council-core", auth: apiToken ? "required" : "off", dedup_cache_size: dedupCache.size });
      return;
    }

    if (!isAuthorized(req)) {
      send(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    if (req.method === "GET" && req.url === "/ops/budget") {
      const win = budgetStore.getWindow();
      send(res, 200, {
        ok: true,
        day: win.day,
        month: win.month,
        dayState: win.dayState,
        monthState: win.monthState
      });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/ops/routes")) {
      const limit = Math.min(Number(new URL(req.url, "http://localhost").searchParams.get("limit") || 20), 100);
      let entries = [];
      try {
        const lines = fs.readFileSync(routeLogger.filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
        entries = lines.slice(-limit).map((line) => JSON.parse(line));
      } catch {
        entries = [];
      }
      send(res, 200, { ok: true, entries });
      return;
    }

    if (req.method === "POST" && (req.url === "/route" || req.url === "/workflow/company")) {
      const body = await readBody(req);
      const request = body ? JSON.parse(body) : {};

      // Dedup: return cached result if same request seen within TTL
      const key = dedupKey(request);
      const cached = dedupGet(key, request.category);
      if (cached) {
        send(res, 200, { ...cached, cached: true, cache_key: key });
        return;
      }

      const result = await engine.handle(request);
      dedupSet(key, result);
      send(res, 200, result);
      return;
    }

    send(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    send(res, 500, { ok: false, error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`azzco-council-core listening on http://${host}:${port}`);
});
