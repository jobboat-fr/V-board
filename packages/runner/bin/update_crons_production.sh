#!/bin/sh

edit_job() {
  id="$1"
  msg="$2"
  agent_runtime cron edit "$id" --message "$msg" || true
}

WORKSPACE="${VBOARD_WORKSPACE:-/workspace}"
CORE="Production mode. Read $WORKSPACE/protocols/runner_council_task_division.md. runner is sender/communicator/CRM writer. council prepares only. Before hard analysis or any council call, build compact JSON and run node $WORKSPACE/bin/vboard_route_or_bridge.js. If route=runner_local, execute locally. If bridge_called=true, execute only explicit allowed actions. Use $WORKSPACE/bin/vboard_notify_owner.js for owner notifications when tool delivery is unavailable. Do not paste huge docs/logs/inboxes; use compact evidence."

edit_job 979207f4-f1eb-4458-8a91-191a977f3ada "$CORE Morning brief: collect only owner-relevant facts and noise-filtered summaries. Route P0/P1, restricted, hot, CTO/legal/accounting, deal-risk items through route_or_bridge. Keep output concise."

edit_job 22f8c847-66ea-4cd0-a006-e5dc920f56d2 "$CORE CTO platform audit: run compact health checks first. Route only incidents, cost/security/deployment risks, or unclear evidence to council. Routine all-clear stays local."

edit_job 26ec2c4f-0886-40bd-9825-d5a76c8b5988 "$CORE Lead scout: runner may process verified low-temperature cold prospects locally. Route warm/hot, high-value, strategic, weak-evidence, or commitment-risk prospects to council. Return evidence-backed picks only."

edit_job 42ca21cc-3e37-459e-a914-7fbcaacc0079 "$CORE Mail triage: filter spam/newsletters/ads locally. Low-temperature cold_mail can be handled locally when verified. Route hot/warm/restricted/customer-risk/pricing/legal/accounting emails to council. No hot mail auto-send."

edit_job 77a662dc-5ddb-4d2d-94bb-8a62b36614fc "$CORE Incident watchdog: first run node $WORKSPACE/bin/vboard_prod_doctor.js. If doctor is OK, send short all-clear. If failures are P0/P1 or ambiguous, route compact evidence to council. Avoid large logs unless owner asks."

edit_job a44c8e0d-62db-40a2-909c-28ed377f6845 "$CORE Legal finance sentinel: legal/accounting/fiscal/social/bank API/bank/invoice/receipt risks route to council with compact evidence. runner never files, pays, signs, or exposes confidential data."

edit_job 8e889f86-49dc-44d8-a2b8-b63f7b9923e5 "$CORE Deal desk: routine CRM housekeeping stays local. Hot leads, proposal, pricing, strategic deal analysis, or confidence hardening route to council. runner updates CRM and asks owner approvals."

edit_job 276fb157-36f4-4537-9606-53f2435ba0f9 "$CORE Approval queue: list pending decisions locally. Route only hot, legal/accounting, CTO, cost, strategic, or high-risk prioritization to council."

edit_job 2e8d6580-8ccc-4f17-b34a-8b21d14725f7 "$CORE Invoice follow-up: invoice matching, missing proofs, fiscal/accounting ambiguity, bank API/bank evidence route to council. runner delivers owner action list."

edit_job 431217ca-622e-4227-853b-7b00d3efd68f "$CORE CRM daily update: runner owns CRM writes and routine follow-ups. Route warm/hot leads, proposal/pricing, deal risk, or unclear evidence to council. Do not scan massive files."

edit_job 5de2b2c9-1e67-4d6b-953a-621570835333 "$CORE Document vault: indexing/manifests stay local. Missing critical legal/accounting docs, compliance, fiscal, or contract risks route to council."

edit_job ee6c4b3b-0c17-4028-a34f-6d0c33500e19 "$CORE Deep legal scan: council-required weekly only. Send compact legal manifest/evidence unless owner approved raw transfer. runner delivers summary."

edit_job 15a92bb7-938a-465d-8c0f-4e673bd849cc "$CORE Deep accounting scan: council-required weekly only. Send compact bank API/bank/invoice evidence. runner delivers missing-proof list."

edit_job 530acccd-ed1d-4f2f-8eaa-db095f76493a "$CORE Deep risk synthesis: council-required for board-level synthesis. runner collects compact evidence and sends owner decisions."

edit_job 54e25ff3-7bc5-4b30-8c2d-ccdfcc9f6b53 "$CORE Weekly board brief: route strategic synthesis to council; runner sends final owner report."
