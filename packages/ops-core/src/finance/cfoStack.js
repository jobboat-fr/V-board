"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VERSION = "0.2.0";
const CURRENCY = "EUR";

const CHART_OF_ACCOUNTS = {
  "Assets:Bank:Main-EUR": { type: "asset", desc: "Main bank EUR account" },
  "Assets:Receivable:Clients": { type: "asset", desc: "Client invoices outstanding" },
  "Equity:OpeningBalances": { type: "equity", desc: "Verified opening bank balance" },
  "Equity:OwnerCurrentAccount": { type: "equity", desc: "Owner injections and current account" },
  "Equity:ExternalCapital": { type: "equity", desc: "External capital movements" },
  "Income:Consulting": { type: "income", desc: "Client consulting revenue" },
  "Income:Refunds": { type: "income", desc: "Supplier/platform refunds" },
  "Income:Other": { type: "income", desc: "Other income" },
  "Expenses:Bank:Fees": { type: "expense", desc: "Bank, card, and conversion fees" },
  "Expenses:Cloud:Vercel": { type: "expense", desc: "Vercel hosting and domains" },
  "Expenses:Cloud:Railway": { type: "expense", desc: "Railway hosting" },
  "Expenses:Cloud:VPS": { type: "expense", desc: "VPS hosting and domains" },
  "Expenses:Software:Cursor": { type: "expense", desc: "Cursor AI IDE" },
  "Expenses:Software:Windsurf": { type: "expense", desc: "Windsurf AI IDE" },
  "Expenses:Software:AI-primary LLM provider": { type: "expense", desc: "primary LLM provider API" },
  "Expenses:Software:AI-reviewer LLM provider": { type: "expense", desc: "reviewer LLM provider API" },
  "Expenses:Software:AI-FallbackProvider": { type: "expense", desc: "fallback LLM provider inference" },
  "Expenses:Software:AI-LLM provider": { type: "expense", desc: "LLM provider inference" },
  "Expenses:Software:AI-AdCreative": { type: "expense", desc: "AdCreative AI marketing" },
  "Expenses:Software:AI-voice provider": { type: "expense", desc: "voice provider API" },
  "Expenses:Software:AI-Video-Runway": { type: "expense", desc: "Runway AI video" },
  "Expenses:Software:AI-Video-Synthesia": { type: "expense", desc: "Synthesia AI video" },
  "Expenses:Software:AI-Video-Kling": { type: "expense", desc: "Kling AI video" },
  "Expenses:Software:Apple": { type: "expense", desc: "Apple subscriptions" },
  "Expenses:Software:GenericCloud": { type: "expense", desc: "chair LLM provider subscriptions" },
  "Expenses:Software:Zoho": { type: "expense", desc: "Zoho software subscriptions" },
  "Expenses:Software:Other": { type: "expense", desc: "Other SaaS and software" },
  "Expenses:Meals-Coworking": { type: "expense", desc: "Coworking cafe" },
  "Expenses:Meals": { type: "expense", desc: "Meals and groceries" },
  "Expenses:Transport": { type: "expense", desc: "Transport" },
  "Expenses:Professional:DueDiligence": { type: "expense", desc: "Due diligence and company verification" },
  "Expenses:Uncategorized": { type: "expense", desc: "Unclassified expense - owner/accountant review required" },
  "Income:Uncategorized": { type: "income", desc: "Unclassified income - owner/accountant review required" }
};

