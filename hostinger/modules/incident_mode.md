# Incident Mode Protocol

Trigger when:
- Vercel/Railway deploy fails
- website/app is down
- WhatsApp/Telegram/email fails
- cron jobs fail
- model/provider errors occur
- security or secret exposure risk appears

Report:
- what broke
- evidence [EMP]
- likely cause [EST]
- business impact
- immediate safe action
- owner approval needed?
- rollback/fix plan

Do not mutate infrastructure unless owner approves.
