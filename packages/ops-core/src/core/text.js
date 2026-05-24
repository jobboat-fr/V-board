"use strict";

function contains(text, words) {
  return words.some((word) => text.includes(word));
}

function textOf(input = {}) {
  return [
    input.prompt,
    input.message,
    input.notes,
    input.email && input.email.subject,
    input.email && input.email.body,
    input.email && input.email.from,
    input.lead && input.lead.name,
    input.lead && input.lead.email,
    input.lead && input.lead.website,
    input.lead && input.lead.sector,
    input.lead && input.lead.need
  ].filter(Boolean).join("\n").toLowerCase();
}

function hasEmail(text) {
  return /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text);
}

module.exports = { contains, textOf, hasEmail };
