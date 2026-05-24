"use strict";

const fs = require("fs");
const path = require("path");

class RouteLogger {
  constructor({
    filePath = process.env.VBOARD_ROUTE_LOG_PATH || path.join(process.cwd(), "data", "route_log.jsonl")
  } = {}) {
    this.filePath = filePath;
  }

  log(entry) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const safeEntry = {
      ts: new Date().toISOString(),
      runId: entry.runId,
      category: entry.category,
      urgency: entry.urgency,
      restricted: entry.restricted,
      owner: entry.owner,
      channel: entry.channel,
      department: entry.department || null,
      workOrder: entry.workOrder || null,
      budget: entry.budget,
      safetyGates: entry.safetyGates || [],
      action: entry.action,
      allowedActions: entry.allowedActions || [],
      blockedActions: entry.blockedActions || [],
      notes: entry.notes || []
    };
    fs.appendFileSync(this.filePath, `${JSON.stringify(safeEntry)}\n`);
  }
}

module.exports = { RouteLogger };
