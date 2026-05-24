"use strict";

const { MODEL_REGISTRY } = require("../config/model_registry");
const { MockProvider } = require("./mock_provider");
const { BudgetStore } = require("../ops/budget_store");
const { tokenCost } = require("../ops/cost_guard");
const { estimateTokens } = require("../utils/token_estimator");

function stripProviderPrefix(model) {
  return String(model || "")
    .replace(/^huggingface\//, "")
    .replace(/^hf\//, "");
}

function extractJson(text) {
  let raw = String(text || "").trim();
  raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    if (start >= 0) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < raw.length; i += 1) {
        const ch = raw[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === "\"") inString = false;
          continue;
        }
        if (ch === "\"") inString = true;
        else if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
        }
      }
    }
    throw new Error("model did not return JSON");
  }
}

class HuggingFaceChatProvider {
  constructor({
    token = process.env.HUGGINGFACE_API_TOKEN || process.env.HF_TOKEN || "",
    baseUrl = process.env.HUGGINGFACE_CHAT_BASE || "https://router.huggingface.co/v1/chat/completions",
    billTo = process.env.HUGGINGFACE_BILL_TO || process.env.HF_BILL_TO || "",
    fallback = new MockProvider(),
    budgetStore = new BudgetStore()
  } = {}) {
    this.token = token;
    this.baseUrl = baseUrl;
    this.billTo = billTo;
    this.fallback = fallback;
    this.budgetStore = budgetStore;
  }

  available() {
    return Boolean(this.token);
  }

  modelFor(route, role = "") {
    const alias = role === "deal_captain" ? "premium-judge" : route.spec.defaultModel;
    return MODEL_REGISTRY[alias]?.model || alias;
  }

  promptFor({ role, route, request, workflow }) {
    return [
      "You are one specialist worker in the AZZCO OVH hard-work council.",
      "Return only strict JSON with keys: role, facts_emp, estimates_est, risks, missing_documents, checks, contradictions, recommended_action, confidence, requires_owner_approval.",
      "Keep JSON compact. Every array value must be a short string, not an object. Maximum 5 strings per array.",
      "Use [EMP] for observed facts and [EST] for assumptions.",
      "Never expose confidential data to non-owner users.",
      "If evidence is missing, return missing_documents or checks instead of guessing.",
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
        category: request.category,
        urgency: request.urgency,
        source: request.source,
        channel: request.channel,
        owner: request.owner,
        direction: request.direction,
        hasEmail: Boolean(request.email),
        hasLead: Boolean(request.lead),
        evidence: Array.isArray(request.evidence) ? request.evidence.slice(0, 30) : []
      })
    ].join("\n");
  }

  async runRole(args) {
    const { route, runId } = args;
    if (!this.available()) {
      const packet = await this.fallback.runRole(args);
      return {
        ...packet,
        provider_error: "Hugging Face token is not configured",
        provider_fallback: true
      };
    }

    const chargedAlias = args.role === "deal_captain" ? "premium-judge" : route.spec.defaultModel;
    const chargedModel = MODEL_REGISTRY[chargedAlias]?.model || this.modelFor(route, args.role);
    const model = stripProviderPrefix(chargedModel);
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
      temperature: 0.2,
      max_tokens: Number(process.env.AZZCO_HF_CHAT_MAX_TOKENS || 1400),
      response_format: { type: "json_object" }
    };

    let response;
    try {
      const headers = {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json"
      };
      if (this.billTo) headers["x-hf-bill-to"] = this.billTo;

      response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(process.env.AZZCO_HF_CHAT_TIMEOUT_MS || 45000))
      });
    } catch (error) {
      const packet = await this.fallback.runRole(args);
      return {
        ...packet,
        provider_error: `Hugging Face request failed or timed out: ${error.message}`,
        provider_fallback: true
      };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const packet = await this.fallback.runRole(args);
      return {
        ...packet,
        provider_error: `Hugging Face ${response.status}: ${text.slice(0, 240)}`,
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
        provider_error: `Hugging Face JSON parse failed: ${error.message}; content=${content.slice(0, 220)}`,
        provider_fallback: true
      };
    }

    const usage = data.usage || {};
    const promptTokens = usage.prompt_tokens || estimateTokens(prompt);
    const completionTokens = usage.completion_tokens || estimateTokens(content);
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
      provider: "huggingface",
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

module.exports = { HuggingFaceChatProvider };
