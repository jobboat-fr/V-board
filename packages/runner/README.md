# AZZCO Runner

Deterministic job runner for Hostinger → OVH autonomous agent execution.

## Overview

The runner is the execution layer that sits on Hostinger. It:
1. Collects compact evidence from the workspace
2. Calls `azzco_delegate_and_render.js <category> <urgency>` inside the OpenClaw container
3. Delegates hard analysis to OVH via the council bridge
4. Delivers the rendered report via WhatsApp
5. Logs run status to the reports archive

## Required Environment Variables

```bash
AZZCO_OWNER_WHATSAPP=+XXXXXXXXXXX     # Owner WhatsApp number for delivery
AZZCO_COUNCIL_URL=http://YOUR_OVH:8787/route
AZZCO_COUNCIL_TOKEN=<strong-random-token>
OPENCLAW_CONTAINER=openclaw-uix8-openclaw-1
```

## Bin Scripts

| Script | Purpose |
|---|---|
| `azzco_delegate_and_render.js` | Main orchestrator: collect → delegate → render → write |
| `azzco_delegate_hard_work.js` | Builds evidence packet, calls bridge, saves result |
| `azzco_route_or_bridge.js` | Routing gate: local vs OVH required |
| `azzco_route_policy.js` | Zero-cost deterministic classifier |
| `azzco_council_call.sh` | HTTP call to OVH council with auth |
| `azzco_morning_collect.sh` | Collects document memory + ops status |
| `azzco_notify_owner.js` | WhatsApp/Telegram delivery |
| `azzco_output_quality_gate.js` | Validates [EMP]/[EST] tagging before delivery |
| `azzco_prod_doctor.js` | 9-fixture route test + infra health check |
| `azzco_cost_guardrail_deterministic.js` | Budget check + daily spend summary |
| `azzco_document_memory_refresh.js` | Rebuilds document index from workspace |
| `mail_triage_collect.js` | Gmail inbox snapshot → JSON |
| `token_governor.py` | Compact context builder for documents/accounting |
| `run_delegated_job.sh` | Host-level cron entry point |

## Host Cron (currently active on Hostinger)

```cron
10 7,17 * * *   docker exec <container> python3 /data/.openclaw/workspace/tools/token_governor.py
30 19  * * *   docker exec <container> node /data/.openclaw/workspace/bin/azzco_cost_guardrail_deterministic.js --send
```

Agent jobs are fired via OpenClaw's internal cron (not host cron).
