#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = process.env.VBOARD_WORKSPACE || "/workspace";
const DOC_DIRS = [
  path.join(ROOT, "docs"),
  path.join(ROOT, "accounting")
];
const OUT_DIR = path.join(ROOT, "ops/context");
const PDFTOTEXT = "/home/linuxbrew/.linuxbrew/bin/pdftotext";
const UNZIP = "/home/linuxbrew/.linuxbrew/bin/unzip";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    if (entry.isFile()) out.push(p);
  }
  return out;
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractPdf(file) {
  if (!fs.existsSync(PDFTOTEXT)) return "";
  const result = spawnSync(PDFTOTEXT, [file, "-"], {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 8
  });
  return result.status === 0 ? cleanText(result.stdout) : "";
}

function extractDocx(file) {
  if (!fs.existsSync(UNZIP)) return "";
  const result = spawnSync(UNZIP, ["-p", file, "word/document.xml"], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 4
  });
  if (result.status !== 0) return "";
  return cleanText(String(result.stdout || "")
    .replace(/<w:tab\/>/g, " ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">"));
}

function extractPlain(file) {
  try {
    return cleanText(fs.readFileSync(file, "utf8").replace(/<[^>]+>/g, " "));
  } catch {
    return "";
  }
}

function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") return extractPdf(file);
  if (ext === ".docx") return extractDocx(file);
  if ([".txt", ".md", ".csv", ".html", ".htm", ".json"].includes(ext)) return extractPlain(file);
  return "";
}

function moneyValue(raw) {
  const m = String(raw || "").match(/([+-])\s*([0-9][0-9 .]*[,.][0-9]{2})\s*EUR/i);
  if (!m) return null;
  const body = m[2].replace(/\s/g, "");
  let normalized;
  if (body.includes(",") && body.includes(".")) {
    normalized = body.replace(/\./g, "").replace(",", ".");
  } else if (body.includes(",")) {
    normalized = body.replace(",", ".");
  } else {
    normalized = body;
  }
  const value = Number(normalized);
  return (m[1] === "-" ? -1 : 1) * value;
}

function moneyMatches(text) {
  return [...String(text || "").matchAll(/[+-]\s*[0-9][0-9 .]*[,.][0-9]{2}\s*EUR/gi)].map((m) => ({
    raw: m[0].replace(/\s+/g, " ").trim(),
    value: moneyValue(m[0])
  })).filter((m) => Number.isFinite(m.value));
}

function dateMatches(text) {
  return [...new Set([...String(text || "").matchAll(/\b(?:[0-3]?\d[\/.-][01]?\d[\/.-](?:20)?\d{2}|20\d{2}-[01]\d-[0-3]\d)\b/g)].map((m) => m[0]))].slice(0, 20);
}

function redactSensitive(text) {
  return String(text || "")
    .replace(/\bFR\d{2}(?:[ ]?\d{4}){5,7}\b/g, "[IBAN_REDACTED]")
    .replace(/\b[A-Z0-9]{8,11}\b/g, (m) => (m.startsWith("QNTO") ? "[BIC_REDACTED]" : m));
}

function categoryFor(file, text) {
  const rel = path.relative(ROOT, file).toLowerCase();
  const sample = String(text || "").slice(0, 2000).toLowerCase();
  if (/february|march|april|relev[eÃƒÂ©]s? de compte|bank|bank statement|_2026\.pdf/.test(rel) && /solde au|transactions|iban|bank/.test(sample)) return "bank_statement";
  if (/facture|invoice|receipt|re[cÃƒÂ§]u|bill/.test(rel)) return "invoice_or_receipt";
  if (/kbis|rbe|verif|legal|statut|contrat|contract|company/.test(rel)) return "legal_company";
  if (/whitepaper|roadmap|programme|businesscard|workflow|memoir/.test(rel)) return "strategy_or_reference";
  return "other_document";
}

function firstLines(text, limit = 14) {
  return cleanText(text).split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, limit);
}

function inferStatementYear(text, file) {
  const fromText = String(text || "").match(/\b20\d{2}\b/);
  if (fromText) return Number(fromText[0]);
  const fromFile = String(file).match(/\b20\d{2}\b/);
  return fromFile ? Number(fromFile[0]) : new Date().getFullYear();
}

