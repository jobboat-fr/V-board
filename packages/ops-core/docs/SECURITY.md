# Security

## Secrets

Never commit:

- API tokens
- Railway/Vercel/bank API keys
- mail credentials
- WhatsApp session files
- agent runtime auth files
- legal/accounting documents

Use `.env` locally and server-side environment files in production.

## File Access

Read/write APIs are restricted to `VBOARD_DATA_ROOT`.

The gateway rejects path traversal such as:

```text
../secret
```

## Confidentiality

Restricted topics:

- legal
- accounting
- fiscal/social
- bank/bank API
- invoices/receipts
- contracts/statutes
- secrets/infrastructure internals
- client/prospect private data

Restricted data must be owner-only and compacted before any model/council call.

## Network

Bind API to `127.0.0.1` by default. Put it behind a trusted proxy/VPN before exposing it.

## Execution

This repo intentionally avoids a general shell execution MCP tool. Add narrow, audited tools only.
