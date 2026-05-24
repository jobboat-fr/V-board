# Core Contracts

The goal of V-Board is not only to run agents. It is to make agent work auditable, bounded, and repeatable. These are the contracts that keep the system stable.

## Route Decision

A route decision answers: what is this work, who owns it, and what is the safest next step?

Required fields:

- `category`: task family such as `mail_labeling`, `lead_scout`, `invoice_reconciliation`, `cto_audit`, or `owner_decision_meeting`.
- `urgency`: P0 to P3 or equivalent normalized urgency.
- `temperature`: risk/importance score from deterministic signals.
- `restricted`: whether the request touches legal, accounting, fiscal, security, credentials, payments, or private records.
- `decision`: `runner_local`, `runner_review_first`, or `council_required`.
- `policy`: includes `council_may_send: false`.

## Work Order

A work order turns a request into a durable piece of operational work.

Required fields:

- `id`
- `status`
- `category`
- `department`
- `automation_level`
- `lifecycle.next_required_actor`
- `evidence`
- `allowed_actions`
- `blocked_actions`

## Evidence Record

Evidence records keep facts separated from estimates.

Rules:

- Use `[EMP]` for empirical facts read from files, APIs, transcripts, or logs.
- Use `[EST]` for inference, judgement, projections, or likely explanations.
- Never bury missing evidence. Name the blocker.
- Never invent balances, signatures, approvals, invoices, or commitments.

## Council Output

Council output is advisory and structured.

Expected fields:

- summary
- findings
- risks
- missing evidence
- recommended action
- allowed actions
- blocked actions
- cost metadata when available

Council output must not directly send email, chat messages, CRM writes, payments, filings, or legal commitments.

## Meeting Event

Meeting-room events are durable JSONL records under `VBOARD_DATA_ROOT/meetings/<date>/<room_id>/`.

Streams:

- `transcript.jsonl`
- `decisions.jsonl`
- `commitments.jsonl`
- `escalations.jsonl`
- `avatars.jsonl`
- `manifest.json`

## Provider Adapter

A provider adapter converts generic V-Board requests into a specific external provider call.

Adapter rules:

- Accept API keys from environment or request-scoped BYOK fields.
- Redact provider errors before returning them.
- Do not write raw keys to evidence logs.
- Use timeouts.
- Fail with clear configuration errors.
- Keep provider names out of core business logic.