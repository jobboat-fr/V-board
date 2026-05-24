"use strict";

function truncateText(value, maxChars) {
  if (typeof value !== "string") return value;
  return value.length > maxChars ? `${value.slice(0, maxChars)}...[TRUNCATED]` : value;
}

function compactEvidence(input = {}, limits = {}) {
  const maxEvidenceItems = limits.maxEvidenceItems || 30;
  const maxTextChars = limits.maxTextChars || 6000;
  const packet = { ...input };

  if (Array.isArray(packet.evidence) && packet.evidence.length > maxEvidenceItems) {
    packet.evidence = packet.evidence.slice(0, maxEvidenceItems);
    packet.evidence_truncated = true;
  }

  for (const key of ["raw", "raw_document", "full_log", "full_inbox", "attachments_raw"]) {
    if (packet[key]) {
      packet[key] = "[REMOVED_BY_COMPACT_EVIDENCE_GUARD]";
      packet.compacted = true;
    }
  }

  for (const key of ["prompt", "message", "notes"]) {
    if (packet[key]) packet[key] = truncateText(packet[key], maxTextChars);
  }

  if (packet.email && packet.email.body) {
    packet.email = { ...packet.email, body: truncateText(packet.email.body, maxTextChars) };
  }

  return packet;
}

module.exports = { compactEvidence, truncateText };
