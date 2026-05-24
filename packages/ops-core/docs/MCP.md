# MCP Gateway

Run:

```bash
npm run mcp
```

The server uses JSON-RPC over stdio and exposes these tools:

- `azzco_route`
- `azzco_bridge`
- `azzco_file_read`
- `azzco_file_write`
- `azzco_file_list`
- `azzco_work_order_create`
- `azzco_work_order_list`
- `azzco_finance_build`
- `azzco_finance_status`
- `azzco_finance_import_qonto`
- `azzco_finance_pull_qonto`

Finance tools are deterministic and evidence-bound. `azzco_finance_build` refuses to generate a ledger if bank transactions are absent or bank-statement validation is not `ok: true`.

`azzco_finance_import_qonto` converts an existing Qonto reconciliation JSON report into normalized finance context. It only reads reports under `AZZCO_DATA_ROOT`.

`azzco_finance_pull_qonto` pulls both credit and debit sides from Qonto into normalized context. It requires Qonto credentials in the service environment.

Example MCP server config:

```json
{
  "servers": {
    "azzco-ops-core": {
      "type": "stdio",
      "command": "node",
      "args": ["/opt/azzco-ops-core/src/cli.js", "mcp"],
      "env": {
        "AZZCO_DATA_ROOT": "/var/lib/azzco-ops-core",
        "AZZCO_COUNCIL_URL": "http://127.0.0.1:8787/route"
      }
    }
  }
}
```

The MCP server intentionally does not expose unrestricted shell execution.
