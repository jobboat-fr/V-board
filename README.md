<div align="center">

# ⚡ V-Board

### Deterministic · Cost-Governed · Evidence-First AI Operations

**The complete AI ops stack for autonomous business workflows — runs on a single server in four containers.**

[![CI](https://github.com/azzco-labs/v-board/actions/workflows/ci.yml/badge.svg)](https://github.com/azzco-labs/v-board/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-compose-blue)](docker-compose.yml)

*Built and battle-tested in production by [AZZ&CO LABS](https://azzco.fr)*

</div>

---

## What Is This?

V-Board is a containerised AI operations stack that turns routine business work into autonomous, owner-approved workflows delivered via WhatsApp:

- **Mail triage** — inbox → labels → owner-approved replies
- **Lead scouting** — public evidence → scored prospects → cold outreach
- **Invoice reconciliation** — Qonto API → bank matching → CFO-grade ledger
- **Legal/accounting scans** — document index → risk report → owner brief
- **CTO audits** — infra evidence → deployment/cost/security risk report
- **Incident watchdog** — P0/P1 detection → immediate owner escalation

> **The key insight:** most AI agent systems spend tokens first and ask questions later.
> V-Board runs a **zero-cost deterministic gate** before every model call.
> If evidence is missing — the job is **cancelled**, not hallucinated.
> Average cost: **~$0.008 per full delegation run**.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        azzco-net (Docker bridge)                    │
│                                                                     │
│  ┌──────────────────┐    route?    ┌──────────────────────────────┐ │
│  │   ops-core       │ ──────────▶  │         council              │ │
│  │   :8788          │  council_    │         :8787 (internal)     │ │
│  │                  │  required    │                              │ │
│  │  • HTTP API      │ ◀──────────  │  • 13 AI departments         │ │
│  │  • MCP server    │  analysis    │  • Multi-model LLM tiers     │ │
│  │  • Route gate    │              │  • Dedup cache               │ │
│  │  • CFO stack     │              │  • Safety gates              │ │
│  │  • Work orders   │              │  • council_may_send: false   │ │
│  └────────┬─────────┘              └──────────────────────────────┘ │
│           │                                                         │
│           │ evidence                                                │
│           ▼                                                         │
│  ┌──────────────────┐              ┌──────────────────────────────┐ │
│  │   runner         │              │   ollama (optional)          │ │
│  │   (no port)      │              │   :11434 (internal)          │ │
│  │                  │              │                              │ │
│  │  • Cron jobs     │              │  • Local LLM fallback        │ │
│  │  • 22 bin agents │              │  • Zero-cost inference       │ │
│  │  • Token governor│              │  • Enable: --profile ollama  │ │
│  │  • Report writer │              └──────────────────────────────┘ │
│  │  • WA delivery   │                                               │
│  └──────────────────┘                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
       │
       │ :8788 (localhost only)
       ▼
  [reverse proxy / owner tools / MCP clients]
```

### The Invariant

> **`council_may_send: false`** — council never sends email, WhatsApp, or writes CRM.
> It prepares analysis and returns a recommendation.
> **runner** is the sole communicator. Enforced in code, tested in CI, blocks every PR.

---

## Packages

| Package | Role | Port |
|---|---|---|
| [`packages/ops-core`](packages/ops-core/) | Routing gate · HTTP API · MCP server · CFO stack · Work orders · Observability | `8788` |
| [`packages/council`](packages/council/) | AI analysis engine · 13 departments · Multi-model · Dedup cache · Safety gates | `8787` (internal) |
| [`packages/runner`](packages/runner/) | Cron agent executor · 22 bin scripts · Token governor · WhatsApp delivery | — |

---

## Quick Start — Docker (recommended)

```bash
# 1. Clone
git clone https://github.com/azzco-labs/v-board.git
cd v-board

# 2. Configure
cp .env.example .env
# Edit .env — fill in at minimum:
#   AZZCO_COUNCIL_TOKEN  (32+ random bytes)
#   AZZCO_API_TOKEN      (32+ random bytes)
#   AZZCO_OWNER_WHATSAPP (your E.164 number)

# 3. Build and start
docker compose up -d --build

# 4. Verify
curl http://127.0.0.1:8788/health
# → {"ok":true,"service":"azzco-ops-core",...}

# 5. Optional: add local LLM (Mistral, Llama, etc.)
docker compose --profile ollama up -d
```

Generate strong tokens:
```bash
openssl rand -hex 32   # AZZCO_COUNCIL_TOKEN
openssl rand -hex 32   # AZZCO_API_TOKEN
```

---

## Quick Start — Bare Node (development)

```bash
# Terminal 1 — council
cd packages/council
cp .env.example .env   # set AZZCO_COUNCIL_TOKEN + HUGGINGFACE_TOKEN
npm start

# Terminal 2 — ops-core
cd packages/ops-core
cp .env.example .env   # set AZZCO_API_TOKEN + AZZCO_COUNCIL_TOKEN
npm test               # runs full test suite + doctor grid
npm start

# Health checks
curl http://127.0.0.1:8788/health
curl http://127.0.0.1:8787/health
```

---

## The Seven Algorithms

### 1 · Zero-Cost Routing Gate

A pure-JS classifier runs **before every model call**. No network, no LLM, no cost.

```
input → classify() → runner_local        (handle here, skip council)
                   → council_required    (send compact evidence to council)
                   → runner_review_first (ask owner for more evidence first)
```

**Routing factors:** category · urgency (P0–P3) · temperature (0–100) · mail label · commitment risk · restricted terms · owner flag.

### 2 · Preflight Blocking — "Refuse to Hallucinate"

Every job category checks for required evidence files before running:

| Category | Required evidence |
|---|---|
| `invoice_reconciliation` | `bank_statement_validation.json` with `ok: true` |
| `mail_triage` | `mail/triage/latest_inbox_snapshot.json` with `ok: true` |
| `lead_scout` | `lead_scout_fresh_candidates.json` ≥ 20 bytes |
| `crm_pipeline` | `crm/leads.md` ≥ 120 bytes |

If evidence is missing → job returns `BLOCKED` status, no model call made.

### 3 · [EMP] / [EST] Evidence Tagging

Every report fact is tagged at the source:

- `[EMP]` — Empirical. Read directly from a file. Example: `[EMP] Bank validation: OK`
- `[EST]` — Estimated. Inferred from patterns. Example: `[EST] Invoice likely relates to Q1 cloud costs`

The **output quality gate** (`azzco_output_quality_gate.js`) validates separation before WhatsApp delivery. Reports that blur facts and estimates are rejected.

### 4 · Automation Levels L1–L4

Work orders carry a graduated automation level:

| Level | Name | Behaviour |
|---|---|---|
| `L1_DRAFT_ONLY` | Draft only | Prepares output, does not send |
| `L2_AUTO_SEND_COLD` | Auto cold | Can send cold outreach autonomously if policy allows |
| `L3_OWNER_APPROVAL` | Owner gate | Prepares, notifies owner via WhatsApp, waits for approval |
| `L4_FORBIDDEN` | Hard block | Non-owner access to restricted data — refused immediately |

### 5 · council_may_send: false — Enforced in CI

The council safety invariant is triple-enforced:

1. **Code** — `routePolicy.js` always returns `council_may_send: false`
2. **Tests** — `testCouncilMaySendInvariant()` validates all 10 fixtures
3. **CI** — `security-scan` job greps for `council_may_send.*true` and blocks the merge

```javascript
// This is always false. Always. No exceptions.
policy: { council_may_send: false, council_prepares_only: true }
```

### 6 · CFO Stack — Fail-Closed Accounting

The CFO stack builds a Beancount ledger from bank data. It **refuses to generate accounting output** unless:
- `bank_statement_validation.json` has `ok: true`
- Declared totals match parsed totals (credits + debits)
- No total mismatch (even if `ok: true` was manually set)

Any discrepancy → `status: "blocked"` with a named blocker list.

### 7 · Dedup Cache — No Double-Billing

A SHA-256 fingerprint of each evidence packet is stored with a TTL (5–15 min). Identical requests within the TTL window return the cached result without making a model call. Prevents replay attacks and accidental budget burn.

---

## Container Reference

### ops-core

```
GET  /health                   → service health (public)
GET  /ready                    → auth + council configured?
POST /v1/route                 → deterministic route decision
POST /v1/bridge                → route + council call when required
POST /v1/departments/dispatch  → department-scoped routing
POST /v1/files/read|write      → safe workspace file access
GET  /v1/work-orders           → list work orders
POST /v1/work-orders           → create work order
GET  /v1/finance/status        → CFO stack status
POST /v1/finance/build         → build CFO artifacts
POST /v1/finance/import-qonto  → import Qonto reconciliation
POST /v1/finance/pull-qonto    → pull live Qonto snapshot
GET  /v1/observability/summary → event stats
GET  /dashboard                → live HTML dashboard
```

MCP tools (via stdio):
`azzco_route` · `azzco_bridge` · `azzco_file_read` · `azzco_file_write` · `azzco_file_list` · `azzco_work_order_create` · `azzco_work_order_list` · `azzco_health` · `azzco_policy` · `azzco_finance_build` · `azzco_finance_status` · `azzco_finance_import_qonto` · `azzco_finance_pull_qonto`

### council

```
POST /route   → AI analysis with routing policy applied
GET  /health  → service health
```

### runner — Bin Scripts

| Script | Purpose |
|---|---|
| `azzco_delegate_and_render.js` | Main orchestrator: preflight → delegate → render → deliver |
| `azzco_delegate_hard_work.js` | Builds evidence packet, calls council bridge, saves result |
| `azzco_route_or_bridge.js` | Routing gate: runner_local vs council_required |
| `azzco_route_policy.js` | Zero-cost deterministic classifier (standalone) |
| `azzco_council_call.sh` | HTTP call to council with auth |
| `azzco_morning_collect.sh` | Collects doc memory + ops status |
| `azzco_notify_owner.js` | WhatsApp/Telegram delivery |
| `azzco_output_quality_gate.js` | Validates [EMP]/[EST] tagging before delivery |
| `azzco_prod_doctor.js` | 9-fixture route test + infra health check |
| `azzco_cost_guardrail_deterministic.js` | Budget check + daily spend summary |
| `azzco_document_memory_refresh.js` | Rebuilds document index from workspace |
| `mail_triage_collect.js` | Gmail inbox snapshot → JSON |
| `token_governor.py` | Compact context builder for documents/accounting |
| `run_delegated_job.sh` | Container-native cron entry point |

---

## Environment Variables

| Variable | Service | Required | Description |
|---|---|---|---|
| `AZZCO_COUNCIL_TOKEN` | all | ✅ | Shared secret for ops-core ↔ council auth |
| `AZZCO_API_TOKEN` | ops-core | ✅ | HTTP API bearer token |
| `AZZCO_OWNER_WHATSAPP` | runner | ✅ | Owner number for report delivery |
| `HUGGINGFACE_TOKEN` | council | ⚡ | HuggingFace Inference API key |
| `TOGETHER_API_KEY` | council | ⚡ | Together AI key (alternative provider) |
| `QONTO_AUTH` | runner | — | Qonto `login:secret` |
| `AZZCO_DAILY_BUDGET_USD` | council | — | Daily AI spend cap (default: `3.00`) |
| `AZZCO_WORKSPACE` | runner | — | Workspace root (default: `/workspace`) |
| `AZZCO_DATA_ROOT` | ops-core | — | Data root (default: `/data`) |
| `SUPABASE_URL` | ops-core | — | Supabase observability sink URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ops-core | — | Supabase service role key |

See [`.env.example`](.env.example) for the complete reference.

---

## Workspace Layout

```
/workspace                        ← AZZCO_WORKSPACE (runner volume)
├── docs/                         ← legal, accounting, contracts
├── accounting/                   ← Beancount files, receipts
├── crm/
│   ├── leads.md                  ← CRM pipeline (source of truth)
│   └── pipeline.md               ← runner-written daily snapshot
├── mail/triage/
│   └── latest_inbox_snapshot.json ← mail_triage_collect output
├── finance/
│   ├── ledger/main.beancount     ← CFO stack output
│   └── reports/finance_report.json
├── ops/
│   ├── context/                  ← evidence JSON files (runner-written)
│   │   ├── document_index.json
│   │   ├── bank_transactions.json
│   │   ├── bank_statement_validation.json
│   │   └── council_last_*.json   ← council analysis results
│   ├── runner/
│   │   ├── last_run.json
│   │   └── CURRENT_STATUS.md
│   └── logs/
└── reports/
    ├── INDEX.md                  ← archive index
    └── YYYY-MM-DD/               ← daily report files
```

---

## Security

| Property | Status |
|---|---|
| council port `8787` | Internal only — not exposed to host |
| ops-core port `8788` | Binds to `127.0.0.1` by default |
| API endpoints | Scoped bearer tokens required |
| Path traversal | `safeFs.js` blocks `../` escapes → 403 |
| `council_may_send` | Always `false` — code + tests + CI |
| Dedup cache | Prevents replay budget drain |
| Secrets | Never committed — `.gitignore` enforced |

See [SECURITY.md](SECURITY.md) for the full vulnerability policy.

---

## CI/CD

Four-gate CI pipeline runs on every push and PR:

```
┌─────────────┐  ┌──────────────┐  ┌─────────────────┐
│  ops-core   │  │   council    │  │  security-scan  │
│             │  │              │  │                 │
│ • Route     │  │ • Smoke test │  │ • No phone #s   │
│   policy    │  │ • Hardening  │  │ • No server IPs │
│ • Invariant │  │   test       │  │ • No .env leaks │
│ • HTTP API  │  │ • check_all  │  │ • council_may_  │
│ • MCP       │  │              │  │   send gate     │
│ • CFO stack │  │              │  │                 │
└──────┬──────┘  └──────┬───────┘  └────────┬────────┘
       │                │                   │
       └────────────────┴───────────────────┘
                        │
                  ┌─────▼──────┐
                  │  all-pass  │  ← merge gate
                  └────────────┘
```

**Deploy workflow** (`deploy.yml`):
- Push to `main` → rsync ops-core to production server → restart service

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

```bash
# Run before opening a PR
cd packages/ops-core && npm test && npm run doctor
cd packages/council && npm run check
```

Key rules:
- `council_may_send` must always be `false` — never change this
- No hardcoded phone numbers in any file
- No private server IPs in code files
- All new routing cases need a fixture in the doctor grid

---

## Deployment Options

### Option A — Single server, Docker Compose (recommended)

```bash
docker compose up -d --build
# All four containers on one machine.
# council is internal-only. ops-core listens on localhost.
# Put Nginx/Caddy in front of ops-core if you need TLS.
```

### Option B — Two-server (original design)

```bash
# Server 1 (any VPS) — ops-core + runner
scp deploy/install-hostinger.sh root@SERVER1:~/
ssh root@SERVER1 bash install-hostinger.sh

# Server 2 (any VPS) — council
scp deploy/install-ovh.sh ubuntu@SERVER2:~/
ssh ubuntu@SERVER2 sudo bash install-ovh.sh
```

### Option C — Single server, bare Node

```bash
# council
sudo nano /etc/azzco-council.env
sudo systemctl start azzco-council

# ops-core
sudo nano /etc/azzco-ops-core.env
sudo systemctl start azzco-ops-core
```

Systemd units: [`packages/council/deploy/azzco-council.service`](packages/council/deploy/azzco-council.service)

---

## Production Numbers (May 2026)

| Metric | Value |
|---|---|
| Average cost per full delegation | ~$0.008 |
| Council calls (30-day sample) | 33 calls / $0.017 total |
| Routing gate latency | < 1ms |
| Preflight blocks | ~18% of runs (missing evidence) |
| P0 incident detections | 0 false positives in 30 days |
| Daily budget cap | $3.00 (enforced, never breached) |

---

## License

[MIT](LICENSE) — Copyright 2026 AZZ&CO LABS

Built in production by [AZZ&CO LABS](https://azzco.fr) · May 2026