// Classification rules map merchant-name patterns to Beancount accounts.
// Add your own rules here — these are examples only.
// Pattern is matched against the transaction merchant/label field.
const CLASSIFICATION_RULES = [
  // Income
  [/^CONSULTING CLIENT/i, "Income:Consulting", "Client consulting revenue"],
  [/^chair LLM provider Payment/i, "Income:Other", "chair LLM provider payment"],
  // Owner / equity movements
  [/^OWNER TRANSFER/i, "Equity:OwnerCurrentAccount", "Owner capital/current-account movement"],
  [/^EXTERNAL CAPITAL/i, "Equity:ExternalCapital", "External capital movement"],
  [/^OPENING BALANCE/i, "Equity:OpeningBalances", "Bank account opening balance"],
  // Bank fees
  [/^BANK FEE/i, "Expenses:Bank:Fees", "Bank fee"],
  [/^Revolut\*\*/i, "Expenses:Bank:Fees", "Revolut fee"],
  // Cloud hosting
  [/^VERCEL/i, "Expenses:Cloud:Vercel", "Vercel hosting/domains"],
  [/^RAILWAY/i, "Expenses:Cloud:Railway", "Railway hosting"],
  [/^VPS |^CLOUD HOST/i, "Expenses:Cloud:VPS", "VPS/cloud hosting"],
  // AI tooling
  [/^CURSOR/i, (amount) => amount >= 0 ? "Income:Refunds" : "Expenses:Software:Cursor", "Cursor AI IDE"],
  [/^WINDSURF/i, "Expenses:Software:Windsurf", "Windsurf AI IDE"],
  [/^PRIMARY LLM/i, "Expenses:Software:AI-primary LLM provider", "primary LLM provider API"],
  [/^REVIEWER LLM/i, "Expenses:Software:AI-reviewer LLM provider", "reviewer LLM provider API"],
  [/^FALLBACK LLM/i, "Expenses:Software:AI-FallbackProvider", "fallback LLM provider inference"],
  [/^REMOTE LLM/i, "Expenses:Software:AI-LLM provider", "LLM provider inference"],
  [/^ADCREATIVEAI/i, (amount) => amount >= 0 ? "Income:Refunds" : "Expenses:Software:AI-AdCreative", "AdCreative AI"],
  [/^VOICE PROVIDER/i, "Expenses:Software:AI-voice provider", "voice provider API"],
  [/^RUNWAY/i, "Expenses:Software:AI-Video-Runway", "Runway AI video"],
  [/^SYNTHESIA/i, "Expenses:Software:AI-Video-Synthesia", "Synthesia AI video"],
  [/^KLINGAI/i, "Expenses:Software:AI-Video-Kling", "Kling AI video"],
  // Software subscriptions
  [/^APPLE/i, "Expenses:Software:Apple", "Apple subscription"],
  [/^CHAIR LLM \*Play|^chair LLM provider Chrome/i, "Expenses:Software:GenericCloud", "chair LLM provider subscription"],
  [/^ZOHO/i, "Expenses:Software:Zoho", "Zoho software"],
  // Other
  [/^COWORKING/i, "Expenses:Meals-Coworking", "Coworking cafe"],
  [/^DUE DILIGENCE/i, "Expenses:Professional:DueDiligence", "Due diligence"]
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeReadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, value, "utf8");
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

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function fmt(value) {
  return round2(value).toFixed(2);
}

function monthOf(date) {
  return String(date || "unknown").slice(0, 7);
}

function normalizeAmount(value) {
  if (typeof value === "number") return round2(value);
  if (typeof value === "string") {
    const cleaned = value.replace(/\s/g, "").replace(",", ".");
    return round2(Number(cleaned));
  }
  return 0;
}

function hashId(parts) {
  return crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 12);
}

function normalizeTransactions(rows) {
  const seen = new Map();
  return rows.map((row, index) => {
    const date = String(row.date || row.settledAt || row.settled_at || row.operationDate || row.operation_date || row.createdAt || row.created_at || "").slice(0, 10);
    const merchant = String(row.merchant || row.counterpartyName || row.label || row.description || row.name || "Unknown").trim();
    let amount = normalizeAmount(row.amount != null ? row.amount : row.value);
    const side = String(row.side || row.operationType || row.operation_type || "").toLowerCase();
    if (side === "debit" && amount > 0) amount = -amount;
    if (side === "credit" && amount < 0) amount = Math.abs(amount);
    const sourceId = String(row.id || row.transactionId || row.bankTxId || hashId([date, merchant, String(amount), row.sourceDocument, String(index)]));
    const n = (seen.get(sourceId) || 0) + 1;
    seen.set(sourceId, n);
    return {
      ...row,
      id: sourceId,
      occurrenceId: n === 1 ? sourceId : `${sourceId}#${n}`,
      sourceId,
      sourceIndex: index,
      date,
      merchant,
      amount
    };
  });
}

function classifyTransaction(tx) {
  for (const [pattern, accountOrFn, description] of CLASSIFICATION_RULES) {
    if (pattern.test(tx.merchant || "")) {
      const account = typeof accountOrFn === "function" ? accountOrFn(tx.amount) : accountOrFn;
      return { account, description, matched: true };
    }
  }
  return {
    account: tx.amount >= 0 ? "Income:Uncategorized" : "Expenses:Uncategorized",
    description: tx.merchant || "Unclassified transaction",
    matched: false
  };
}

function accountType(account) {
  return (CHART_OF_ACCOUNTS[account] || {}).type || "expense";
}

function signedDebit(value) {
  const n = normalizeAmount(value);
  if (n <= 0) return n;
  return -Math.abs(n);
}

