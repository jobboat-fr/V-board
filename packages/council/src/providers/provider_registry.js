"use strict";

const { MockProvider } = require("./mock_provider");
const { FallbackChatProvider } = require("./fallback_chat_provider");
const { RemoteChatProvider } = require("./remote_chat_provider");

class ProviderRegistry {
  constructor({ mode = process.env.VBOARD_LIVE_PROVIDER_MODE || "mock" } = {}) {
    this.mode = mode;
  }

  create() {
    if (this.mode === "remote" || this.mode === "api") {
      return new RemoteChatProvider();
    }
    if (this.mode === "fallback") {
      return new FallbackChatProvider();
    }
    return new MockProvider();
  }
}

module.exports = { ProviderRegistry };
