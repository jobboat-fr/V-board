"use strict";

const fs = require("fs");
const path = require("path");

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function monthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

function blankWindowState() {
  return {
    plannedUsd: 0,
    actualUsd: 0,
    calls: 0,
    plannedByProvider: {},
    actualByProvider: {}
  };
}

function providerForModel(model = "") {
  const value = String(model || "");
  if (value.startsWith("fallback/")) return "fallback";
  if (/bart|roberta|distilbart|classifier\//i.test(value)) return "remote";
  if (value.startsWith("local/") || value.startsWith("open-source/")) return "local";
  if (value.startsWith("remote/default")) return "remote";
  if (value.startsWith("remote/")) return "remote";
  return "other";
}

function normalizeWindowState(state = {}) {
  return {
    ...blankWindowState(),
    ...state,
    plannedByProvider: state.plannedByProvider || {},
    actualByProvider: state.actualByProvider || {}
  };
}

class BudgetStore {
  constructor({
    filePath = process.env.VBOARD_BUDGET_STATE_PATH || path.join(process.cwd(), "data", "budget_state.json")
  } = {}) {
    this.filePath = filePath;
  }

  ensureDir() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return {
        days: {},
        months: {},
        updatedAt: null
      };
    }
  }

  write(state) {
    this.ensureDir();
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  getWindow(now = new Date()) {
    const state = this.read();
    const day = todayKey(now);
    const month = monthKey(now);
    return {
      state,
      day,
      month,
      dayState: normalizeWindowState(state.days[day]),
      monthState: normalizeWindowState(state.months[month])
    };
  }

  recordPlanned({ usd = 0, category = "unknown", modelPlan = [], runId = null } = {}) {
    const win = this.getWindow();
    const state = win.state;
    state.days[win.day] = win.dayState;
    state.months[win.month] = win.monthState;

    state.days[win.day].plannedUsd += Number(usd || 0);
    state.days[win.day].calls += 1;
    state.months[win.month].plannedUsd += Number(usd || 0);
    state.months[win.month].calls += 1;

    for (const step of modelPlan) {
      const provider = providerForModel(step.model);
      const share = Number(step.estimatedUsd ?? (Number(usd || 0) / Math.max(modelPlan.length, 1)));
      state.days[win.day].plannedByProvider[provider] = Number(state.days[win.day].plannedByProvider[provider] || 0) + share;
      state.months[win.month].plannedByProvider[provider] = Number(state.months[win.month].plannedByProvider[provider] || 0) + share;
    }

    state.lastPlanned = {
      at: new Date().toISOString(),
      runId,
      category,
      usd: Number(usd || 0),
      models: modelPlan.map((step) => step.model)
    };

    this.write(state);
  }

  recordActual({ usd = 0, category = "unknown", model = null, runId = null } = {}) {
    const win = this.getWindow();
    const state = win.state;
    state.days[win.day] = win.dayState;
    state.months[win.month] = win.monthState;

    state.days[win.day].actualUsd += Number(usd || 0);
    state.months[win.month].actualUsd += Number(usd || 0);
    const provider = providerForModel(model);
    state.days[win.day].actualByProvider[provider] = Number(state.days[win.day].actualByProvider[provider] || 0) + Number(usd || 0);
    state.months[win.month].actualByProvider[provider] = Number(state.months[win.month].actualByProvider[provider] || 0) + Number(usd || 0);
    state.lastActual = {
      at: new Date().toISOString(),
      runId,
      category,
      model,
      usd: Number(usd || 0)
    };

    this.write(state);
  }
}

module.exports = {
  BudgetStore,
  providerForModel,
  todayKey,
  monthKey
};