function isDateLine(line) {
  return /^[0-3]\d\/[01]\d$/.test(line.trim());
}

function isNoiseLine(line) {
  return /^(date de valeur|transactions|d[ÃƒÂ©e]bit|cr[ÃƒÂ©e]dit|entr[ÃƒÂ©e]es|sorties|solde|iban|bic)$/i.test(line.trim());
}

function sanitizeTransactionBlock(block) {
  const cleaned = [];
  let skipNextMoney = false;
  for (const rawLine of block) {
    const line = String(rawLine || "").trim();
    if (!line) continue;
    if (skipNextMoney && moneyMatches(line).length) {
      skipNextMoney = false;
      continue;
    }
    skipNextMoney = false;
    if (/^solde au\b/i.test(line)) {
      skipNextMoney = true;
      continue;
    }
    if (/^du\s+\d{2}\/\d{2}\/\d{4}\s+au\s+\d{2}\/\d{2}\/\d{4}/i.test(line)) continue;
    if (/^example company\b/i.test(line)) continue;
    if (/^\d+\s*\/\s*\d+$/.test(line)) continue;
    cleaned.push(line);
  }
  return cleaned;
}

function parseBankTransactions(doc) {
  if (doc.category !== "bank_statement" || !doc.text) return [];
  const year = inferStatementYear(doc.text, doc.path);
  const lines = doc.text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const transactions = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isDateLine(lines[i])) continue;
    const dateShort = lines[i];
    const block = [];
    for (let j = i + 1; j < lines.length && !isDateLine(lines[j]); j += 1) {
      block.push(lines[j]);
      if (block.length > 18) break;
    }
    const txBlock = sanitizeTransactionBlock(block);
    const amountCandidates = moneyMatches(txBlock.join("\n")).filter((m) => Math.abs(m.value) > 0.0001);
    if (!amountCandidates.length) continue;
    const amount = amountCandidates[0].value;
    const merchant = txBlock.find((line) => !isNoiseLine(line) && moneyMatches(line).length === 0 && !/^\d/.test(line)) || "unknown";
    const [day, month] = dateShort.split("/");
    const date = `${year}-${month}-${day}`;
    const description = txBlock
      .filter((line) => !isNoiseLine(line))
      .filter((line) => moneyMatches(line).length === 0)
      .slice(0, 7)
      .join(" | ");
    const id = crypto.createHash("sha1")
      .update([date, merchant, amount, doc.path, description, String(transactions.length)].join("|"))
      .digest("hex")
      .slice(0, 14);
    transactions.push({
      id,
      date,
      merchant,
      amount,
      direction: amount >= 0 ? "credit" : "debit",
      description,
      sourceDocument: doc.path,
      sourceName: doc.name
    });
  }
  return transactions;
}

function parseStatementSummary(doc) {
  if (doc.category !== "bank_statement" || !doc.text) return null;
  const text = String(doc.text || "");
  const period = text.match(/Du\s+(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/i);
  const entries = text.match(/Entr[ÃƒÂ©e]es\s*\n\s*(\+\s*[0-9][^\n]*EUR)/i);
  const exits = text.match(/Sorties\s*\n\s*(-\s*[0-9][^\n]*EUR)/i);
  const balances = [...text.matchAll(/Solde au\s+(\d{2}\/\d{2})\s*\n\s*([+-]\s*[0-9][^\n]*EUR)/gi)];
  return {
    sourceName: doc.name,
    sourceDocument: doc.path,
    periodStart: period?.[1] || null,
    periodEnd: period?.[2] || null,
    declaredCredits: entries ? moneyValue(entries[1]) : null,
    declaredDebits: exits ? moneyValue(exits[1]) : null,
    openingBalance: balances[0] ? moneyValue(balances[0][2]) : null,
    closingBalance: balances[balances.length - 1] ? moneyValue(balances[balances.length - 1][2]) : null
  };
}

function invoiceCandidate(doc) {
  if (!["invoice_or_receipt", "legal_company"].includes(doc.category)) return null;
  const amounts = moneyMatches(doc.text || "").map((m) => m.value);
  const positiveAbs = amounts.map((v) => Math.abs(v)).filter((v) => v > 0);
  const amount = positiveAbs.length ? Math.max(...positiveAbs) : null;
  const dates = dateMatches(doc.text || "");
  const vendor = firstLines(doc.text || doc.name, 8).find((line) => /[A-Za-zÃƒâ‚¬-ÃƒÂ¿]/.test(line)) || doc.name;
  return {
    id: doc.id,
    name: doc.name,
    path: doc.path,
    category: doc.category,
    vendor: vendor.slice(0, 140),
    amount,
    dates,
    textPreview: doc.textPreview
  };
}

function normalizeTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9ÃƒÂ -ÃƒÂ¿]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !["carte", "bank", "eur"].includes(t));
}