function extractValidation(validation) {
  if (!validation) {
    return {
      ok: false,
      status: "missing",
      blockers: ["BANK_STATEMENT_VALIDATION_MISSING"],
      facts: ["[EMP] bank_statement_validation.json was not found."]
    };
  }

  const declaredCredits = normalizeAmount(validation.declaredCreditsTotal ?? validation.declaredCredits ?? validation.creditsTotal);
  const parsedCredits = normalizeAmount(validation.parsedCreditsTotal ?? validation.parsedCredits ?? validation.creditsParsed);
  const declaredDebits = signedDebit(validation.declaredDebitsTotal ?? validation.declaredDebits ?? validation.debitsTotal);
  const parsedDebits = signedDebit(validation.parsedDebitsTotal ?? validation.parsedDebits ?? validation.debitsParsed);
  const creditDelta = round2(parsedCredits - declaredCredits);
  const debitDelta = round2(parsedDebits - declaredDebits);
  const openingBalance = validation.openingBalance ?? validation.declaredOpeningBalance ?? validation.startBalance ?? null;
  const closingBalance = validation.closingBalance ?? validation.declaredClosingBalance ?? validation.endBalance ?? null;
  const periodNetDeclared = round2(declaredCredits + declaredDebits);
  const periodNetParsed = round2(parsedCredits + parsedDebits);
  const explicitOk = validation.ok === true;
  const totalsMatch = Math.abs(creditDelta) < 0.01 && Math.abs(debitDelta) < 0.01;
  const inferredOk = totalsMatch && (declaredCredits !== 0 || declaredDebits !== 0);
  const ok = (explicitOk && totalsMatch) || (validation.ok == null && inferredOk);
  const blockers = ok
    ? []
    : [
      "BANK_STATEMENT_VALIDATION_FAILED",
      ...(explicitOk && !totalsMatch ? ["BANK_STATEMENT_TOTALS_MISMATCH"] : [])
    ];

  return {
    ok,
    status: ok ? "ok" : "failed",
    blockers,
    declaredCredits,
    parsedCredits,
    declaredDebits,
    parsedDebits,
    creditDelta,
    debitDelta,
    openingBalance: openingBalance == null ? null : normalizeAmount(openingBalance),
    closingBalance: closingBalance == null ? null : normalizeAmount(closingBalance),
    method: validation.method || null,
    sourceReport: validation.sourceReport || null,
    warning: validation.warning || null,
    periodNetDeclared,
    periodNetParsed,
    rawOk: validation.ok,
    facts: [
      `[EMP] Bank validation status: ${ok ? "ok" : "failed"}.`,
      `[EMP] Declared credits: ${fmt(declaredCredits)} ${CURRENCY}; parsed credits: ${fmt(parsedCredits)} ${CURRENCY}; delta: ${fmt(creditDelta)} ${CURRENCY}.`,
      `[EMP] Declared debits: ${fmt(declaredDebits)} ${CURRENCY}; parsed debits: ${fmt(parsedDebits)} ${CURRENCY}; delta: ${fmt(debitDelta)} ${CURRENCY}.`
    ]
  };
}

function matchInvoice(tx, matches) {
  return matches.find((item) => (
    item.transactionId === tx.id ||
    item.bankTxId === tx.id ||
    item.transactionId === tx.occurrenceId ||
    item.bankTxId === tx.occurrenceId ||
    item.sourceId === tx.sourceId
  ));
}

function summarizeByMonth(classified) {
  const monthly = {};
  for (const tx of classified) {
    const month = monthOf(tx.date);
    if (!monthly[month]) {
      monthly[month] = { credits: 0, debits: 0, income: 0, expenses: 0, equity: 0, byAccount: {} };
    }
    const bucket = monthly[month];
    const amount = tx.amount;
    const type = accountType(tx.account);
    bucket.byAccount[tx.account] = round2((bucket.byAccount[tx.account] || 0) + Math.abs(amount));
    if (amount >= 0) {
      bucket.credits = round2(bucket.credits + amount);
      if (type === "income") bucket.income = round2(bucket.income + amount);
      if (type === "equity") bucket.equity = round2(bucket.equity + amount);
    } else {
      bucket.debits = round2(bucket.debits + Math.abs(amount));
      if (type === "expense") bucket.expenses = round2(bucket.expenses + Math.abs(amount));
    }
  }
  return monthly;
}

