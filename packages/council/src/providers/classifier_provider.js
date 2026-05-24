"use strict";

class ClassifierProvider {
  constructor({
    token = process.env.LLM_API_TOKEN || process.env.LLM_API_TOKEN || "",
    baseUrl = process.env.LLM_CLASSIFIER_BASE_URL || "",
    billTo = process.env.LLM_BILLING_ACCOUNT || process.env.LLM_BILLING_ACCOUNT || ""
  } = {}) {
    this.token = token;
    this.billTo = billTo;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fallbackBaseUrls = [this.baseUrl].filter(Boolean);
  }

  available() {
    return Boolean(this.token && this.baseUrl);
  }

  async query(model, payload, options = {}) {
    if (!this.token) {
      throw new Error("remote LLM provider token is not configured");
    }

    const headers = {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json"
    };
    if (this.billTo) headers["x-billing-account"] = this.billTo;

    const errors = [];
    for (const baseUrl of this.fallbackBaseUrls) {
      const response = await fetch(`${baseUrl}/${model}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...payload,
          options: {
            wait_for_model: true,
            ...(payload.options || {})
          }
        }),
        signal: options.signal || AbortSignal.timeout(Number(process.env.VBOARD_LLM_TIMEOUT_MS || 10000))
      });
      if (response.ok) return response.json();

      const text = await response.text().catch(() => "");
      errors.push(`${baseUrl} -> ${response.status}: ${text.slice(0, 180)}`);
      if (![404, 405].includes(response.status)) break;
    }

    throw new Error(`remote LLM provider inference failed: ${errors.join(" | ")}`);
  }

  async zeroShot({ text, labels, model = process.env.VBOARD_ZERO_SHOT_MODEL || "facebook/bart-large-mnli" }) {
    const result = await this.query(model, {
      inputs: text,
      parameters: {
        candidate_labels: labels,
        multi_label: false
      }
    });
    if (Array.isArray(result)) {
      const ranked = result
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          label: item.label,
          score: Number(item.score || 0)
        }))
        .filter((item) => item.label)
        .sort((a, b) => b.score - a.score);
      return {
        model,
        labels: ranked.map((item) => item.label),
        scores: ranked.map((item) => item.score),
        topLabel: ranked[0]?.label || null,
        confidence: ranked[0]?.score || 0
      };
    }
    return {
      model,
      labels: result.labels || [],
      scores: result.scores || [],
      topLabel: result.labels?.[0] || null,
      confidence: result.scores?.[0] || 0
    };
  }

  async classifyMail(text) {
    return this.zeroShot({
      text,
      labels: ["cold_mail", "warm_mail", "hot_mail", "restricted_internal", "support", "spam"]
    });
  }
}

module.exports = { ClassifierProvider };
