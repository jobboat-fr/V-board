# V-Board — AZZCO AI Operations Infrastructure

**Deterministic, cost-governed, evidence-first AI automation for enterprise operations.**

Built and battle-tested in production by [AZZ&CO LABS](https://azzco.fr).

---

## What Is This?

V-Board is a two-server AI operations stack that turns routine business work — mail triage, lead scouting, invoice reconciliation, legal risk scanning, CTO audits — into autonomous, owner-approved workflows delivered via WhatsApp.

The key insight: **most AI agent systems spend money first and ask questions later.** V-Board is built on the opposite principle. A zero-cost deterministic gate runs before any model call. If evidence is missing, the job is cancelled — not run with caveats. If the task is low-risk and local, OVH is never called. The result: full autonomous operation at ~$0.008/run.

---

## Architecture

```
HOSTINGER (your sending server)           OVH (your analysis server)
────────────────────────────────          ─────────────────────────────
packages/ops-core  :8788 (local)          packages/council   :8787 (local)
packages/runner/bin/  (22 agents)         packages/ops-core  :8788 (local)
hostinger/modules/  (9 protocols)
hostinger/protocols/ (5 deep scans)

KEY RULE: OVH prepares only.
Hostinger sends email, WhatsApp, writes CRM.
OVH analyses, never sends. Enforced in code.
```

---

## Packages

| Package | Description |
|---|---|
| [`packages/ops-core`](packages/ops-core/README.md) | HTTP API + MCP gateway: deterministic routing, work orders, CFO stack, observability |
| [`packages/council`](packages/council/) | Multi-department AI council: 13 departments, multi-model tiers, safety gates, dedup cache |
| [`packages/runner`](packages/runner/) | Deterministic job runner: 22 agent scripts, token governor, host cron integration |
| [`hostinger/modules`](hostinger/modules/) | AI behavioral modules: CRM memory, deal desk, approval queue, incident mode, etc. |
| [`hostinger/protocols`](hostinger/protocols/) | Deep scan protocols: legal, accounting, risk synthesis, model routing policy |
| [`ovh/`](ovh/) | OVH-specific: Hermes AGENTS.md configuration, utility scripts |

---

## Quick Start

### ops-core (routing API + MCP)

```bash
cd packages/ops-core
cp .env.example .env
# Edit .env — set AZZCO_API_TOKEN
npm test
npm start
# Health: curl http://127.0.0.1:8788/health
```

### council (AI council server)

```bash
cd packages/council
cp .env.example .env
# Edit .env — set AZZCO_COUNCIL_TOKEN + HUGGINGFACE_TOKEN
npm start
# Health: curl http://127.0.0.1:8787/health
```

---

## What Makes It Different

### 1. Zero-cost Routing Gate
Before any model call, a pure-JS classifier decides: `hostinger_local` | `ovh_required` | `hostinger_review_first`. Costs $0.000000.

### 2. Preflight Blocking — "Refuse to Hallucinate"
Each job category requires specific evidence files. If bank validation is missing, finance jobs are cancelled. If inbox snapshot is absent, mail triage is cancelled. The system never invents an answer.

### 3. [EMP] / [EST] Evidence Tagging
Every report fact is tagged: `[EMP]` = observed from a real file. `[EST]` = inferred. The output quality gate validates this separation before delivery.

### 4. Automation Levels L1–L4
Work orders carry an automation level. `L4_FORBIDDEN` blocks non-owner access to restricted data completely. `L3_OWNER_APPROVAL` prepares work and waits for WhatsApp approval. Nothing executes without matching the correct level.

### 5. `ovh_may_send: false` — Enforced in CI
The invariant that OVH never sends is tested in every CI run. Deployment is blocked if it's ever violated.

### 6. Cost: ~$0.008/run
May 2026 production data: $0.017 for 33 council calls. Daily budget gate ($3/day) is enforced by code, not by promise.

---

## Security

- Council binds to `127.0.0.1` by default — never expose port 8787 publicly
- Ops-core binds to `127.0.0.1:8788` by default
- All API access is scoped-key controlled (no wildcard keys in production)
- Secrets are never committed — see `.env.example` in each package
- Path traversal guard returns 403 — tested in CI

See [packages/ops-core/docs/SECURITY.md](packages/ops-core/docs/SECURITY.md) for the full security model.

---

## Deployment

See [`packages/ops-core/deploy/`](packages/ops-core/deploy/) for:
- `systemd/azzco-ops-core.service` — systemd unit
- `supabase_observability.sql` — Supabase events table
- `azzco-ops-core.env.example` — production env template

---

## License

MIT — see [LICENSE](LICENSE).

Built by [AZZ&CO LABS](https://azzco.fr) · Production-validated May 2026.