function calculateTotals(classified, validationInfo) {
  const accountTotals = {};
  function add(account, amount) {
    accountTotals[account] = round2((accountTotals[account] || 0) + amount);
  }

  for (const tx of classified) {
    if (tx.amount >= 0) {
      add("Assets:Bank:Main-EUR", tx.amount);
      add(tx.account, -tx.amount);
    } else {
      add("Assets:Bank:Main-EUR", tx.amount);
      add(tx.account, Math.abs(tx.amount));
    }
  }

  const periodNetMovement = round2(accountTotals["Assets:Bank:Main-EUR"] || 0);
  const openingBalance = validationInfo.openingBalance;
  const computedClosingBalance = openingBalance == null ? null : round2(openingBalance + periodNetMovement);
  const declaredClosingBalance = validationInfo.closingBalance;
  const closingBalanceDelta = computedClosingBalance == null || declaredClosingBalance == null
    ? null
    : round2(computedClosingBalance - declaredClosingBalance);

  const income = Object.entries(accountTotals)
    .filter(([account]) => accountType(account) === "income")
    .reduce((sum, [, amount]) => round2(sum + Math.abs(amount)), 0);
  const expenses = Object.entries(accountTotals)
    .filter(([account]) => accountType(account) === "expense")
    .reduce((sum, [, amount]) => round2(sum + amount), 0);
  const equity = Object.entries(accountTotals)
    .filter(([account]) => accountType(account) === "equity")
    .reduce((sum, [, amount]) => round2(sum + Math.abs(amount)), 0);

  const retainedEarnings = round2(income - expenses);
  const doubleEntryError = round2(Math.abs(periodNetMovement - (equity + retainedEarnings)));

  return {
    accountTotals,
    periodNetMovement,
    openingBalance,
    computedClosingBalance,
    declaredClosingBalance,
    closingBalanceDelta,
    income,
    expenses,
    equity,
    retainedEarnings,
    doubleEntryError
  };
}

