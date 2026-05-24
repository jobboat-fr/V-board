# Security Policy

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: (configure your security contact in SECURITY.md)

We will respond within 48 hours and aim to patch within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---|---|
| main branch | ✅ |
| older tags | ❌ |

## Known Security Properties

### What Is Hardened

- **Council port `8787`** — not exposed to the host in Docker Compose. Internal `vboard-net` only. Publicly unreachable.
- **Ops-core port `8788`** — binds to `127.0.0.1` by default. Not reachable from the internet without explicit config.
- **All API endpoints** require scoped bearer tokens (see `packages/ops-core/src/server/auth.js`).
- **Path traversal** — `safeFs.js` uses `path.resolve` + boundary check, returns 403 on escape attempt. Tested in CI.
- **`council_may_send: false`** — enforced in code and verified in every CI run. council never sends externally.
- **Dedup cache** — prevents replay attacks from burning budget via repeated calls.
- **No secrets in repo** — CI secret-scan job blocks merges if patterns are detected.

### What Requires Operator Attention

- Rotate `VBOARD_COUNCIL_TOKEN` and `VBOARD_API_TOKEN` periodically. Use at least 32 random bytes.
- API key hashes (`api_keys.json`) should live in `.secrets/` with `chmod 600`. Never commit.
- SSH keys for CI deploy should use dedicated keys with no passphrase, scoped to the deploy user only.
- Event-sink credentials are server-side only; never expose `VBOARD_EVENT_SINK_TOKEN` in browser/frontend code.

## Meeting Room (port 8790)

The meeting-room adapter is a production API surface that receives transcript text, audio, and optional provider keys, and writes legal/accounting evidence records.

- **Port `8790`** — bound to `127.0.0.1` by default. Not reachable from the internet without a reverse proxy.
- **`MEETING_ROOM_REQUIRE_TOKEN=true`** enforced in the container image default. Protected endpoints return `503` if no token is configured in production mode.
- **`hmac.compare_digest`** used for constant-time token comparison.
- **OpenAPI docs disabled** automatically in production mode.
- **Strict base64 decoding** (`validate=True`) for all audio inputs.
- **Request body cap** (`MAX_REQUEST_BYTES`) enforced at FastAPI middleware before any parsing.
- **Path containment** — all evidence writes go through `security.assert_under_root()` and are bounded to `VBOARD_DATA_ROOT`.
- **BYOK provider keys** — user-supplied avatar provider/voice provider keys are request-scoped; never persisted in evidence logs or echoed in error responses.
- **avatar provider HTTPS-only** — base URL validation rejects non-HTTPS remote endpoints.
- **Container runtime** — `read_only: true`, `no-new-privileges:true`, `cap_drop: ALL`, tmpfs `/tmp`.
- **Docker DOCKER-USER firewall rule** — `scripts/security/harden-docker-published-port.sh` blocks public TCP access to published ports at the `iptables` `DOCKER-USER` chain. Persisted via `vboard-firewall-hardening.service` systemd oneshot.

See `docs/meeting-room-security.md` for the full operational guide.

## CI Security Gates

Every PR must pass:

1. No hardcoded phone numbers in code
2. No private server IPs in code  
3. No committed secrets in `.env` files
4. `council_may_send` invariant holds in all source files
5. Full ops-core test suite (including path traversal fixture)
6. Council hardening test
7. Meeting-room security guardrails (`scripts/check_meeting_room_security.py`)
8. Meeting-room Docker smoke test (auth rejection + health probe)
