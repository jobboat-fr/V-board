# VBOARD Runner

Deterministic job runner — container-native cron agent executor.

## Overview

The runner is the execution layer. It:
1. Collects compact evidence from the workspace
2. Calls `vboard_delegate_and_render.js <category> <urgency>`
3. Delegates hard analysis to council via the council bridge (`http://council:8787/route`)
4. Delivers the rendered report via WhatsApp
5. Logs run status to the reports archive

The runner has **no exposed port**. It communicates outbound to council on the `vboard-net` Docker bridge network.

## Required Environment Variables

```bash
VBOARD_WORKSPACE=/workspace                       # Container workspace root
VBOARD_OWNER_WHATSAPP=+XXXXXXXXXXX               # Owner WhatsApp number
VBOARD_COUNCIL_URL=http://council:8787/route      # Council endpoint (Docker DNS)
VBOARD_COUNCIL_TOKEN=<strong-random-token>        # Shared auth token
```

## Bin Scripts

| Script | Purpose |
|---|---|
| `vboard_delegate_and_render.js` | Main orchestrator: preflight → delegate → render → write |
| `vboard_delegate_hard_work.js` | Builds evidence packet, calls bridge, saves result |
| `vboard_route_or_bridge.js` | Routing gate: runner_local vs council_required |
| `vboard_route_policy.js` | Zero-cost deterministic classifier (standalone) |
| `vboard_council_call.sh` | HTTP call to council with auth |
| `vboard_morning_collect.sh` | Collects document memory + ops status |
| `vboard_notify_owner.js` | WhatsApp/Telegram delivery |
| `vboard_output_quality_gate.js` | Validates [EMP]/[EST] tagging before delivery |
| `vboard_prod_doctor.js` | 9-fixture route test + infra health check |
| `vboard_cost_guardrail_deterministic.js` | Budget check + daily spend summary |
| `vboard_document_memory_refresh.js` | Rebuilds document index from workspace |
| `mail_triage_collect.js` | Gmail inbox snapshot → JSON |
| `token_governor.py` | Compact context builder for documents/accounting |
| `run_delegated_job.sh` | Container-native cron entry point (no docker exec) |

## Container Cron (supercronic)

The runner container uses [supercronic](https://github.com/aptible/supercronic) — a cron-in-container replacement that respects signals and logs to stdout.

Mount your crontab at `/etc/vboard-crontab`:

```yaml
# docker-compose.yml override
services:
  runner:
    volumes:
      - ./my-crontab:/etc/vboard-crontab:ro
```

Or use the example:

```bash
cp packages/runner/crontab.example /etc/vboard-crontab
```

See [`crontab.example`](crontab.example) for the recommended schedule.

## Entry Point

```bash
run_delegated_job.sh <category> <urgency>
# Example:
run_delegated_job.sh morning_brief P2
run_delegated_job.sh invoice_reconciliation P1
```

The script:
1. Runs `vboard_delegate_and_render.js`
2. Archives the report to `$WORKSPACE/reports/YYYY-MM-DD/`
3. Delivers via `vboard_send_whatsapp_stdin.js`
4. Writes `last_run.json` and updates `reports/INDEX.md`
