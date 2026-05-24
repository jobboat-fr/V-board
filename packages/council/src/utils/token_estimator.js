"use strict";

function estimateTokens(value) {
  if (value == null) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(String(text).length / 4);
}

function safeId(prefix = "run") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

module.exports = {
  estimateTokens,
  safeId
};
