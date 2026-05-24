"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

class WorkOrderStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.file = path.join(this.root, "work-orders.jsonl");
    ensureDir(this.root);
  }

  create(input) {
    const item = {
      id: crypto.randomUUID(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      project: input.project || "default",
      status: input.status || "open",
      priority: input.priority || input.urgency || "P3",
      title: input.title || input.prompt || "Untitled work order",
      category: input.category || "general",
      owner: input.owner !== false,
      payload: input.payload || input
    };
    fs.appendFileSync(this.file, `${JSON.stringify(item)}\n`);
    return item;
  }

  list({ limit = 100, project, status } = {}) {
    if (!fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, "utf8").split(/\r?\n/).filter(Boolean);
    let items = lines.map((line) => JSON.parse(line));
    if (project) items = items.filter((item) => item.project === project);
    if (status) items = items.filter((item) => item.status === status);
    return items.slice(-limit);
  }
}

module.exports = { WorkOrderStore };
