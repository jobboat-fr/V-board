# AZZCO Ops Core

Production control plane for AZZ&CO LABS' container-native operations model.

**Runner** handles communication, sending, CRM writes, low-temperature work, and data transfer.
**Council** handles high-temperature analysis, legal/accounting review, CTO incidents, and quality hardening.

This repo provides: deterministic routing gate, HTTP API, MCP tools, work-order store, DevOps checks, and the AZZCO CFO stack.

The CFO stack turns normalized Qonto/bank context into accountant-ready reports and Beancount-style ledgers, but only after bank-statement validation passes.

## Key Rule

Council prepares only. It **never** sends email, WhatsApp, Telegram, or writes CRM.
This is enforced by code — `policy.council_may_send` is always `false`.

## Quick Start

```bash
cp .env.example .env
# Edit .env — set AZZCO_API_TOKEN to a strong random value
npm test
npm start
```

Health check:

```bash
curl http://127.0.0.1:8788/health
```

Route a task:

```bash
curl -s http://127.0.0.1:8788/v1/route \
  -H "content-type: application/json" \
  -H "authorization: Bearer $AZZCO_API_TOKEN" \
  -d '{"category":"sales_reply","urgency":"P2","temperature":85,"mail_label":"hot_mail","prompt":"Hot lead asks for pricing and signature"}'
```

## Scoped API Keys

Use scoped keys for applications. Keep `AZZCO_API_TOKEN` only as an owner/root break-glass token.

Create the key registry:

```bash
mkdir -p .secrets
chmod 700 .secrets
export AZZCO_API_KEYS_FILE="$PWD/.secrets/api_keys.json"
```

Generate one key per application or department:

```bash
node src/cli.js keys issue \
  --name front-desk \
  --scopes route:read,department:dispatch,work_orders:read,work_orders:write \
  --file .secrets/api_keys.json

node src/cli.js keys issue \
  --name crm-sales \
  --scopes route:read,department:dispatch,work_orders:read,work_orders:write,files:read \
  --file .secrets/api_keys.json

node src/cli.js keys issue \
  --name finance-read \
  --scopes finance:read,files:read \
  --file .secrets/api_keys.json

node src/cli.js keys issue \
  --name finance-qonto-sync \
  --scopes finance:read,finance:write,qonto:pull,qonto:import \
  --file .secrets/api_keys.json

node src/cli.js keys issue \
  --name devops-audit \
  --scopes route:read,bridge:write,department:dispatch,work_orders:read,files:read,observability:read,observability:write \
  --file .secrets/api_keys.json

node src/cli.js keys issue \
  --name owner-admin \
  --scopes '*' \
  --file .secrets/api_keys.json
```

Each command prints the plaintext token once. Store it in the calling app's server-side environment, never in browser code.

Call a department:

```bash
curl -sS http://127.0.0.1:8788/v1/departments/dispatch \
  -H "authorization: Bearer $AZZCO_CRM_API_KEY" \
  -H "content-type: application/json" \
  -d '{"department":"crm","payload":{"prompt":"Add a CRM follow-up note","urgency":"P3"}}'
```

Recommended production exposure:

- Bind the API to `127.0.0.1` by default.
- Expose it only through SSH tunnel, Tailscale, VPN, or a TLS reverse proxy with IP allowlist.
- Give every external app its own scoped key so a leaked CRM key cannot read finance data.

## Live Dashboard And Logs

Open:

```bash
http://127.0.0.1:8788/dashboard
```

The dashboard checks:

- `/health`
- `/ready`
- `/v1/observability/summary`
- `/v1/observability/events`
- `/v1/observability/supabase`

Logging outputs:

- local JSONL: `AZZCO_LOG_DIR/api-events.jsonl`
- Winston app log: `AZZCO_LOG_DIR/api.log`
- Winston error log: `AZZCO_LOG_DIR/api-error.log`
- optional Supabase table: `AZZCO_SUPABASE_EVENTS_TABLE`

Supabase is server-side only. Do not put the `service_role` key in browser code.

Create the Supabase table with:

```bash
deploy/supabase_observability.sql
```

## MCP Config

Add to your Claude Code / MCP client config:

```json
{
  "servers": {
    "azzco-ops-core": {
      "type": "stdio",
      "command": "node",
      "args": ["/opt/azzco-ops-core/src/cli.js", "mcp"],
      "env": {
        "AZZCO_DATA_ROOT": "/var/lib/azzco-ops-core",
        "AZZCO_COUNCIL_URL": "http://127.0.0.1:8787/route",
        "AZZCO_COUNCIL_TOKEN": "your-council-token"
      }
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|---|---|
| `azzco_route` | Deterministic routing decision (no council call) |
| `azzco_bridge` | Route + call council when required |
| `azzco_file_read` | Read file within `AZZCO_DATA_ROOT` |
| `azzco_file_write` | Write file within `AZZCO_DATA_ROOT` |
| `azzco_file_list` | List files within `AZZCO_DATA_ROOT` |
| `azzco_work_order_create` | Create a durable work order (JSONL, with `project` namespace) |
| `azzco_work_order_list` | List work orders, filter by `project` and/or `status` |
| `azzco_health` | Service health + config status — use to verify connectivity from other projects |
| `azzco_finance_build` | Build the CFO report and ledger from validated bank context |
| `azzco_finance_status` | Read the latest CFO report status |
| `azzco_policy` | Returns routing constants and the `council_may_send: false` invariant |

## DevOps Cycle

```bash
npm test          # full test suite (routing, invariants, HTTP, MCP, work orders)
npm run doctor    # 9-fixture route grid + invariant checks + infra guards
docker build -t azzco/ops-core:local .
```

Release gates — do **not** deploy if:
- any test or doctor case fails
- `apiAuthConfigured: false` in production
- `council_may_send` is ever true (tests enforce this)
- path traversal guard is not returning 403

## CFO Stack

Input contract under `AZZCO_DATA_ROOT`:

- `ops/context/bank_transactions.json`: normalized Qonto/bank transactions.
- `ops/context/bank_statement_validation.json`: reconciliation result. Must be `ok: true` in strict mode.
- `ops/context/invoice_matches.json`: optional receipt/invoice links to transactions.

Run:

```bash
node src/cli.js finance build
node src/cli.js finance status
```

Qonto reconciliation import:

```bash
node src/cli.js finance import-qonto reports/qonto_receipt_reconcile.json --trust-qonto-api
node src/cli.js finance pull-qonto --since 2026-01-01T00:00:00Z --build
```

Generated artifacts:

- `finance/reports/finance_report.json`
- `finance/reports/finance_summary.md`
- `finance/reports/manifest.json`
- `finance/ledger/main.beancount`
- `finance/ledger/accounts.beancount`
- `finance/ledger/2026/*-transactions.beancount`
- `finance/ledger/rules/classify-rules.yaml`

Fail-closed rule: if transactions are missing, or bank validation is missing/failed, the CFO stack writes a blocked report and does not generate a ledger.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/API.md`](docs/API.md)
- [`docs/MCP.md`](docs/MCP.md)
- [`docs/DEVOPS_CYCLE.md`](docs/DEVOPS_CYCLE.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
