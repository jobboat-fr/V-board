# CFO Stack

## Purpose

The CFO stack is the deterministic finance/accounting layer for AZZ&CO LABS.

It must never invent balances, invoices, receipts, or fiscal conclusions. It converts verified source context into an accountant-ready working pack:

- JSON finance report
- Markdown owner/accountant summary
- Beancount-style ledger
- classification rules
- missing-document list
- blocked report when evidence is incomplete

## Source Contract

All inputs live under `AZZCO_DATA_ROOT/ops/context`:

| File | Required | Meaning |
|---|---:|---|
| `bank_transactions.json` | yes | Normalized Qonto/bank transactions. Amounts may be signed, or positive with `side: "debit"` / `side: "credit"`. |
| `bank_statement_validation.json` | yes | Statement reconciliation. Must have `ok: true` in strict mode. |
| `invoice_matches.json` | no | Known receipt/invoice links to bank transactions. |

The bank validation file is the hard evidence gate. If it is missing or failed, accounting output is blocked.

## Output Contract

Generated under `AZZCO_DATA_ROOT/finance`:

| Path | Meaning |
|---|---|
| `reports/finance_report.json` | machine-readable CFO pack |
| `reports/finance_summary.md` | human summary |
| `reports/manifest.json` | generated artifact index |
| `ledger/main.beancount` | main ledger include file |
| `ledger/accounts.beancount` | chart of accounts |
| `ledger/2026/*-transactions.beancount` | monthly transaction ledgers |
| `ledger/rules/classify-rules.yaml` | classification rules |

## Fail-Closed Rules

The stack returns `status: "blocked"` and does not create ledger files when:

- transactions are missing
- bank validation is missing
- bank validation has `ok: false`
- output/context paths attempt to escape `AZZCO_DATA_ROOT`

Blocked reports are still written to `finance/reports` so operators can see what evidence is missing.

## Surfaces

CLI:

```bash
node src/cli.js finance import-qonto path/to/qonto_receipt_reconcile.json --trust-qonto-api
node src/cli.js finance pull-qonto --since 2026-01-01T00:00:00Z --build
node src/cli.js finance build
node src/cli.js finance status
```

HTTP:

```http
POST /v1/finance/import-qonto
POST /v1/finance/pull-qonto
POST /v1/finance/build
GET /v1/finance/status
```

MCP:

- `azzco_finance_import_qonto`
- `azzco_finance_pull_qonto`
- `azzco_finance_build`
- `azzco_finance_status`

## Qonto Import

The Qonto importer consumes the existing `qonto_receipt_reconcile*.json` output from the receipt reconciliation script.

It writes:

- `ops/context/bank_transactions.json`
- `ops/context/invoice_matches.json`
- `ops/context/bank_statement_validation.json`

By default, imported Qonto API snapshots are marked `imported_unverified`, so the CFO build still blocks. To generate a working pack from an API snapshot, explicitly set `trustQontoApi: true` or pass `--trust-qonto-api`.

That flag means: "use this Qonto API export as source-of-record for today’s working pack." It does not mean an accountant has validated official bank statements.

Important: the receipt reconciler may generate debit-only reports because receipt matching only needs expenses. Debit-only imports are marked `imported_debit_only` and remain blocked for full CFO reporting, even with `--trust-qonto-api`, unless `--allow-debit-only` is explicitly passed for an expenses-only working pack.

For a full finance run, prefer `finance pull-qonto`: it pulls both `credit` and `debit` sides from Qonto and writes a `qonto_api_full_snapshot` validation record.

## Current Findings

- The previous standalone `azzco_finance_engine.js` had useful classification logic, but it was not integrated into the product API/MCP/CLI.
- It treated period net movement like bank balance when no opening/closing balance was available. The product code now separates those concepts.
- It did not fail closed on failed bank validation. The product code now blocks ledger generation when validation fails.
- It did not protect finance output paths. The product code now rejects traversal outside `AZZCO_DATA_ROOT`.
- It did not preserve duplicate source transaction IDs safely. The product code now assigns occurrence IDs such as `tx-id#2`.
- It did not expose status to operators. The product code now has CLI/API/MCP status.

## Non-Negotiables

- This stack prepares accountant-ready evidence. It does not file taxes, pay charges, submit declarations, sign contracts, or make legal/tax commitments.
- Any blocked report must be fixed at the evidence layer before using a model.
- Models may explain or review the report; they may not create source facts.