function invoiceMatchesForTransaction(tx, invoices) {
  return invoices.map((invoice) => {
    const amountMatch = Number.isFinite(invoice.amount) && Math.abs(Math.abs(tx.amount) - invoice.amount) < 0.06;
    const txTokens = normalizeTokens(tx.merchant + " " + tx.description);
    const invoiceTokens = normalizeTokens(invoice.vendor + " " + invoice.name + " " + invoice.textPreview);
    const tokenMatch = txTokens.some((token) => invoiceTokens.includes(token));
    const score = (amountMatch ? 0.7 : 0) + (tokenMatch ? 0.3 : 0);
    return {
      transactionId: tx.id,
      transactionDate: tx.date,
      transactionMerchant: tx.merchant,
      transactionAmount: tx.amount,
      invoiceId: invoice.id,
      invoiceName: invoice.name,
      invoicePath: invoice.path,
      invoiceVendor: invoice.vendor,
      invoiceAmount: invoice.amount,
      amountMatch,
      tokenMatch,
      score
    };
  }).filter((match) => match.amountMatch || match.tokenMatch)
    .sort((a, b) => b.score - a.score);
}

function hasInvoiceMatch(tx, invoices) {
  return invoiceMatchesForTransaction(tx, invoices).length > 0;
}

function likelyNeedsProof(tx) {
  if (tx.direction !== "debit") return false;
  if (Math.abs(tx.amount) < 1) return false;
  return true;
}

ensureDir(OUT_DIR);

