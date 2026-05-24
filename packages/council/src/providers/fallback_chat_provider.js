"use strict";

const { MODEL_REGISTRY } = require("../config/model_registry");
const { MockProvider } = require("./mock_provider");
const { BudgetStore } = require("../ops/budget_store");
const { tokenCost } = require("../ops/cost_guard");
const { estimateTokens } = require("../utils/token_estimator");

function stripProviderPrefix(model) {
  return String(model || "").replace(/^fallback\//, "");
}

function extractJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("model did not return JSON");
  }
}

class FallbackChatProvider {
  constructor({
    token = process.env.LLM_FALLBACK_API_KEY || "",
    baseUrl = process.env.LLM_FALLBACK_API_BASE_URL || "",
    fallback = new MockProvider(),
    budgetStore = new BudgetStore()
  } = {}) {
    this.token = token;
    this.baseUrl = baseUrl;
    this.fallback = fallback;
    this.budgetStore = budgetStore;
  }

  available() {
    return Boolean(this.token && this.baseUrl);
  }

  liveRoleAllowlist() {
    const configured = process.env.VBOARD_LIVE_ROLE_ALLOWLIST;
    if (configured) {
      return new Set(configured.split(",").map((role) => role.trim()).filter(Boolean));
    }
    return new Set([
      "deal_captain",
      "incident_commander",
      "cto_analyst",
      "security_skeptic"
    ]);
  }

  shouldUseExternal({ role, route, workflow, request } = {}) {
    if (!this.available()) return false;
    if (route.restricted && process.env.VBOARD_ALLOW_RESTRICTED_API !== "1") return false;
    if (workflow?.deal_room?.active && role === "deal_captain") {
      return request?.syncPremium === true || process.env.VBOARD_SYNC_DEAL_CAPTAIN === "1";
    }
    if (route.urgency === "P0" && this.liveRoleAllowlist().has(role)) return true;
    if (["cto_audit", "incident_watchdog"].includes(route.category) && this.liveRoleAllowlist().has(role)) return true;
    if (["legal_accounting", "invoice_reconciliation"].includes(route.category) && process.env.VBOARD_ALLOW_RESTRICTED_API === "1") {
      return this.liveRoleAllowlist().has(role);
    }
    return false;
  }

  modelFor(route, role = "") {
    const alias = role === "deal_captain" ? "premium-judge" : route.spec.defaultModel;
    return MODEL_REGISTRY[alias]?.model || alias;
  }

  promptFor({ role, route, request, workflow }) {
    return [
      "You are one specialist worker in the V-Board council.",
      "Return only strict JSON with keys: role, facts_emp, estimates_est, risks, missing_documents, checks, contradictions, recommended_action, confidence, requires_owner_approval.",
      "Use [EMP] for observed facts and [EST] for assumptions.",
      "Never expose confidential data to non-owner users.",
      "",
      `Role: ${role}`,
      `Category: ${route.category}`,
      `Urgency: ${route.urgency}`,
      `Restricted: ${route.restricted}`,
      `Owner approval required: ${route.requireOwnerApproval}`,
      "",
      "Workflow packet:",
      JSON.stringify(workflow).slice(0, 16000),
      "",
      "Request summary:",
      JSON.stringify({
        prompt: request.prompt,
        channel: request.channel,
        owner: request.owner,
        direction: request.direction,
        hasEmail: Boolean(request.email),
        hasLead: Boolean(request.lead)
      })
    ].join("\n");
  }

  async runRole(args) {
    const { route, runId } = args;
    if (!this.shouldUseExternal(args)) {
      const packet = await this.fallback.runRole(args);
      return {
        ...packet,
        provider_note: route.restricted && process.env.VBOARD_ALLOW_RESTRICTED_API !== "1"
          ? "restricted request kept off external API; used deterministic fallback"
          : "external API skipped by live role policy; used deterministic fallback"
      };
    }

    const model = stripProviderPrefix(this.modelFor(route, args.role));
    const prompt = this.promptFor(args);
    const body = {
      model,
      messages: [
        {
          role: "system",
          content: "You are a precise JSON-only business operations specialist. Return one valid JSON object and no prose."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 900
    };

    let response;
    try {
      response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(process.env.VBOARD_FALLBACK_LLM_TIMEOUT_MS || 25000))
      });
    } catch (error) {
      const packet = await this.fallback.runRole(args);
      return {
        ...packet,
        provider_error: `fallback LLM provider request failed or timed out: ${error.message}`,
        provider_fallback: true
      };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const packet = await this.fallback.runRole(args);
      return {
        ...packet,
        provider_error: `fallback LLM provider ${response.status}: ${text.slice(0, 240)}`,
        provider_fallback: true
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      parsed = extractJson(content);
    } catch (error) {
      const packet = await this.fallback.runRole(args);
      return {
        ...packet,
        provider_error: `fallback LLM provider JSON parse failed: ${error.message}; content=${content.slice(0, 220)}`,
        provider_fallback: true
      };
    }
    const usage = data.usage || {};
    const promptTokens = usage.prompt_tokens || estimateTokens(prompt);
    const completionTokens = usage.completion_tokens || estimateTokens(content);
    const chargedAlias = args.role === "deal_captain" ? "premium-judge" : route.spec.defaultModel;
    const chargedModel = MODEL_REGISTRY[chargedAlias]?.model || `fallback/${model}`;
    const usd = tokenCost(chargedModel, promptTokens, completionTokens);
    this.budgetStore.recordActual({
      usd,
      category: route.category,
      model: chargedModel,
      runId
    });

    return {
      role: args.role,
      modelAlias: chargedAlias,
      provider: "fallback",
      provider_model: model,
      facts_emp: Array.isArray(parsed.facts_emp) ? parsed.facts_emp : [],
      estimates_est: Array.isArray(parsed.estimates_est) ? parsed.estimates_est : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      missing_documents: Array.isArray(parsed.missing_documents) ? parsed.missing_documents : [],
      checks: Array.isArray(parsed.checks) ? parsed.checks : [],
      contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions : [],
      recommended_action: parsed.recommended_action || "Proceed with structured evidence-first analysis.",
      confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0.7,
      requires_owner_approval: Boolean(parsed.requires_owner_approval || route.requireOwnerApproval),
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        estimated_usd: Number(usd.toFixed(6))
      }
    };
  }
}

module.exports = { FallbackChatProvider };
