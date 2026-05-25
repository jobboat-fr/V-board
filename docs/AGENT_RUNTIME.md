# V-Board on Hermes Agent

V-Board is not a standalone project that calls an external runtime. It is an ops layer built **on top of Hermes Agent**, deployed as a fork that wires V-Board's routing pipeline, council, runner jobs, and meeting-room advisor directly into Hermes's skill and adapter system.

The production setup is a single Hermes fork running on each server — not two separate services.

---

## Why Hermes

[Hermes Agent](https://github.com/NousResearch/hermes-agent) (by NousResearch) already ships exactly what V-Board's ops layer needs:

| What Hermes provides | What V-Board adds on top |
|---|---|
| Multi-provider LLM routing (OpenRouter, Nous Portal, OpenAI, Ollama, HuggingFace) | 8-step deterministic routing pipeline |
| Channel gateway: Telegram, WhatsApp, Discord, Slack, Signal | 10 safety gates enforced before and after model calls |
| Cron scheduler with job registry | Runner cron scripts (mail triage, finance, records refresh, cost guardrail) |
| Skill system (`skills/<name>/SKILL.md`) | AIWorkerCollective 5-stage council (`skills/vboard-council/`) |
| Adapter system (`adapters/<name>/`) | Deal room, lead scoring, D_fast formula (`skills/vboard-ops/`) |
| Session memory and cross-restart state | Meeting room intervention judge (`adapters/meeting_room/`) |
| Token budget enforcement | Shared workspace at `/workspace` |

V-Board does not re-implement any of the above. It slots its capabilities into the slots Hermes already exposes.

---

## Fork Structure

V-Board lives as a fork of `github.com/NousResearch/hermes-agent`. Inside the fork:

```
hermes-agent/                 ← forked from NousResearch/hermes-agent
  skills/
    meeting-room/             ← upstream Hermes skill (meeting-room entrypoint)
    vboard-ops/               ← V-Board routing pipeline, cost guard, safety gates
    vboard-council/           ← AIWorkerCollective + CouncilRuntime
  adapters/
    meeting_room/             ← V-Board meeting-room FastAPI adapter (already present upstream)
  workspace/
    bin/
      vboard_daily_records_refresh.js
      vboard_mail_triage_collect.js
      vboard_cost_guardrail_deterministic.js
      vboard_finance_run.js
      vboard_council_call.sh
      ...
    ops/
      runner/
        HEARTBEAT.md
        KNOWLEDGE.md
      context/
    mail/
      triage/
```

The `adapters/meeting_room/` directory already exists identically in both Hermes upstream and V-Board — it originated in this fork and was upstreamed.

---

## Current Production Setup

Both production servers run **OpenClaw** (the predecessor to Hermes Agent) with the V-Board ops layer running on top. This is exactly the fork model: one process, one workspace, Hermes infrastructure + V-Board capabilities.

| Server | Runtime | Role |
|---|---|---|
| Hostinger | OpenClaw + V-Board ops layer | Primary WhatsApp communicator, runner |
| OVH | OpenClaw + V-Board ops layer | Council core, gateway |

Hermes Agent is the successor to OpenClaw. The `hermes claw migrate` command preserves all job state and workspace files when upgrading.

---

## OpenClaw Migration

If you are running an existing OpenClaw setup:

```bash
# Install the Hermes fork
git clone <vboard-fork-url>
cd hermes-agent
./scripts/install.sh

# Migrate jobs, token state, and workspace from OpenClaw
hermes claw migrate

# Verify
agent_runtime status
agent_runtime cron list
```

The `openclaw_repair` and `openclaw_token_governor` utilities in your ops toolbox remain valid for diagnosing broken sessions or token overruns on legacy containers.

---

## Workspace Layout

All V-Board containers share the `workspace` Docker volume mounted at `/workspace`. Hermes and V-Board write state here:

```
/workspace/
  .agent_runtime/
    cron/
      jobs.json          ← Hermes cron job registry (read by vboard_prod_doctor.js)
    state/               ← model session state, token counters
    memories/            ← cross-session memory store
  bin/
    vboard_council_call.sh
    vboard_route_policy.js
    vboard_cfo_stack.js
    ...
  ops/
    runner/
      HEARTBEAT.md       ← written by vboard_daily_records_refresh
      KNOWLEDGE.md
    context/             ← document memory index
  mail/
    triage/
      latest_inbox_snapshot.json
```

---

## Cron Job Registration

V-Board's runner uses Hermes cron to schedule its scripts. Register them after first deploy inside the runner container:

```bash
agent_runtime cron register vboard_daily_records_refresh \
  --schedule "0 6 * * *" \
  --cmd "node /workspace/bin/vboard_daily_records_refresh.js" \
  --token-budget 50000

agent_runtime cron register mail_triage_collect \
  --schedule "*/30 * * * *" \
  --cmd "node /workspace/bin/mail_triage_collect.js" \
  --token-budget 30000

agent_runtime cron register vboard_cost_guardrail_deterministic \
  --schedule "*/15 * * * *" \
  --cmd "node /workspace/bin/vboard_cost_guardrail_deterministic.js" \
  --token-budget 1000
```

Or import the full crontab at once:

```bash
agent_runtime cron import /workspace/ops/runner/vboard-agent_runtime-runner.cron
```

---

## Environment Variables

The `HERMES_*` and `AGENT_RUNTIME_*` variables in `.env` configure the Hermes runtime that V-Board runs on. They are not external dependency settings — they configure the fork itself:

```bash
# LLM provider for all agent tasks
HERMES_PROVIDER=openrouter
HERMES_API_KEY=

# Model for runner scripts and agent tasks
# (meeting-room council uses PRIMARY_LLM_API_KEY instead)
HERMES_MODEL=openai/gpt-4o-mini

# Workspace — must match the Docker volume mount
AGENT_RUNTIME_WORKSPACE=/workspace
AGENT_RUNTIME_STATE_DIR=/data/.agent_runtime

# Token budget enforcement
HERMES_TOKEN_BUDGET_DAILY=750000
HERMES_TOKEN_BUDGET_PER_JOB=200000

# Telegram gateway for owner notifications
HERMES_TELEGRAM_TOKEN=
HERMES_TELEGRAM_OWNER_ID=
```

---

## Verifying the Stack

```bash
# From inside the container or the fork
agent_runtime status
# Expected: { ok: true, provider: "...", model: "...", channels: [...] }

agent_runtime models status --plain
# Expected: primary model name + fallback list

agent_runtime channels status --probe
# Expected: whatsapp: ok, telegram: ok (or configured channels)

# Trigger a manual prod doctor check
node /workspace/bin/vboard_prod_doctor.js
# Expected: no missing jobs, no unreachable services
```

---

## Links

- Hermes Agent upstream: https://github.com/NousResearch/hermes-agent
- Hermes documentation: https://hermes-agent.nousresearch.com/docs/
- OpenClaw migration: `hermes claw migrate`