const files = DOC_DIRS.flatMap(walk)
  .filter((file) => !/\/(\.git|node_modules)\//.test(file))
  .filter((file) => [".pdf", ".docx", ".txt", ".md", ".csv", ".html", ".htm", ".json"].includes(path.extname(file).toLowerCase()));

const documents = files.map((file) => {
  const st = fs.statSync(file);
  const text = extractText(file);
  const category = categoryFor(file, text);
  const amounts = moneyMatches(text).slice(0, 20);
  const item = {
    id: sha256(file).slice(0, 16),
    name: path.basename(file),
    path: file,
    relativePath: path.relative(ROOT, file),
    ext: path.extname(file).toLowerCase(),
    category,
    bytes: st.size,
    mtime: st.mtime.toISOString(),
    sha256: sha256(file),
    extractedChars: text.length,
    textPreview: redactSensitive(firstLines(text, 18).join(" | ")).slice(0, 1600),
    signals: {
      dates: dateMatches(text),
      amounts: amounts.map((m) => m.raw).slice(0, 20),
      hasIban: /\bFR\d{2}/.test(text),
      hasSirenOrSiret: /\b\d{9}(?:\d{5})?\b/.test(text)
    }
  };
  Object.defineProperty(item, "text", { value: text, enumerable: false });
  return item;
});

const bankStatementRecords = documents
  .filter((doc) => doc.category === "bank_statement")
  .map((doc) => ({
    doc,
    summary: parseStatementSummary(doc),
    transactions: parseBankTransactions(doc)
  }));
const canonicalStatementMap = new Map();
for (const record of bankStatementRecords) {
  const key = record.summary
    ? [record.summary.periodStart, record.summary.periodEnd, record.summary.declaredCredits, record.summary.declaredDebits].join("|")
    : record.doc.sha256;
  const current = canonicalStatementMap.get(key);
  if (!current || record.transactions.length > current.transactions.length) {
    canonicalStatementMap.set(key, record);
  }
}
const canonicalStatementRecords = [...canonicalStatementMap.values()];
const allTransactions = canonicalStatementRecords.flatMap((record) => record.transactions);
const bankTransactions = allTransactions;
const statementSummaries = canonicalStatementRecords.map((record) => record.summary).filter(Boolean);
const statementValidation = statementSummaries.map((summary) => {
  const txForStatement = bankTransactions.filter((tx) => tx.sourceName === summary.sourceName);
  const parsedCredits = txForStatement.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const parsedDebits = txForStatement.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0);
  const creditDelta = Number.isFinite(summary.declaredCredits) ? parsedCredits - summary.declaredCredits : null;
  const debitDelta = Number.isFinite(summary.declaredDebits) ? parsedDebits - summary.declaredDebits : null;
  const DELTA_TOLERANCE = 1.50; // bank API micro-fees / rounding. Deltas above this need investigation.
  const creditOk = creditDelta == null || Math.abs(creditDelta) < DELTA_TOLERANCE;
  const debitOk = debitDelta == null || Math.abs(debitDelta) < DELTA_TOLERANCE;
  const knownDeltasPath = path.join(OUT_DIR, "bank_statement_known_deltas.json");
  const knownDeltas = fs.existsSync(knownDeltasPath) ? JSON.parse(fs.readFileSync(knownDeltasPath, "utf8")) : [];
  const knownEntry = knownDeltas.find((d) => d.sourceName === summary.sourceName);
  const explained = knownEntry ? {
    credit: Number((knownEntry.creditDeltaExplained || 0).toFixed(2)),
    debit: Number((knownEntry.debitDeltaExplained || 0).toFixed(2)),
    note: knownEntry.explanation || ""
  } : null;
  const creditResidual = creditDelta == null ? 0 : Math.abs(creditDelta) - (explained ? explained.credit : 0);
  const debitResidual = debitDelta == null ? 0 : Math.abs(debitDelta) - (explained ? explained.debit : 0);
  const ok = (creditOk || creditResidual < DELTA_TOLERANCE) && (debitOk || debitResidual < DELTA_TOLERANCE);
  return {
    sourceName: summary.sourceName,
    periodStart: summary.periodStart,
    periodEnd: summary.periodEnd,
    declaredCredits: summary.declaredCredits,
    parsedCredits: Number(parsedCredits.toFixed(2)),
    creditDelta: creditDelta == null ? null : Number(creditDelta.toFixed(2)),
    declaredDebits: summary.declaredDebits,
    parsedDebits: Number(parsedDebits.toFixed(2)),
    debitDelta: debitDelta == null ? null : Number(debitDelta.toFixed(2)),
    openingBalance: summary.openingBalance,
    closingBalance: summary.closingBalance,
    transactionCount: txForStatement.length,
    ok,
    ...(explained ? { ok_explanation: explained.note, debitDeltaExplained: explained.debit, creditDeltaExplained: explained.credit } : {})
  };
});
const statementValidationSummary = {
  ok: statementValidation.length > 0 && statementValidation.every((item) => item.ok),
  statements: statementValidation,
  declaredCreditsTotal: Number(statementValidation.reduce((sum, item) => sum + (item.declaredCredits || 0), 0).toFixed(2)),
  parsedCreditsTotal: Number(statementValidation.reduce((sum, item) => sum + (item.parsedCredits || 0), 0).toFixed(2)),
  declaredDebitsTotal: Number(statementValidation.reduce((sum, item) => sum + (item.declaredDebits || 0), 0).toFixed(2)),
  parsedDebitsTotal: Number(statementValidation.reduce((sum, item) => sum + (item.parsedDebits || 0), 0).toFixed(2))
};
const invoiceCandidates = documents.map(invoiceCandidate).filter(Boolean);
const invoiceMatches = bankTransactions
  .filter(likelyNeedsProof)
  .flatMap((tx) => invoiceMatchesForTransaction(tx, invoiceCandidates).slice(0, 3));
const missingInvoices = bankTransactions
  .filter(likelyNeedsProof)
  .filter((tx) => !hasInvoiceMatch(tx, invoiceCandidates))
  .map((tx) => ({
    transactionId: tx.id,
    date: tx.date,
    merchant: tx.merchant,
    amount: tx.amount,
    description: tx.description,
    sourceDocument: tx.sourceName,
    reason: "No matching invoice/receipt candidate found by amount/vendor tokens"
  }));

