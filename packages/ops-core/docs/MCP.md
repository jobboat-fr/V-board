# MCP Gateway

Run:

```bash
npm run mcp
```

The server uses JSON-RPC over stdio and exposes these tools:

- `vboard_route`
- `vboard_bridge`
- `vboard_file_read`
- `vboard_file_write`
- `vboard_file_list`
- `vboard_work_order_create`
- `vboard_work_order_list`
- `vboard_finance_build`
- `vboard_finance_status`
- `vboard_finance_import_bank`
- `vboard_finance_pull_bank`

Finance tools are deterministic and evidence-bound. `vboard_finance_build` refuses to generate a ledger if bank transactions are absent or bank-statement validation is not `ok: true`.

`vboard_finance_import_bank` converts an existing bank API reconciliation JSON report into normalized finance context. It only reads reports under `VBOARD_DATA_ROOT`.

`vboard_finance_pull_bank` pulls both credit and debit sides from bank API into normalized context. It requires bank API credentials in the service environment.

Example MCP server config:

```json
{
  "servers": {
    "vboard-ops-core": {
      "type": "stdio",
      "command": "node",
      "args": ["/opt/vboard-ops-core/src/cli.js", "mcp"],
      "env": {
        "VBOARD_DATA_ROOT": "/var/lib/vboard-ops-core",
        "VBOARD_COUNCIL_URL": "http://127.0.0.1:8787/route"
      }
    }
  }
}
```

The MCP server intentionally does not expose unrestricted shell execution.
