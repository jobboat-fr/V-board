# Operations

## Container Mode (Docker Compose)

The ops-core container runs the API/MCP gateway with:

```bash
AZZCO_DATA_ROOT=/workspace
AZZCO_API_HOST=0.0.0.0
AZZCO_API_PORT=8788
AZZCO_COUNCIL_URL=http://council:8787/route
AZZCO_API_KEYS_FILE=/workspace/.secrets/api_keys.json
```

Runner (ops-core + runner containers) is allowed to send and write CRM only after policy approval.

## Council Container

Council runs the same core for local work-order storage and MCP read/write, but remains prepare-only for business communications.

Council uses its own scoped key registry:

```bash
AZZCO_DATA_ROOT=/workspace
AZZCO_API_HOST=0.0.0.0
AZZCO_API_PORT=8787
AZZCO_COUNCIL_URL=http://127.0.0.1:8787/route
AZZCO_API_KEYS_FILE=/workspace/.secrets/api_keys.json
```

Generate one key per external integration. Never reuse the owner/root key for regular applications.

```bash
node src/cli.js keys issue --name crm-sales --scopes route:read,department:dispatch,work_orders:read,work_orders:write,files:read --file .secrets/api_keys.json
node src/cli.js keys issue --name finance-qonto-sync --scopes finance:read,finance:write,qonto:pull,qonto:import --file .secrets/api_keys.json
node src/cli.js keys issue --name devops-audit --scopes route:read,bridge:write,department:dispatch,work_orders:read,files:read --file .secrets/api_keys.json
```

## Incident Playbook

P0:

- production outage
- exposed secret
- active attack
- runaway spend
- broken runner/council bridge
- data corruption

For P0, notify owner immediately through available channels and create a work order.

P1:

- important this week
- missing legal/accounting proof
- blocked deployment
- degraded delivery channel

For P1, create work order, notify owner, and prepare next safe action.

## CFO Stack Operations

Before running finance:

1. Refresh source context under `ops/context`.
2. Confirm `bank_statement_validation.json` has `ok: true`.
3. Run `node src/cli.js finance build`.
4. Review `finance/reports/finance_report.json` and `finance/reports/finance_summary.md`.

If the finance command returns `status: "blocked"`, do not ask a model to fill the gap. Fix the missing or inconsistent source data first.
