# Meeting Room Security

The meeting-room adapter is a production API surface: it receives transcript text, optional audio, optional provider keys, and writes legal/accounting evidence records. Treat it as an internal service behind TLS and an API gateway — not as a public unauthenticated port.

## Production Defaults

- `MEETING_ROOM_REQUIRE_TOKEN=true` is required for any hosted deployment.
- `MEETING_ROOM_API_TOKEN` must be a long random bearer token (`openssl rand -hex 32`) and must never be committed.
- The container binds `127.0.0.1:8790:8790` by default; expose it through nginx or Traefik with HTTPS.
- OpenAPI docs (`/docs`, `/redoc`, `/openapi.json`) are disabled automatically in production mode.
- Evidence is written under `AZZCO_DATA_ROOT`, with room IDs and media paths constrained to that root via `security.assert_under_root()`.

## Provider Keys (BYOK)

Users may bring their own Tavus or ElevenLabs keys for avatar and voice customization. Those keys are request-scoped inputs:

- Do not store user-supplied provider keys in evidence logs.
- Do not echo provider error bodies back to clients — errors are redacted via `security.redact_secret()`.
- Do not log generated meeting tokens.
- Keep provider HTTP clients bounded by timeouts and connection limits (`httpx.Limits`).

## Request Boundaries

All input validation is centralized in `adapters/meeting_room/security.py`:

| Limit | Default | Env override |
|---|---|---|
| Request body | 14 MB | `MEETING_ROOM_MAX_REQUEST_BYTES` |
| Audio decoded | 10 MB | `MEETING_ROOM_MAX_AUDIO_BYTES` |
| Transcript text | 20 000 chars | `MEETING_ROOM_MAX_TRANSCRIPT_CHARS` |
| Context / topic | 60 000 chars | `MEETING_ROOM_MAX_CONTEXT_CHARS` |
| TTS text | 2 000 chars | `MEETING_ROOM_MAX_TTS_CHARS` |
| Room ID | 160 chars | `MEETING_ROOM_MAX_ROOM_ID_CHARS` |

Tune these with environment variables only after load testing. Base64 audio is decoded with `validate=True` — non-canonical inputs are rejected before allocation.

## Container Runtime

The meeting-room container runs with a hardened Docker Compose profile:

```yaml
read_only: true
tmpfs:
  - /tmp:size=64m,mode=1777
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
ports:
  - "127.0.0.1:8790:8790"
```

The container image runs as non-root user `hermes` (UID 1000).

## Host Firewall

Docker published ports bypass simple host-firewall assumptions. For deployments that still publish a service port publicly, install the `DOCKER-USER` guard:

```bash
# Block public TCP access to any Docker-published port
sudo AZZCO_BLOCK_PUBLIC_PORT=63118 \
  bash packages/meeting-room/scripts/security/harden-docker-published-port.sh

# Persist across reboots (systemd oneshot after docker.service):
#   Install as /etc/systemd/system/azzco-firewall-hardening.service
#   systemctl daemon-reload && systemctl enable --now azzco-firewall-hardening
```

Or move the service entirely behind a private network and remove the public published port.

## Verified on Hostinger (live)

- `azzco-firewall-hardening.service` installed and enabled as a systemd oneshot.
- `DOCKER-USER` rule confirmed active: `iptables -S DOCKER-USER` shows DROP rule on `eth0`.
- OVH-side verification: port 63118 blocked; ports 80 and 443 still reachable.
- Hostinger internal: `curl 127.0.0.1:63118` still returns `HTTP/1.1 200 OK`.

## Security Response Headers

Every response from the meeting-room server includes:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Cache-Control: no-store
```

## CI/CD Gates

The `meeting-room.yml` workflow runs on PRs and pushes that touch `packages/meeting-room/`:

1. Python syntax check (`py_compile`) across all adapter and script files
2. Static security guardrails (`scripts/check_meeting_room_security.py`) — 14 checks
3. Shell script syntax check (`bash -n`) on the firewall hardening script
4. Meeting-room pytest suite (128 tests, no real API keys required)
5. Docker image build (`packages/meeting-room/Dockerfile`)
6. Container smoke test — health probe, auth rejection (401), authenticated status (200)
7. GHCR publish on `main` push and version tags

Do not merge changes that weaken token enforcement, public binding, path containment, BYOK redaction, or container runtime restrictions without a new security note and tests.

## Operational Checklist

- Rotate `MEETING_ROOM_API_TOKEN` after any deployment-team change.
- Keep `AZZCO_DATA_ROOT` on an encrypted or access-controlled volume.
- Keep JSON logs retained and rotated; never ship raw provider keys in log output.
- Expose `/health` through the proxy only if needed for load balancer health checks; keep `/ready` protected.
- Run host-level checks after Docker or Traefik changes: listening ports, DOCKER-USER rules, container health, and proxy TLS.
- After any iptables change, verify the rule survives a container restart: `docker compose restart meeting-room && iptables -S DOCKER-USER`.
