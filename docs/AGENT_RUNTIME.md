# Agent Runtime — Hermes Agent + OpenClaw

V-Board does not include its own message delivery, LLM routing, channel gateway, or cron execution engine. All of that is delegated to **Hermes Agent**, which must be installed on every container that runs ops-core, council, or runner.

Without it, every runner script, every outbound WhatsApp notification, every mail triage collect, every cost guardrail alert, and every model call fallback will fail silently. The council can still route and produce work orders, but nothing leaves the system.

---

## What Hermes Agent Is

[Hermes Agent](https://github.com/NousResearch/hermes-agent) (built by Nous Research) is a self-improving AI agent runtime with:

- A CLI binary (`hermes`) that v-board calls as `agent_runtime`
- A channel gateway for Telegram, WhatsApp, Discord, Slack, Signal
- A cron scheduler with a job registry at `/workspace/.agent_runtime/cron/jobs.json`
- Provider-neutral LLM routing (`hermes model` to switch providers)
- A Python SDK (`agent.auxiliary_client`) used by the meeting-room intervention judge
- Session memory and skill creation that persist across restarts

V-Board treats it as infrastructure — the same way it treats Docker or Node. The `agent_runtime` binary must be in `PATH` inside every container.

---

## What OpenClaw Is

OpenClaw is the predecessor CLI to Hermes. It introduced the token governance layer (per-job token budget enforcement) and the job repair tooling. Hermes absorbed OpenClaw's job model; the migration path is:

```bash
hermes claw migrate
```

If you are running a fresh install, use Hermes directly. OpenClaw is only relevant if you have an existing OpenClaw setup to migrate from. The token governor logic from OpenClaw (`openclaw_token_governor`) is now built into Hermes's `HERMES_TOKEN_BUDGET_PER_JOB` and `HERMES_TOKEN_BUDGET_DAILY` env vars.

---

## Installation — Per Container

### Linux / macOS / WSL2

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.bashrc
hermes --version

# V-Board calls the binary as "agent_runtime" — create the alias:
ln -sf "$(which hermes)" /usr/local/bin/agent_runtime
```

### In a Dockerfile

Add this to each container's Dockerfile that needs the runtime (ops-core, council, runner):

```dockerfile
# Install Hermes Agent and expose as agent_runtime
RUN curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash \
    && ln -sf /root/.hermes/bin/hermes /usr/local/bin/agent_runtime

# Configure at least one LLM provider
ENV HERMES_PROVIDER=openrouter
ENV HERMES_API_KEY=""
```

### Verify Installation

```bash
agent_runtime status
agent_runtime models status --plain
agent_runtime channels status --probe
```

---

## Workspace Layout

All V-Board containers share the `workspace` Docker volume mounted at `/workspace`. Hermes writes its state here:

```
/workspace/
  .agent_runtime/
    cron/
      jobs.json          ← Hermes cron job registry (read by vboard_prod_doctor.js)
    state/               ← model session state, token counters
    memories/            ← cross-session memory store
  bin/
    vboard_council_call.sh    ← council call bridge (called by runner cron jobs)
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

The `workspace` volume is declared in `docker-compose.yml` as a named volume shared between `ops-core` (read-only), `council` (read-only), and `runner` (read-write).

---

## Environment Variables

Add these to your `.env` file alongside the existing V-Board vars:

```bash
# ── Hermes Agent runtime ────────────────────────────────────────────────────

# LLM provider for the agent runtime (hermes model to switch)
# Supported: openrouter, nous_portal, novitaai, openai, ollama, huggingface
HERMES_PROVIDER=openrouter
HERMES_API_KEY=

# Model to use for agent tasks (not meeting-room council — that uses PRIMARY_LLM_*)
HERMES_MODEL=openai/gpt-4o-mini

# Workspace path — must match VBOARD_WORKSPACE
AGENT_RUNTIME_WORKSPACE=/workspace
AGENT_RUNTIME_STATE_DIR=/data/.agent_runtime

# Token budget enforcement (from OpenClaw token governor)
HERMES_TOKEN_BUDGET_DAILY=750000
HERMES_TOKEN_BUDGET_PER_JOB=200000

# Channel gateway — configure at least one for outbound delivery
# Telegram (recommended for owner notifications)
HERMES_TELEGRAM_TOKEN=
HERMES_TELEGRAM_OWNER_ID=

# WhatsApp gateway (used by vboard_notify_owner.js and runner)
# Point to your WA-Web gateway or Twilio proxy
HERMES_WHATSAPP_GATEWAY_URL=
HERMES_WHATSAPP_GATEWAY_TOKEN=
```

---

## Per-Container Requirements

| Container | Needs `agent_runtime` binary | Why |
|---|---|---|
| `ops-core` | ✅ | `vboard_prod_doctor.js` reads Hermes status + cron job registry |
| `council` | ✅ | `executive_judge.js` calls `agent_runtime` to resolve model plans and channel status |
| `runner` | ✅ **critical** | Every cron job calls `agent_runtime` for message delivery, model calls, inbox fetch, WhatsApp notify |
| `meeting-room` | Partial | Uses `agent.auxiliary_client` Python import (Hermes Python SDK) for judge LLM calls; falls back to direct SDK if not available |

---

## Cron Jobs and Hermes Scheduler

V-Board's runner uses Linux cron to trigger scripts, but the scripts themselves delegate execution to Hermes. The job registry at `/workspace/.agent_runtime/cron/jobs.json` is what `vboard_prod_doctor.js` reads to check whether expected jobs are registered and running.

Register V-Board's expected cron jobs with Hermes after first deploy:

```bash
# Inside the runner container
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

Or add all jobs at once via the included crontab after Hermes is running:

```bash
agent_runtime cron import /workspace/ops/runner/vboard-agent_runtime-runner.cron
```

---

## Migrating from OpenClaw

If you have an existing OpenClaw installation on the server:

```bash
# Install Hermes (keeps OpenClaw state)
curl -fsSL .../install.sh | bash

# Migrate jobs and token state from OpenClaw
hermes claw migrate

# Verify
agent_runtime status
agent_runtime cron list
```

The `openclaw_repair` and `openclaw_token_governor` utilities in your ops toolbox remain valid for diagnosing broken sessions or token overruns on legacy containers.

---

## Verifying the Full Stack

After installing Hermes on all containers:

```bash
# From the runner container
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

- Hermes Agent repo: https://github.com/NousResearch/hermes-agent
- Hermes documentation: https://hermes-agent.nousresearch.com/docs/
- Install script: `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash`
- OpenClaw migration: `hermes claw migrate`
