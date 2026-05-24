"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function resolveUnderRoot(root, requestedPath) {
  const base = path.resolve(root);
  const target = path.resolve(base, requestedPath || ".");
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    const error = new Error("PATH_OUTSIDE_DATA_ROOT");
    error.code = "PATH_OUTSIDE_DATA_ROOT";
    error.status = 403;
    throw error;
  }
  return target;
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function bankAuthFromEnv(env = process.env) {
  if (env.BANK_API_AUTH && env.BANK_API_AUTH.includes(":")) return env.BANK_API_AUTH;
  if (env.BANK_API_LOGIN && env.BANK_API_SECRET) return `${env.BANK_API_LOGIN}:${env.BANK_API_SECRET}`;
  // Legacy aliases
  if (env.BANK_API_AUTH && env.BANK_API_AUTH.includes(":")) return env.BANK_API_AUTH;
  if (env.BANK_API_LOGIN && env.BANK_API_SECRET) return `${env.BANK_API_LOGIN}:${env.BANK_API_SECRET}`;
  return "";
}

function normalizeBankAmount(transaction) {
  let amount = round2(transaction.amount);
  const side = String(transaction.side || "").toLowerCase();
  if (side === "debit" && amount > 0) amount = -amount;
  if (side === "credit" && amount < 0) amount = Math.abs(amount);
  return amount;
}

function extractAttachmentIds(transaction) {
  if (Array.isArray(transaction.attachment_ids)) return transaction.attachment_ids.filter(Boolean);
  if (Array.isArray(transaction.attachmentIds)) return transaction.attachmentIds.filter(Boolean);
  if (Array.isArray(transaction.attachments)) {
    return transaction.attachments
      .map((attachment) => attachment && (attachment.id || attachment.attachment_id))
      .filter(Boolean);
  }
  return [];
}

function normalizeBankTransaction(transaction, source = {}) {
  const attachmentIds = extractAttachmentIds(transaction);
  return {
    id: transaction.id || transaction.transaction_id,
    transactionId: transaction.transaction_id || null,
    date: String(transaction.settled_at || transaction.emitted_at || "").slice(0, 10),
    settledAt: transaction.settled_at || null,
    emittedAt: transaction.emitted_at || null,
    merchant: transaction.label || transaction.note || transaction.subject_type || "Unknown",
    amount: normalizeBankAmount(transaction),
    currency: transaction.currency || "EUR",
    localAmount: transaction.local_amount ?? null,
    localCurrency: transaction.local_currency || null,
    side: transaction.side || null,
    cardLastDigits: transaction.card_last_digits || null,
    attachmentIds,
    bankAccountId: source.bankAccountId || transaction._bank_account_id || null,
    bankAccountName: source.bankAccountName || transaction._bank_account_name || null,
    sourceKind: "bank_api_full_snapshot"
  };
}

function matchKey(item) {
  return item && String(item.transactionId || item.bankTxId || item.sourceId || item.id || "");
}

function buildBankAttachmentMatches(transactions, existingMatches) {
  const matches = new Map();
  const currentKeys = new Set();
  for (const tx of transactions) {
    for (const value of [tx.id, tx.transactionId, tx.sourceId]) {
      if (value) currentKeys.add(String(value));
    }
  }

  for (const item of Array.isArray(existingMatches) ? existingMatches : []) {
    const key = matchKey(item);
    if (key && currentKeys.has(key)) matches.set(key, { ...item });
  }

  for (const tx of transactions) {
    if (!Array.isArray(tx.attachmentIds) || tx.attachmentIds.length === 0) continue;
    const key = String(tx.id || tx.transactionId || "");
    if (!key) continue;
    const existing = matches.get(key);
    if (existing) {
      matches.set(key, {
        ...existing,
        attachmentIds: existing.attachmentIds || tx.attachmentIds,
        source: existing.source || "bank_existing_attachment"
      });
      continue;
    }
    matches.set(key, {
      transactionId: tx.id || null,
      bankTxId: tx.transactionId || null,
      sourceId: tx.sourceId || tx.id || null,
      invoicePath: `bank://attachments/${tx.attachmentIds.join(",")}`,
      source: "bank_existing_attachment",
      confidence: 1,
      attachmentIds: tx.attachmentIds,
      note: "Bank transaction already had attachment evidence when pulled from the API."
    });
  }

  return [...matches.values()];
}

