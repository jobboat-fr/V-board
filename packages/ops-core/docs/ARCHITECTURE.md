# Architecture

VBOARD Ops Core productizes the container-native operating model.

## Roles

Runner:

- front desk
- WhatsApp/Telegram/email communicator
- CRM writer
- data collector
- low-temperature operator
- sender/executor of explicitly allowed actions

Council:

- high-temperature analysis
- legal/accounting/fiscal review
- CTO/security/cost/deployment review
- deal desk and quality hardening
- prepares decisions only

Council never sends external email, WhatsApp, Telegram, or writes CRM directly.

Finance/CFO stack:

- Runner collects bank, invoice, receipt, and email evidence.
- The normalized context lives under `VBOARD_DATA_ROOT/ops/context`.
- The CFO stack builds reports and ledgers only from validated context.
- If validation fails, it writes a blocked report and stops; it does not invent balances.
- Owner/accountant approval remains required before filing, payment, or legal/tax action.

## Flow

```mermaid
flowchart LR
  A["Inbound message/email/cron"] --> B["Runner compact evidence"]
  B --> C["Route policy"]
  C -->|runner_local| D["Runner executes"]
  C -->|runner_review_first| E["Ask owner / collect evidence"]
  C -->|council_required| F["Council analysis"]
  F --> G["Decision + allowed actions"]
  G --> H["Runner executes allowed actions"]
```

## Core Contracts

- All routing goes through `classify()`.
- All bridge calls pass compact evidence.
- All write access is scoped to `VBOARD_DATA_ROOT`.
- Hot, legal, accounting, fiscal, security, incident, or commitment-risk tasks require owner approval or council preparation.
- Runner owns final delivery.
