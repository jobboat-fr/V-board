# Security Policy

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: security@azzco.fr

We will respond within 48 hours and aim to patch within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---|---|
| main branch | ✅ |
| older tags | ❌ |

## Known Security Properties

### What Is Hardened

- **Council port `8787`** — not exposed to the host in Docker Compose. Internal `azzco-net` only. Publicly unreachable.
- **Ops-core port `8788`** — binds to `127.0.0.1` by default. Not reachable from the internet without explicit config.
- **All API endpoints** require scoped bearer tokens (see `packages/ops-core/src/server/auth.js`).
- **Path traversal** — `safeFs.js` uses `path.resolve` + boundary check, returns 403 on escape attempt. Tested in CI.
- **`council_may_send: false`** — enforced in code and verified in every CI run. council never sends externally.
- **Dedup cache** — prevents replay attacks from burning budget via repeated calls.
- **No secrets in repo** — CI secret-scan job blocks merges if patterns are detected.

### What Requires Operator Attention

- Rotate `AZZCO_COUNCIL_TOKEN` and `AZZCO_API_TOKEN` periodically. Use at least 32 random bytes.
- API key hashes (`api_keys.json`) should live in `.secrets/` with `chmod 600`. Never commit.
- SSH keys for CI deploy should use dedicated keys with no passphrase, scoped to the deploy user only.
- Supabase `service_role` key is server-side only — never expose in browser/frontend code.

## CI Security Gates

Every PR must pass:

1. No hardcoded phone numbers in code
2. No private server IPs in code  
3. No committed secrets in `.env` files
4. `council_may_send` invariant holds in all source files
5. Full ops-core test suite (including path traversal fixture)
6. Council hardening test
