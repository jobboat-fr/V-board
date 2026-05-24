"use strict";

const { MockProvider } = require("./mock_provider");
const { TogetherProvider } = require("./together_provider");
const { HuggingFaceChatProvider } = require("./huggingface_chat_provider");

class ProviderRegistry {
  constructor({ mode = process.env.AZZCO_LIVE_PROVIDER_MODE || "mock" } = {}) {
    this.mode = mode;
  }

  create() {
    if (this.mode === "huggingface" || this.mode === "hf" || this.mode === "api") {
      return new HuggingFaceChatProvider();
    }
    if (this.mode === "together") {
      return new TogetherProvider();
    }
    return new MockProvider();
  }
}

module.exports = { ProviderRegistry };