const totals = bankTransactions.reduce((acc, tx) => {
  if (tx.amount >= 0) acc.credits += tx.amount;
  else acc.debits += tx.amount;
  return acc;
}, { credits: 0, debits: 0 });

const documentIndex = documents.map(({ text, ...doc }) => doc);
fs.writeFileSync(path.join(OUT_DIR, "document_index.json"), JSON.stringify(documentIndex, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "invoice_candidates.json"), JSON.stringify(invoiceCandidates, null, 2));

// Preserve bank API API source data Ã¢â‚¬â€ do not overwrite with PDF-parsed data if bank API API snapshot is current and ok.
const existingValidationPath = path.join(OUT_DIR, "bank_statement_validation.json");
let preserveBankApiSource = false;
try {
  const existing = JSON.parse(fs.readFileSync(existingValidationPath, "utf8"));
  preserveBankApiSource = existing && existing.ok === true && typeof existing.method === "string" && existing.method.startsWith("bank_api");
} catch {}

if (!preserveBankApiSource) {
  fs.writeFileSync(path.join(OUT_DIR, "bank_transactions.json"), JSON.stringify(bankTransactions, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "bank_statement_summaries.json"), JSON.stringify(statementSummaries, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "bank_statement_validation.json"), JSON.stringify(statementValidationSummary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "invoice_matches.json"), JSON.stringify(invoiceMatches, null, 2));
}
fs.writeFileSync(path.join(OUT_DIR, "missing_invoices.json"), JSON.stringify(missingInvoices, null, 2));

const byCategory = documentIndex.reduce((acc, doc) => {
  acc[doc.category] = (acc[doc.category] || 0) + 1;
  return acc;
}, {});

const dailyContext = [
  "# VBOARD Daily Evidence Context",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Documents indexed: ${documentIndex.length}`,
  `Categories: ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
  `Bank transactions parsed: ${bankTransactions.length}`,
  `Bank parser validation: ${statementValidationSummary.ok ? "OK" : "FAILED"}`,
  `Bank declared credits total: ${statementValidationSummary.declaredCreditsTotal.toFixed(2)} EUR`,
  `Bank parsed credits total: ${statementValidationSummary.parsedCreditsTotal.toFixed(2)} EUR`,
  `Bank declared debits total: ${statementValidationSummary.declaredDebitsTotal.toFixed(2)} EUR`,
  `Bank parsed debits total: ${statementValidationSummary.parsedDebitsTotal.toFixed(2)} EUR`,
  `Invoice/receipt candidates: ${invoiceCandidates.length}`,
  `Deterministic invoice matches: ${invoiceMatches.length}`,
  `Missing proof candidates: ${missingInvoices.length}`,
  "",
  "Key legal/company docs:",
  ...documentIndex.filter((d) => d.category === "legal_company").slice(0, 8).map((d) => `- ${d.name}: ${d.textPreview.slice(0, 240)}`),
  "",
  "Recent/large bank transactions needing proof:",
  ...missingInvoices
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 15)
    .map((m) => `- ${m.date} ${m.merchant} ${m.amount.toFixed(2)} EUR (${m.sourceDocument})`)
].join("\n");
fs.writeFileSync(path.join(OUT_DIR, "daily_context.md"), `${dailyContext}\n`);

// Run cfoStack build to generate double-entry ledger and finance_report.json
let cfoResult = null;
try {
  const cfoRun = spawnSync("node", [path.join(ROOT, "bin/vboard_finance_run.js"), "build"], {
    encoding: "utf8",
    timeout: 30000
  });
  if (cfoRun.stdout) {
    try { cfoResult = JSON.parse(cfoRun.stdout); } catch {}
  }
} catch {}

console.log(JSON.stringify({
  ok: true,
  generatedAt: new Date().toISOString(),
  documents: documentIndex.length,
  byCategory,
  bankTransactions: bankTransactions.length,
  bankStatementValidationOk: statementValidationSummary.ok,
  bankStatementValidation: statementValidationSummary,
  invoiceCandidates: invoiceCandidates.length,
  missingInvoices: missingInvoices.length,
  totals,
  preserveBankApiSource,
  cfoStack: cfoResult ? { ok: cfoResult.ok, status: cfoResult.status, version: cfoResult.version, transactions: cfoResult.validation && cfoResult.validation.transactionCount } : null
}, null, 2));