async function fetchJson(fetchImpl, auth, apiBase, pathname, params = {}) {
  const url = new URL(`${apiBase}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchImpl(url, { headers: { Authorization: auth } });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`BANK_API_${response.status}: ${text.slice(0, 500)}`);
    error.code = "BANK_API_ERROR";
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

async function fetchTransactionsForAccount(fetchImpl, auth, apiBase, account, since, side) {
  const transactions = [];
  let page = 1;
  for (;;) {
    const data = await fetchJson(fetchImpl, auth, apiBase, "/transactions", {
      bank_account_id: account.id,
      "includes[]": ["attachments"],
      "status[]": ["completed"],
      side,
      settled_at_from: since,
      per_page: 100,
      page,
      sort_by: "settled_at:asc"
    });
    for (const transaction of data.transactions || []) {
      transactions.push(normalizeBankTransaction(transaction, {
        bankAccountId: account.id,
        bankAccountName: account.name || account.slug || account.id
      }));
    }
    if (!data.meta || !data.meta.next_page) break;
    page = data.meta.next_page;
  }
  return transactions;
}

async function pullBankSnapshot(dataRoot, options = {}) {
  const root = path.resolve(dataRoot);
  const contextDir = resolveUnderRoot(root, options.contextDir || "ops/context");
  const apiBase = options.apiBase || process.env.BANK_API_BASE_URL || "https://bank-api.example";
  const auth = options.auth || bankAuthFromEnv(options.env || process.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const since = options.since || "2026-01-01T00:00:00Z";
  if (!auth || !auth.includes(":")) {
    const error = new Error("BANK_AUTH_MISSING");
    error.code = "BANK_AUTH_MISSING";
    throw error;
  }
  if (typeof fetchImpl !== "function") {
    const error = new Error("FETCH_UNAVAILABLE");
    error.code = "FETCH_UNAVAILABLE";
    throw error;
  }

  const orgPayload = await fetchJson(fetchImpl, auth, apiBase, "/organization");
  const organization = orgPayload.organization || orgPayload;
  const accounts = organization.bank_accounts || organization.bankAccounts || [];
  if (!accounts.length) {
    const error = new Error("BANK_ACCOUNTS_EMPTY");
    error.code = "BANK_ACCOUNTS_EMPTY";
    throw error;
  }

  const all = [];
  for (const account of accounts) {
    for (const side of ["credit", "debit"]) {
      all.push(...await fetchTransactionsForAccount(fetchImpl, auth, apiBase, account, since, side));
    }
  }


  const byId = new Map();
  for (const transaction of all) byId.set(transaction.id || transaction.transactionId, transaction);
  const transactions = [...byId.values()].sort((a, b) => `${a.date}:${a.id}`.localeCompare(`${b.date}:${b.id}`));
  const existingMatches = readJson(path.join(contextDir, "invoice_matches.json"), []);
  const invoiceMatches = buildBankAttachmentMatches(transactions, existingMatches);
  const credits = round2(transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0));
  const debits = round2(transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0));
  const generatedAt = new Date().toISOString();

  const validation = {
    ok: true,
    method: "bank_api_full_snapshot",
    scope: "full_transaction_snapshot",
    generatedAt,
    since,
    accountCount: accounts.length,
    transactionCount: transactions.length,
    declaredCreditsTotal: credits,
    parsedCreditsTotal: credits,
    declaredDebitsTotal: debits,
    parsedDebitsTotal: debits,
    openingBalance: options.openingBalance == null ? null : round2(options.openingBalance),
    closingBalance: options.closingBalance == null ? null : round2(options.closingBalance),
    warning: "Bank API full snapshot is accepted as source-of-record for a working pack. It is not a signed bank-statement attestation."
  };

  writeJson(path.join(contextDir, "bank_transactions.json"), transactions);
  writeJson(path.join(contextDir, "invoice_matches.json"), invoiceMatches);
  writeJson(path.join(contextDir, "bank_statement_validation.json"), validation);

  return {
    ok: true,
    status: "ready",
    generatedAt,
    contextDir: path.relative(root, contextDir),
    organization: {
      id: organization.id || null,
      slug: organization.slug || null,
      name: organization.name || null
    },
    accountCount: accounts.length,
    transactionCount: transactions.length,
    invoiceMatchCount: invoiceMatches.length,
    credits,
    debits,
    files: {
      transactions: path.relative(root, path.join(contextDir, "bank_transactions.json")),
      invoiceMatches: path.relative(root, path.join(contextDir, "invoice_matches.json")),
      bankValidation: path.relative(root, path.join(contextDir, "bank_statement_validation.json"))
    },
    validation: {
      ok: validation.ok,
      method: validation.method,
      scope: validation.scope,
      warning: validation.warning
    }
  };
}

module.exports = {
  pullBankSnapshot,
  bankAuthFromEnv,
  normalizeBankTransaction,
  extractAttachmentIds,
  buildBankAttachmentMatches,
  // Legacy aliases — kept for backward compatibility
  pullBankSnapshot: pullBankSnapshot,
  bankAuthFromEnv: bankAuthFromEnv,
  buildBankAttachmentMatches: buildBankAttachmentMatches
};
