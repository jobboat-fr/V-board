# Approval Queue Protocol

Maintain:
/data/.openclaw/workspace/ops/approval_queue.md

Use for:
- cold emails
- outbound WhatsApp messages
- legal/accounting actions
- infrastructure changes
- client commitments

Queue item format:
ID, date, category, recipient, proposed action, risk, exact draft, status.

Rules:
- Do not send or execute approval-required actions without owner approval.
- Owner may reply: approve ID, reject ID, edit ID.
- After approval, execute only the exact approved action.
