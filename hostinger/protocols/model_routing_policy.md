# AZZCO Model Routing Policy

Default/chat:
Primary: together/Qwen/Qwen3.5-9B
Fallback: together/openai/gpt-oss-20b
Use for routine WhatsApp/Telegram replies, simple summaries, mail triage, reminders, and first-pass classification.

Business/CTO/lead scout:
Primary: together/google/gemma-4-31B-it
Fallback: together/openai/gpt-oss-120b
Use for lead scouting, CTO audits, platform monitoring, sales judgment, customer-facing drafts, and medium-risk recommendations.

Deep legal/accounting:
Primary: together/moonshotai/Kimi-K2.5
Fallback: together/Qwen/Qwen3.5-397B-A17B
Use only for deep legal/accounting reviews, contracts, fiscal/social risk, P0/P1 incidents, and high-impact strategy.

Routing algorithm:
1. Routine or low-risk task -> default/chat model.
2. Business, CTO, lead scout, or medium-risk task -> business model.
3. Legal/accounting/fiscal/social/security P0/P1 or deep document review -> deep model.
4. If confidence is below 75%, say so and recommend escalation.
5. Do not use premium models for daily routine jobs.
6. Never expose confidential docs to non-owner users.
7. Never file, pay, sign, submit, or make binding commitments.
