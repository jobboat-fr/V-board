"use strict";

const { MODEL_REGISTRY } = require("../config/model_registry");
const { BudgetStore } = require("./budget_store");
const { estimateTokens } = require("../utils/token_estimator");

const TOKEN_PRICES_USD_PER_1M = {
  "together/Qwen/Qwen3.5-9B": { in: 0.10, out: 0.15 },
  "together/google/gemma-4-31B-it": { in: 0.39, out: 0.97 },
  "together/moonshotai/Kimi-K2.5": { in: 0.50, out: 2.80 },
  "openai/gpt-oss-20b": { in: 0.05, out: 0.20 },
  "openai/gpt-oss-120b": { in: 0.15, out: 0.60 },
  "local/cto-specialist": { in: 0, out: 0 },
  "open-source/fallback-70b-class": { in: 0, out: 0 },
  "facebook/bart-large-mnli": { in: 0, out: 0 },
  "cardiffnlp/twitter-roberta-base-sentiment-latest": { in: 0, out: 0 },
  "SamLowe/roberta-base-go_emotions": { in: 0, out: 0 },
  "sshleifer/distilbart-cnn-12-6": { in: 0, out: 0 }
};

function registryModel(alias) {
  return MODEL_REGISTRY[alias]?.model || alias;
}

function priceFor(model) {
  return TOKEN_PRICES_USD_PER_1M[model] || { in: 0.20, out: 0.60 };
}

