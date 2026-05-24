# Cost Guardrail Protocol

Mission: prevent Together/OpenClaw spend from running away.

Daily budget target: $3/day unless owner changes it.
Premium model use must be rare and justified.

Check:
- cron list and recent cron runs
- models used by each job
- failed/retried runs
- unusually long reports
- premium model usage
- whether deep scans should be paused/manual-only

Output:
- estimated spend risk: low/medium/high
- jobs causing cost
- recommended downgrades
- premium usage justification
- next owner action

If real billing is not accessible, say so and estimate from model/job activity.
