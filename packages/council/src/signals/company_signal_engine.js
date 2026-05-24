"use strict";

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s)]+|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s)]*/gi;
const PHONE_RE = /(?:\+?\d[\d .()/-]{7,}\d)/g;

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function containsAny(text, words) {
  const value = String(text || "").toLowerCase();
  return words.some((word) => value.includes(word));
}

function detectLanguage(text = "") {
  const lower = String(text).toLowerCase();
  const frenchHits = ["bonjour", "merci", "société", "entreprise", "devis", "besoin", "rendez-vous", "cordialement", "vous", "nous"]
    .filter((word) => lower.includes(word)).length;
  const englishHits = ["hello", "thanks", "company", "business", "quote", "need", "meeting", "regards", "you", "we"]
    .filter((word) => lower.includes(word)).length;
  if (frenchHits > englishHits) return "fr";
  if (englishHits > frenchHits) return "en";
  return "unknown";
}

function detectUrgency(text = "") {
  const lower = String(text).toLowerCase();
  if (/\bp0\b|urgent today|data leak|breach|server down|blocked payment|legal deadline/.test(lower)) return "P0";
  if (/\bp1\b|deadline|this week|risk|blocked|missing invoice|tax|legal|contract|client waiting/.test(lower)) return "P1";
  if (/\bp2\b|missing|unclear|follow up|follow-up|to verify|monitor/.test(lower)) return "P2";
  return "P3";
}

function detectRestricted(text = "") {
  return containsAny(text, [
    "bank", "invoice", "receipt", "tax", "urssaf", "dsn", "payroll", "legal", "statuts",
    "secret", "token", "api key", "password", "client data", "internal", "confidential"
  ]);
}

function extractEntities(text = "") {
  const emails = unique(String(text).match(EMAIL_RE) || []);
  const phones = unique(String(text).match(PHONE_RE) || []).map((phone) => phone.trim());
  const websites = unique(String(text).match(URL_RE) || []).map((url) => {
    const cleaned = url
      .split(/[\\'",<>{}\[\]\s]/)[0]
      .replace(/[.,;:]+$/, "");
    return cleaned.startsWith("http") ? cleaned : `https://${cleaned}`;
  });
  return { emails, phones, websites };
}

function inferSector(text = "") {
  const lower = String(text).toLowerCase();
  const sectors = [
    ["clinic", ["clinic", "cabinet", "doctor", "dentist", "health", "santé", "médical"]],
    ["real_estate", ["real estate", "immobilier", "agency", "agence immobilière"]],
    ["ecommerce", ["shop", "e-commerce", "ecommerce", "boutique", "checkout", "product catalog"]],
    ["education", ["school", "formation", "education", "école", "academy", "training"]],
    ["saas", ["saas", "software", "platform", "app", "api"]],
    ["agency", ["agency", "agence", "marketing", "communication", "studio"]],
    ["recruiting", ["recruit", "hiring", "rh", "hr", "talent"]],
    ["tourism", ["hotel", "restaurant", "tourism", "tourisme", "travel"]]
  ];
  for (const [sector, words] of sectors) {
    if (words.some((word) => lower.includes(word))) return sector;
  }
  return "unknown";
}

function inferPainPoints(text = "") {
  const lower = String(text).toLowerCase();
  const points = [];
  if (containsAny(lower, ["manual", "spreadsheet", "excel", "papier", "manual process"])) points.push("manual_operations");
  if (containsAny(lower, ["lead generation", "lead gen", "conversion", "funnel", "sales pipeline", "prospecting", "prospect acquisition"])) points.push("lead_generation");
  if (containsAny(lower, ["booking", "appointment", "rdv", "calendar"])) points.push("appointment_automation");
  if (containsAny(lower, ["support", "messages", "whatsapp", "email", "inbox"])) points.push("communication_overload");
  if (containsAny(lower, ["website", "landing", "traffic", "seo"])) points.push("digital_presence");
  if (containsAny(lower, ["mvp", "startup", "prototype", "launch"])) points.push("mvp_launch");
  return points.length ? points : ["needs_discovery"];
}

function prospectScore({ text = "", entities = extractEntities(text), sector = inferSector(text), painPoints = inferPainPoints(text) } = {}) {
  const hasReachableContact = entities.emails.length > 0 || entities.websites.length > 0 || entities.phones.length > 0;
  const structure = hasReachableContact ? 8 : 5;
  const timing = containsAny(text, ["hiring", "launch", "new", "growth", "urgent", "opening", "recrute", "lancement"]) ? 8 : 6;
  const upside = painPoints.includes("needs_discovery") ? 5 : 8;
  const connectivity = ["saas", "agency", "education", "recruiting"].includes(sector) ? 8 : 6;
  const exposure = detectRestricted(text) ? 5 : 9;
  const normalized = {
    S: structure / 10,
    T: timing / 10,
    Psi: upside / 10,
    Phi: connectivity / 10,
    E: exposure / 10
  };
  const dFast = (normalized.S * normalized.T * normalized.Psi) * normalized.Phi - (1 - normalized.E);
  const raw = { S: structure, T: timing, Psi: upside, Phi: connectivity, E: exposure };
  const weakest = Object.entries(raw).sort((a, b) => a[1] - b[1])[0][0];
  return {
    ...raw,
    D_fast: Number(dFast.toFixed(2)),
    weakest,
    decision: dFast > 0.6 ? "strong_pick" : dFast >= 0.3 ? "maybe" : "reject"
  };
}

function buildCompanySignals(request = {}, route = {}) {
  const structured = request.lead || request.prospect || request.company || {};
  const text = [request.prompt, request.message, request.notes, JSON.stringify(request.lead || request.prospect || {})]
    .filter(Boolean)
    .join("\n");
  const extracted = extractEntities(text);
  const entities = {
    emails: unique([structured.email, ...(extracted.emails || [])]),
    phones: unique([structured.phone, ...(extracted.phones || [])]),
    websites: unique([structured.website, ...(extracted.websites || [])])
  };
  const sector = inferSector(text);
  const painPoints = inferPainPoints(text);
  const locationHint = String(structured.location || request.location || "").toLowerCase();
  const websiteHint = String(structured.website || "").toLowerCase();
  const inferredLanguage = websiteHint.includes(".fr") || /france|paris|lyon|marseille|bordeaux|lille|toulouse/.test(locationHint)
    ? "fr"
    : detectLanguage(text);
  const language = request.language || inferredLanguage;
  const urgency = route.urgency || request.urgency || detectUrgency(text);
  const restricted = Boolean(route.restricted || request.restricted || detectRestricted(text));

  return {
    language,
    urgency,
    restricted,
    entities,
    sector,
    painPoints,
    prospect_score: prospectScore({ text, entities, sector, painPoints }),
    token_policy: {
      mode: restricted || urgency === "P0" || urgency === "P1" ? "evidence_packet_first" : "compact_context",
      include_raw_docs: false,
      max_owner_brief_words: urgency === "P0" ? 220 : 450
    }
  };
}

module.exports = {
  buildCompanySignals,
  extractEntities,
  detectLanguage,
  detectUrgency,
  detectRestricted,
  inferSector,
  inferPainPoints,
  prospectScore
};