function beancountEscape(value) {
  return String(value || "").replace(/"/g, "'");
}

function renderAccounts() {
  const lines = [
    "; Example Company - Chart of Accounts",
    `; Generated by cfo-stack ${VERSION}`,
    "",
    "option \"title\" \"Example Company\"",
    `option "operating_currency" "${CURRENCY}"`,
    ""
  ];
  for (const [account, meta] of Object.entries(CHART_OF_ACCOUNTS)) {
    lines.push(`2026-01-01 open ${account.padEnd(46)} ${CURRENCY}  ; ${meta.desc}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderMonthlyLedger(month, txs, runningBalance) {
  const lines = [
    `; Example Company - Transactions ${month}`,
    `; Generated by cfo-stack ${VERSION}`,
    ""
  ];
  for (const tx of [...txs].sort((a, b) => `${a.date}:${a.occurrenceId}`.localeCompare(`${b.date}:${b.occurrenceId}`))) {
    const amount = tx.amount;
    const abs = Math.abs(amount);
    const payee = beancountEscape(tx.merchant);
    const desc = beancountEscape(tx.accountDescription);
    const proof = tx.invoiceFile ? `\n  ; proof: ${tx.invoiceFile}` : "";
    const source = path.basename(tx.sourceDocument || "unknown");
    const classification = tx.classified ? "auto" : "review-required";
    if (amount >= 0) {
      lines.push(
        `${tx.date} * "${payee}" "${desc}"`,
        `  Assets:Bank:Main-EUR          ${fmt(abs)} ${CURRENCY}`,
        `  ${tx.account.padEnd(34)} ${fmt(-abs)} ${CURRENCY}${proof}`,
        `  ; source: ${source} | id: ${tx.occurrenceId} | classify: ${classification}`,
        ""
      );
    } else {
      lines.push(
        `${tx.date} * "${payee}" "${desc}"`,
        `  ${tx.account.padEnd(34)} ${fmt(abs)} ${CURRENCY}${proof}`,
        `  Assets:Bank:Main-EUR          ${fmt(-abs)} ${CURRENCY}`,
        `  ; source: ${source} | id: ${tx.occurrenceId} | classify: ${classification}`,
        ""
      );
    }
  }
  const [year, monthNo] = month.split("-").map(Number);
  const day = new Date(year, monthNo, 0).getDate();
  lines.push(`${month}-${String(day).padStart(2, "0")} balance Assets:Bank:Main-EUR ${fmt(runningBalance)} ${CURRENCY}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderRules() {
  const lines = [
    "# Example Company - Classification Rules",
    `# Generated by cfo-stack ${VERSION}`,
    "",
    "rules:"
  ];
  for (const [pattern, accountOrFn] of CLASSIFICATION_RULES) {
    const account = typeof accountOrFn === "function" ? "conditional" : accountOrFn;
    lines.push(`  - { pattern: "${String(pattern).replace(/^\/|\/[a-z]*$/g, "")}", account: "${account}", currency: ${CURRENCY} }`);
  }
  return `${lines.join("\n")}\n`;
}

function renderSummaryMarkdown(report) {
  const lines = [
    "# VBOARD CFO Stack Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Currency: ${report.currency}`,
    ""
  ];
  if (report.status === "blocked") {
    lines.push("## Blockers", "");
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
    lines.push("", "## Facts", "");
    for (const fact of report.facts) lines.push(`- ${fact}`);
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    "## Summary",
    "",
    `- Period net movement: ${fmt(report.summary.periodNetMovement)} ${CURRENCY}`,
    `- Client revenue: ${fmt(report.summary.clientRevenue)} ${CURRENCY}`,
    `- Expenses: ${fmt(report.summary.totalExpenses)} ${CURRENCY}`,
    `- Owner/equity movements: ${fmt(report.summary.ownerInjections)} ${CURRENCY}`,
    `- Unclassified transactions: ${report.validation.unclassifiedCount}`,
    `- Invoice-linked transactions: ${report.validation.invoiceLinkedCount}`,
    "",
    "## Files",
    ""
  );
  for (const [name, file] of Object.entries(report.outputs)) lines.push(`- ${name}: ${file}`);
  return `${lines.join("\n")}\n`;
}

function buildBlockedReport(reason, details) {
  const generatedAt = new Date().toISOString();
  return {
    ok: false,
    status: "blocked",
    engine: "vboard-cfo-stack",
    version: VERSION,
    generatedAt,
    currency: CURRENCY,
    blockers: [reason, ...(details.blockers || [])],
    facts: details.facts || [],
    sourceFiles: details.sourceFiles || {},
    outputs: {},
    validation: details.validation || null,
    message: "CFO stack refused to generate accounting outputs until evidence is complete and validated."
  };
}

function buildCfoStack(dataRoot, options = {}) {
  const root = path.resolve(dataRoot);
  const contextDir = resolveUnderRoot(root, options.contextDir || "ops/context");
  const outputDir = resolveUnderRoot(root, options.outputDir || "finance");
  const reportsDir = path.join(outputDir, "reports");
  const ledgerDir = path.join(outputDir, "ledger");
  const transactionsFile = path.join(contextDir, "bank_transactions.json");
  const validationFile = path.join(contextDir, "bank_statement_validation.json");
  const matchesFile = path.join(contextDir, "invoice_matches.json");
  const strict = options.strict !== false;

  const sourceFiles = {
    transactions: path.relative(root, transactionsFile),
    bankValidation: path.relative(root, validationFile),
    invoiceMatches: path.relative(root, matchesFile)
  };

  const rawTransactions = safeReadJson(transactionsFile, []);
  const validation = safeReadJson(validationFile, null);
  const matches = safeReadJson(matchesFile, []);
  const validationInfo = extractValidation(validation);

  if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
    const report = buildBlockedReport("BANK_TRANSACTIONS_MISSING", {
      sourceFiles,
      validation: validationInfo,
      facts: ["[EMP] bank_transactions.json was missing or empty.", ...validationInfo.facts]
    });
    writeJson(path.join(reportsDir, "finance_report.json"), report);
    writeText(path.join(reportsDir, "finance_summary.md"), renderSummaryMarkdown(report));
    return report;
  }

  if (strict && !options.allowUnverified && !validationInfo.ok) {
    const report = buildBlockedReport("BANK_VALIDATION_NOT_OK", {
      sourceFiles,
      validation: validationInfo,
      blockers: validationInfo.blockers,
      facts: [
        `[EMP] ${rawTransactions.length} transactions were present but accounting generation was blocked.`,
        ...validationInfo.facts
      ]
    });
    writeJson(path.join(reportsDir, "finance_report.json"), report);
    writeText(path.join(reportsDir, "finance_summary.md"), renderSummaryMarkdown(report));
    return report;
  }

  const normalized = normalizeTransactions(rawTransactions);
  const classified = normalized.map((tx) => {
    const result = classifyTransaction(tx);
    const invoice = matchInvoice(tx, Array.isArray(matches) ? matches : []);
    return {
      ...tx,
      account: result.account,
      accountDescription: result.description,
      classified: result.matched,
      invoiceLinked: Boolean(invoice),
      invoiceFile: invoice ? (invoice.invoicePath || invoice.file || invoice.path || null) : null
    };
  });

  const monthly = summarizeByMonth(classified);
  const months = Object.keys(monthly).sort();
  const totals = calculateTotals(classified, validationInfo);
  const unclassified = classified.filter((tx) => !tx.classified);
  const invoiceLinkedCount = classified.filter((tx) => tx.invoiceLinked).length;
  const avgMonthlyExpenses = months.length ? round2(totals.expenses / months.length) : 0;
  const avgMonthlyRevenue = months.length ? round2(totals.income / months.length) : 0;
  const avgMonthlyBurn = round2(avgMonthlyExpenses - avgMonthlyRevenue);
  const runwayMonths = avgMonthlyBurn > 0 && totals.computedClosingBalance != null
    ? round2(totals.computedClosingBalance / avgMonthlyBurn)
    : null;
  const topExpenses = Object.entries(totals.accountTotals)
    .filter(([account]) => accountType(account) === "expense")
    .sort((a, b) => b[1] - a[1])
    .map(([account, amount]) => ({
      account,
      amount: round2(amount),
      pct: totals.expenses > 0 ? round2(amount / totals.expenses * 100) : 0,
      description: CHART_OF_ACCOUNTS[account].desc
    }));

  ensureDir(path.join(ledgerDir, "2026"));
  ensureDir(path.join(ledgerDir, "rules"));
  writeText(path.join(ledgerDir, "accounts.beancount"), renderAccounts());

  const byMonth = {};
  for (const tx of classified) {
    const month = monthOf(tx.date);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(tx);
  }

  let runningBalance = validationInfo.openingBalance == null ? 0 : validationInfo.openingBalance;
  for (const month of Object.keys(byMonth).sort()) {
    for (const tx of byMonth[month]) runningBalance = round2(runningBalance + tx.amount);
    writeText(path.join(ledgerDir, "2026", `${month}-transactions.beancount`), renderMonthlyLedger(month, byMonth[month], runningBalance));
  }

  const mainLines = [
    "; Example Company - Main Ledger",
    `; Engine: vboard-cfo-stack ${VERSION}`,
    "",
    "include \"accounts.beancount\"",
    "",
    ...Object.keys(byMonth).sort().map((month) => `include "2026/${month}-transactions.beancount"`),
    "",
    `; Period net movement: ${fmt(totals.periodNetMovement)} ${CURRENCY}`,
    `; Generated: ${new Date().toISOString()}`
  ];
  writeText(path.join(ledgerDir, "main.beancount"), `${mainLines.join("\n")}\n`);
  writeText(path.join(ledgerDir, "rules", "classify-rules.yaml"), renderRules());

  const outputs = {
    report: path.relative(root, path.join(reportsDir, "finance_report.json")),
    summary: path.relative(root, path.join(reportsDir, "finance_summary.md")),
    manifest: path.relative(root, path.join(reportsDir, "manifest.json")),
    mainLedger: path.relative(root, path.join(ledgerDir, "main.beancount")),
    accounts: path.relative(root, path.join(ledgerDir, "accounts.beancount")),
    rules: path.relative(root, path.join(ledgerDir, "rules", "classify-rules.yaml"))
  };

  const report = {
    ok: true,
    status: "ok",
    engine: "vboard-cfo-stack",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    currency: CURRENCY,
    sourceFiles,
    outputs,
    ledgerPeriod: {
      start: months.length ? `${months[0]}-01` : "unknown",
      end: months.length ? months[months.length - 1] : "unknown"
    },
    summary: {
      periodNetMovement: totals.periodNetMovement,
      openingBalance: totals.openingBalance,
      computedClosingBalance: totals.computedClosingBalance,
      declaredClosingBalance: totals.declaredClosingBalance,
      closingBalanceDelta: totals.closingBalanceDelta,
      clientRevenue: totals.income,
      ownerInjections: totals.equity,
      totalExpenses: totals.expenses,
      retainedEarnings: totals.retainedEarnings,
      avgMonthlyExpenses,
      avgMonthlyRevenue,
      avgMonthlyBurn,
      runwayMonths,
      topExpenseCategory: topExpenses[0] ? topExpenses[0].account : "none",
      topExpenseAmount: topExpenses[0] ? topExpenses[0].amount : 0
    },
    incomeStatement: {
      periods: monthly,
      ytd: {
        clientRevenue: totals.income,
        ownerInjections: totals.equity,
        totalExpenses: totals.expenses,
        netOperatingIncome: round2(totals.income - totals.expenses)
      }
    },
    balanceSheet: {
      assets: {
        bankPeriodMovement: totals.periodNetMovement,
        openingBalance: totals.openingBalance,
        computedClosingBalance: totals.computedClosingBalance
      },
      equity: totals.equity,
      retainedEarnings: totals.retainedEarnings,
      doubleEntryBalanced: totals.doubleEntryError < 0.01,
      doubleEntryError: totals.doubleEntryError
    },
    expenseBreakdown: {
      total: totals.expenses,
      ranked: topExpenses
    },
    validation: {
      bankStatementValidation: validationInfo,
      transactionCount: classified.length,
      classifiedCount: classified.length - unclassified.length,
      unclassifiedCount: unclassified.length,
      classificationRate: classified.length ? round2((classified.length - unclassified.length) / classified.length * 100) : 0,
      invoiceLinkedCount,
      duplicateSourceIds: classified
        .filter((tx) => tx.occurrenceId !== tx.sourceId)
        .map((tx) => ({ sourceId: tx.sourceId, occurrenceId: tx.occurrenceId }))
    },
    missingDocuments: classified
      .filter((tx) => tx.amount < 0 && !tx.invoiceLinked)
      .map((tx) => ({ id: tx.occurrenceId, date: tx.date, merchant: tx.merchant, amount: tx.amount, account: tx.account })),
    unclassifiedTransactions: unclassified
      .map((tx) => ({ id: tx.occurrenceId, date: tx.date, merchant: tx.merchant, amount: tx.amount })),
    facts: [
      `[EMP] CFO stack ${VERSION} processed ${classified.length} transactions across ${months.length} months.`,
      `[EMP] Bank validation was ok before accounting artifacts were generated.`,
      `[EMP] Period net movement: ${fmt(totals.periodNetMovement)} ${CURRENCY}.`,
      `[EMP] Client revenue: ${fmt(totals.income)} ${CURRENCY}; expenses: ${fmt(totals.expenses)} ${CURRENCY}.`,
      `[EMP] ${invoiceLinkedCount} transactions are linked to invoice/receipt evidence.`,
      `[EMP] ${unclassified.length} transactions require classification review.`
    ],
    caveats: [
      "This is an accountant-ready working pack, not a tax filing.",
      "No payment, filing, legal commitment, or declaration is authorized by this engine."
    ]
  };

  const manifest = {
    ok: true,
    generatedAt: report.generatedAt,
    engine: report.engine,
    version: report.version,
    outputs,
    sourceFiles,
    transactionCount: classified.length,
    status: report.status
  };
  writeJson(path.join(reportsDir, "finance_report.json"), report);
  writeText(path.join(reportsDir, "finance_summary.md"), renderSummaryMarkdown(report));
  writeJson(path.join(reportsDir, "manifest.json"), manifest);
  return report;
}

function bankTransactionAmount(transaction) {
  let amount = normalizeAmount(transaction.amount);
  const side = String(transaction.side || "").toLowerCase();
  if (side === "debit" && amount > 0) amount = -amount;
  if (side === "credit" && amount < 0) amount = Math.abs(amount);
  return amount;
}

function importBankReconciliation(dataRoot, reportPath, options = {}) {
  if (!reportPath) {
    const error = new Error("BANK_REPORT_PATH_REQUIRED");
    error.code = "BANK_REPORT_PATH_REQUIRED";
    throw error;
  }
  const root = path.resolve(dataRoot);
  const contextDir = resolveUnderRoot(root, options.contextDir || "ops/context");
  const sourceFile = options.restrictToDataRoot
    ? resolveUnderRoot(root, reportPath)
    : path.resolve(reportPath);
  const payload = safeReadJson(sourceFile, null);
  if (!payload || !Array.isArray(payload.transactions)) {
    const error = new Error("BANK_REPORT_INVALID");
    error.code = "BANK_REPORT_INVALID";
    throw error;
  }

  const transactions = payload.transactions.map((tx, index) => ({
    id: tx.id || tx.transaction_id || hashId([tx.settled_at, tx.label, String(tx.amount), String(index)]),
    transactionId: tx.transaction_id || null,
    date: String(tx.settled_at || tx.emitted_at || "").slice(0, 10),
    settledAt: tx.settled_at || null,
    emittedAt: tx.emitted_at || null,
    merchant: tx.label || "Unknown",
    amount: bankTransactionAmount(tx),
    currency: tx.currency || CURRENCY,
    localAmount: tx.local_amount ?? null,
    localCurrency: tx.local_currency || null,
    side: tx.side || null,
    cardLastDigits: tx.card_last_digits || null,
    attachmentIds: tx.attachment_ids || [],
    sourceDocument: path.basename(sourceFile),
    sourceKind: "bank_api_reconciliation_report"
  }));

  const uploadMatches = new Map();
  for (const upload of payload.uploads || []) {
    if (!upload.ok || !upload.transactionId || !upload.file) continue;
    uploadMatches.set(upload.transactionId, {
      transactionId: upload.transactionId,
      invoicePath: upload.file,
      source: "bank_upload",
      confidence: 1,
      idempotencyKey: upload.idempotencyKey || null
    });
  }

  const dryRunAttachMatches = new Map();
  if (options.includeDryRunAttach === true) {
    for (const decision of payload.decisions || []) {
      if (decision.action !== "attach" || !decision.transaction?.id || !decision.receipt?.file) continue;
      dryRunAttachMatches.set(decision.transaction.id, {
        transactionId: decision.transaction.id,
        invoicePath: decision.receipt.file,
        source: "bank_decision_attach_dry_run",
        confidence: decision.score || null,
        reasons: decision.reasons || []
      });
    }
  }

  const invoiceMatches = [...uploadMatches.values(), ...[...dryRunAttachMatches.values()].filter((item) => !uploadMatches.has(item.transactionId))];
  const credits = round2(transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0));
  const debits = round2(transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0));
  const debitOnlySnapshot = transactions.length > 0 && debits < 0 && credits === 0;
  const trustedFullSnapshot = (options.trustBankApi === true || options.trustBankApi === true) && (!debitOnlySnapshot || options.allowDebitOnly === true);
  const validation = {
    ok: trustedFullSnapshot,
    method: "bank_api_snapshot",
    scope: debitOnlySnapshot ? "debit_only_expense_reconciliation" : "full_or_mixed_transaction_snapshot",
    sourceReport: path.basename(sourceFile),
    generatedAt: new Date().toISOString(),
    warning: debitOnlySnapshot && options.allowDebitOnly !== true
      ? "Debit-only bank snapshot detected. This is valid for receipt matching, not full CFO reporting. Import all sides or pass allowDebitOnly only for an expenses-only working pack."
      : (options.trustBankApi === true || options.trustBankApi === true)
      ? "Trusted because caller explicitly marked bank API snapshot as source-of-record for a working pack."
      : "Not trusted as statement validation. Run with trustBankApi only for working-pack generation, or provide official statement validation.",
    declaredCreditsTotal: credits,
    parsedCreditsTotal: credits,
    declaredDebitsTotal: debits,
    parsedDebitsTotal: debits,
    openingBalance: options.openingBalance == null ? null : normalizeAmount(options.openingBalance),
    closingBalance: options.closingBalance == null ? null : normalizeAmount(options.closingBalance),
    transactionCount: transactions.length,
    receiptUploadCount: invoiceMatches.length
  };

  writeJson(path.join(contextDir, "bank_transactions.json"), transactions);
  writeJson(path.join(contextDir, "invoice_matches.json"), invoiceMatches);
  writeJson(path.join(contextDir, "bank_statement_validation.json"), validation);

  return {
    ok: true,
    status: validation.ok ? "ready" : debitOnlySnapshot ? "imported_debit_only" : "imported_unverified",
    generatedAt: validation.generatedAt,
    sourceReport: sourceFile,
    contextDir: path.relative(root, contextDir),
    transactionCount: transactions.length,
    invoiceMatchCount: invoiceMatches.length,
    credits,
    debits,
    validation: {
      ok: validation.ok,
      method: validation.method,
      scope: validation.scope,
      warning: validation.warning
    },
    files: {
      transactions: path.relative(root, path.join(contextDir, "bank_transactions.json")),
      invoiceMatches: path.relative(root, path.join(contextDir, "invoice_matches.json")),
      bankValidation: path.relative(root, path.join(contextDir, "bank_statement_validation.json"))
    }
  };
}

function financeStatus(dataRoot, options = {}) {
  const root = path.resolve(dataRoot);
  const outputDir = resolveUnderRoot(root, options.outputDir || "finance");
  const reportFile = path.join(outputDir, "reports", "finance_report.json");
  const report = safeReadJson(reportFile, null);
  if (!report) {
    return { ok: false, status: "missing", error: "FINANCE_REPORT_MISSING", path: path.relative(root, reportFile) };
  }
  return {
    ok: report.ok === true,
    status: report.status,
    generatedAt: report.generatedAt,
    summary: report.summary || null,
    validation: report.validation || null,
    blockers: report.blockers || [],
    path: path.relative(root, reportFile)
  };
}

module.exports = {
  VERSION,
  CHART_OF_ACCOUNTS,
  CLASSIFICATION_RULES,
  buildCfoStack,
  importBankReconciliation,
  financeStatus,
  normalizeTransactions,
  classifyTransaction,
  extractValidation
};
