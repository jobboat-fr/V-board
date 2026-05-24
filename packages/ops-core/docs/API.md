# HTTP API

Default port: `8788`.

Protected routes require:

```http
authorization: Bearer $AZZCO_API_TOKEN
```

For production app-to-server access, prefer scoped API keys instead of the single legacy root token.

```bash
node src/cli.js keys issue \
  --name crm-app \
  --scopes route:read,department:dispatch,work_orders:read,work_orders:write \
  --file /data/.openclaw/workspace/azzco-ops-core/.secrets/api_keys.json
```

The command prints the plaintext token once and stores only its SHA-256 hash in the key registry.

Set:

```bash
AZZCO_API_KEYS_FILE=/data/.openclaw/workspace/azzco-ops-core/.secrets/api_keys.json
```

Useful scopes:

- `route:read`
- `bridge:write`
- `department:dispatch`
- `files:read`
- `files:write`
- `work_orders:read`
- `work_orders:write`
- `finance:read`
- `finance:write`
- `qonto:pull`
- `qonto:import`
- `observability:read`
- `observability:write`
- `*` for owner/root only

Public routes:

- `GET /health`
- `GET /ready`

## Route

`POST /v1/route`

Returns deterministic routing:

- `hostinger_local`
- `hostinger_review_first`
- `ovh_required`

## Bridge

`POST /v1/bridge`

Runs the route policy first. If the task does not require OVH, no council call is made. If it does require OVH, the API calls `AZZCO_COUNCIL_URL`.

## Departments

`POST /v1/departments/dispatch`

Required scope: `department:dispatch`.

Example:

```bash
curl -sS http://127.0.0.1:8788/v1/departments/dispatch \
  -H "authorization: Bearer $AZZCO_CRM_API_KEY" \
  -H "content-type: application/json" \
  -d '{"department":"crm","payload":{"prompt":"Add CRM note","urgency":"P3"}}'
```

The gateway returns the routing decision and either handles locally or bridges to OVH if the policy requires heavy work.

## Observability

Dashboard:

- `GET /dashboard`
- `GET /`

Protected live endpoints:

- `GET /v1/observability/summary` (`observability:read`)
- `GET /v1/observability/events?limit=100` (`observability:read`)
- `GET /v1/observability/supabase` (`observability:read`)
- `POST /v1/observability/test` (`observability:write`)

Every API request writes:

- local JSONL: `AZZCO_LOG_DIR/api-events.jsonl`
- Winston logs: `AZZCO_LOG_DIR/api.log` and `AZZCO_LOG_DIR/api-error.log`
- optional Supabase table: `AZZCO_SUPABASE_EVENTS_TABLE`

The Supabase `service_role` key must stay server-side. The dashboard never receives it.

## Files

All file operations are scoped to `AZZCO_DATA_ROOT`.

- `POST /v1/files/read`
- `POST /v1/files/write`
- `GET /v1/files/list?path=.`

Requests outside `AZZCO_DATA_ROOT` are rejected.

## Work Orders

- `POST /v1/work-orders`
- `GET /v1/work-orders?limit=100`

Work orders are stored as JSONL under the data root.

## Finance / CFO Stack

- `POST /v1/finance/build`
- `GET /v1/finance/status`
- `POST /v1/finance/import-qonto`
- `POST /v1/finance/pull-qonto`

`POST /v1/finance/build` reads:

- `ops/context/bank_transactions.json`
- `ops/context/bank_statement_validation.json`
- `ops/context/invoice_matches.json`

It writes accountant-ready artifacts under `finance/reports` and `finance/ledger`.

Strict default: if bank transactions are absent, or bank validation is missing/failed, the response is `status: "blocked"` and no ledger is generated.

`POST /v1/finance/import-qonto` imports a `qonto_receipt_reconcile*.json` report into `ops/context`. The `reportPath` must be relative to `AZZCO_DATA_ROOT`. By default the import is `imported_unverified`; set `trustQontoApi: true` only when you explicitly accept the Qonto API snapshot as source-of-record for a working pack.

Debit-only Qonto reports are treated as expense-reconciliation snapshots, not full finance inputs. They stay blocked unless `allowDebitOnly: true` is explicitly set for an expenses-only pack.

`POST /v1/finance/pull-qonto` pulls a full credit+debit Qonto API snapshot directly into `ops/context`. It requires `QONTO_AUTH` or `QONTO_LOGIN`/`QONTO_SECRET` in the service environment.