function tokenCost(model, inputTokens, outputTokens) {
  const price = priceFor(model);
  return (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out;
}

function defaultOutputTokens(route) {
  if (route.category === "simple_chat") return 250;
  if (route.category === "mail_labeling" || route.category === "daily_communications") return 300;
  if (route.category === "cold_email_campaign" || route.category === "sales_reply") return 800;
  if (route.category === "lead_scout") return 2500;
  if (route.category === "cto_audit") return 2500;
  if (route.category === "legal_accounting" || route.category === "invoice_reconciliation") return 2500;
  return 900;
}

function planFor(route, request = {}, forceCheap = false) {
  if (forceCheap) {
    return [
      { alias: "cheap-default", model: registryModel("cheap-default"), multiplier: 1, inputRatio: 0.45, outputRatio: 0.55, reason: "force cheap mode" }
    ];
  }

  if (route.category === "simple_chat") {
    return [{ alias: "cheap-default", model: registryModel("cheap-default"), multiplier: 1, inputRatio: 0.65, outputRatio: 0.70, reason: "simple chat" }];
  }
  if (route.category === "daily_communications" || route.category === "mail_labeling") {
    return [
      { alias: "hf-zero-shot-classifier", model: registryModel("hf-zero-shot-classifier"), multiplier: 1, inputRatio: 0.60, outputRatio: 0.10, reason: "low cost label" },
      { alias: "cheap-default", model: registryModel("cheap-default"), multiplier: 0.25, inputRatio: 0.55, outputRatio: 0.70, reason: "uncertain/summary fallback" }
    ];
  }
  if (route.category === "cold_email_campaign" || route.category === "crm_pipeline") {
    return [
      { alias: "cheap-default", model: registryModel("cheap-default"), multiplier: 0.70, inputRatio: 0.60, outputRatio: 0.80, reason: "draft/prep" },
      { alias: "business-workhorse", model: registryModel("business-workhorse"), multiplier: 0.30, inputRatio: 0.75, outputRatio: 0.90, reason: "quality escalation" }
    ];
  }
  if (route.category === "lead_scout") {
    return [
      { alias: "cheap-default", model: registryModel("cheap-default"), multiplier: 2, inputRatio: 0.35, outputRatio: 0.35, reason: "scout/compress" },
      { alias: "business-workhorse", model: registryModel("business-workhorse"), multiplier: 1, inputRatio: 0.70, outputRatio: 0.80, reason: "business analysis" }
    ];
  }
  if (route.category === "sales_reply" || route.category === "cto_audit" || route.category === "incident_watchdog") {
    return [
      { alias: "business-workhorse", model: registryModel("business-workhorse"), multiplier: 1, inputRatio: 0.75, outputRatio: 0.80, reason: "high value workhorse" },
      { alias: "premium-judge", model: registryModel("premium-judge"), multiplier: route.urgency === "P0" ? 0.45 : 0.15, inputRatio: 0.45, outputRatio: 0.50, reason: "selective judge" }
    ];
  }
  if (route.category === "legal_accounting" || route.category === "invoice_reconciliation") {
    return [
      { alias: "cheap-default", model: registryModel("cheap-default"), multiplier: 1, inputRatio: 0.30, outputRatio: 0.25, reason: "extract/compress" },
      { alias: route.category === "invoice_reconciliation" ? "ovh-accounting-specialist" : "ovh-legal-specialist", model: registryModel(route.category === "invoice_reconciliation" ? "ovh-accounting-specialist" : "ovh-legal-specialist"), multiplier: 0.65, inputRatio: 0.70, outputRatio: 0.85, reason: "restricted specialist" }
    ];
  }

  return [{ alias: route.spec.defaultModel, model: registryModel(route.spec.defaultModel), multiplier: 1, inputRatio: 1, outputRatio: 1, reason: "default route" }];
}

function byProvider(modelPlan = []) {
  return modelPlan.reduce((acc, step) => {
    const model = step.model || "";
    const provider = model.startsWith("together/")
      ? "together"
      : /bart|roberta|distilbart|facebook\/|cardiffnlp\/|SamLowe\//i.test(model)
        ? "huggingface"
        : model.startsWith("local/") || model.startsWith("open-source/")
          ? "local"
          : model.startsWith("openai/gpt-oss")
            ? "huggingface"
            : model.startsWith("openai/")
              ? "openai"
            : "other";
    acc[provider] = Number(((acc[provider] || 0) + Number(step.estimatedUsd || 0)).toFixed(6));
    return acc;
  }, {});
}

class CostGuard {
  constructor({
    store = new BudgetStore(),
    dailyLimitUsd = Number(process.env.AZZCO_DAILY_API_BUDGET_USD || 6),
    monthlyLimitUsd = Number(process.env.AZZCO_MONTHLY_API_BUDGET_USD || 180),
    hardStopUsd = Number(process.env.AZZCO_EMERGENCY_HARD_STOP_USD || 8),
    providerDailyCaps = {
      together: Number(process.env.AZZCO_TOGETHER_DAILY_CAP_USD || 3),
      huggingface: Number(process.env.AZZCO_HF_DAILY_CAP_USD || 3)
    }
  } = {}) {
    this.store = store;
    this.dailyLimitUsd = dailyLimitUsd;
    this.monthlyLimitUsd = monthlyLimitUsd;
    this.hardStopUsd = hardStopUsd;
    this.providerDailyCaps = providerDailyCaps;
  }

  forcedCheap() {
    return ["1", "true", "yes", "on"].includes(String(process.env.AZZCO_FORCE_CHEAP_MODE || "").toLowerCase());
  }

  estimate({ route, request, forceCheap = false }) {
    const inputTokens = Math.min(
      route.spec.maxInputTokens || 8000,
      Math.max(estimateTokens(request), estimateTokens(request.prompt || ""))
    );
    const outputTokens = defaultOutputTokens(route);
    const modelPlan = planFor(route, request, forceCheap).map((step) => {
      const estimatedUsd = (step.multiplier || 1) * tokenCost(
        step.model,
        inputTokens * (step.inputRatio ?? 1),
        outputTokens * (step.outputRatio ?? 1)
      );
      return {
        ...step,
        estimatedUsd: Number(estimatedUsd.toFixed(6))
      };
    });
    const estimatedUsd = modelPlan.reduce((sum, step) => sum + step.estimatedUsd, 0);

    return {
      inputTokens,
      outputTokens,
      modelPlan,
      estimatedByProvider: byProvider(modelPlan),
      estimatedUsd: Number(estimatedUsd.toFixed(6))
    };
  }

  evaluate({ route, request, runId }) {
    const win = this.store.getWindow();
    const forcedCheap = this.forcedCheap();
    const initialEstimate = this.estimate({ route, request, forceCheap: forcedCheap });
    let mode = forcedCheap ? "force_cheap" : "normal";
    const gates = [];

    const projectedDaily = win.dayState.actualUsd + initialEstimate.estimatedUsd;
    const projectedMonthly = win.monthState.actualUsd + initialEstimate.estimatedUsd;
    const hardDaily = this.hardStopUsd;
    const hardMonthly = Math.max(this.monthlyLimitUsd, this.hardStopUsd * 30);

    if (win.dayState.actualUsd >= hardDaily || win.monthState.actualUsd >= hardMonthly) {
      mode = "hard_stop";
      gates.push("BUDGET_HARD_STOP");
    } else if (projectedDaily > this.dailyLimitUsd || projectedMonthly > this.monthlyLimitUsd) {
      mode = "force_cheap";
      gates.push("BUDGET_FORCE_CHEAP_MODE");
    }

    for (const [provider, cap] of Object.entries(this.providerDailyCaps)) {
      const actual = Number(win.dayState.actualByProvider?.[provider] || 0);
      const estimated = Number(initialEstimate.estimatedByProvider?.[provider] || 0);
      if (actual + estimated > cap) {
        mode = mode === "hard_stop" ? mode : "force_cheap";
        if (!gates.includes("BUDGET_FORCE_CHEAP_MODE")) gates.push("BUDGET_FORCE_CHEAP_MODE");
        gates.push(`BUDGET_PROVIDER_CAP_${provider.toUpperCase()}`);
      }
    }

    const finalEstimate = this.estimate({ route, request, forceCheap: mode !== "normal" });
    this.store.recordPlanned({
      usd: finalEstimate.estimatedUsd,
      category: route.category,
      modelPlan: finalEstimate.modelPlan,
      runId
    });

    return {
      mode,
      gates,
      dailyLimitUsd: this.dailyLimitUsd,
      monthlyLimitUsd: this.monthlyLimitUsd,
      emergencyHardStopUsd: this.hardStopUsd,
      providerDailyCaps: this.providerDailyCaps,
      actualDailyUsd: Number(win.dayState.actualUsd.toFixed(6)),
      actualMonthlyUsd: Number(win.monthState.actualUsd.toFixed(6)),
      actualDailyByProvider: win.dayState.actualByProvider || {},
      plannedDailyUsd: Number(win.dayState.plannedUsd.toFixed(6)),
      plannedMonthlyUsd: Number(win.monthState.plannedUsd.toFixed(6)),
      plannedDailyByProvider: win.dayState.plannedByProvider || {},
      ...finalEstimate
    };
  }
}

module.exports = {
  CostGuard,
  TOKEN_PRICES_USD_PER_1M,
  tokenCost,
  planFor
};
