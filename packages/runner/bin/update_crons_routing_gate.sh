#!/bin/sh

edit_job() {
  id="$1"
  msg="$2"
  openclaw cron edit "$id" --message "$msg" || true
}

GATE='Read /data/.openclaw/workspace/protocols/hostinger_front_desk_ovh_offload.md and /data/.openclaw/workspace/protocols/hostinger_ovh_task_division.md. Before any OVH call, build compact JSON and run node /data/.openclaw/workspace/bin/azzco_route_policy.js. If route=hostinger_local, handle locally on Hostinger. If route=ovh_required, call /data/.openclaw/workspace/bin/azzco_council_call.sh with compact evidence only. OVH prepares only; Hostinger sends, communicates, writes CRM, and reports.'

edit_job 979207f4-f1eb-4458-8a91-191a977f3ada "$GATE Morning brief: Hostinger collects owner-relevant facts, filters noise, and reports locally unless P0/P1, restricted, hot, strategic, CTO/legal/accounting, or deal-risk items require OVH."

edit_job 22f8c847-66ea-4cd0-a006-e5dc920f56d2 "$GATE CTO platform audit: Vercel/Railway/OVH/Hostinger incidents, secrets, uptime, cost, or deployment risks normally route to OVH. Routine all-clear summaries may be handled locally from evidence."

edit_job 26ec2c4f-0886-40bd-9825-d5a76c8b5988 "$GATE Lead scout: Hostinger can handle verified low-temperature cold prospects locally and send only when policy allows. Warm/hot, strategic, weak-evidence, high-value, or commitment-risk prospects route to OVH for hard scoring. Never hallucinate prospects."

edit_job 42ca21cc-3e37-459e-a914-7fbcaacc0079 "$GATE Mail triage: Hostinger filters newsletters, ads, spam, simple owner mail, and low-temperature cold_mail locally. Hot/warm/restricted/customer-risk/commitment/pricing/legal/accounting emails route to OVH. Hostinger sends only allowed cold mail or owner-approved hot mail."

edit_job 77a662dc-5ddb-4d2d-94bb-8a62b36614fc "$GATE Incident watchdog: P0/P1 infrastructure, channel, bridge, cost, security, or data-risk issues route to OVH. Routine green checks stay local. Report evidence only."

edit_job a44c8e0d-62db-40a2-909c-28ed377f6845 "$GATE Legal finance sentinel: legal/accounting/fiscal/social/Qonto/bank/invoice/receipt risks always route to OVH with compact evidence. Hostinger never files, pays, signs, or exposes confidential data."

edit_job 8e889f86-49dc-44d8-a2b8-b63f7b9923e5 "$GATE Deal desk: low-temperature CRM housekeeping stays local. Hot leads, pricing, proposal, strategic deal analysis, or confidence hardening route to OVH. Hostinger updates CRM and asks owner approvals."

edit_job 276fb157-36f4-4537-9606-53f2435ba0f9 "$GATE Approval queue: Hostinger lists pending decisions locally. Route to OVH only for prioritization of hot, legal/accounting, CTO, cost, strategic, or high-risk decisions."

edit_job 2e8d6580-8ccc-4f17-b34a-8b21d14725f7 "$GATE Invoice follow-up: invoice matching, missing proofs, fiscal/accounting ambiguity, Qonto/bank evidence route to OVH. Hostinger delivers owner action list and transfers files only when allowed."

edit_job 431217ca-622e-4227-853b-7b00d3efd68f "$GATE CRM daily update: Hostinger owns CRM writes and routine follow-ups locally. Warm/hot leads, deal risk, proposal/pricing, or unclear evidence route to OVH before owner-facing recommendation."

edit_job 5de2b2c9-1e67-4d6b-953a-621570835333 "$GATE Document vault: manifests and indexing stay local. Missing critical legal/accounting docs, compliance, fiscal, or contract risks route to OVH."

edit_job ee6c4b3b-0c17-4028-a34f-6d0c33500e19 "$GATE Deep legal scan: always OVH-required, weekly only, compact evidence/manifests unless owner approved raw transfer. Hostinger delivers summary."

edit_job 15a92bb7-938a-465d-8c0f-4e673bd849cc "$GATE Deep accounting scan: always OVH-required, weekly only, compact Qonto/bank/invoice evidence. Hostinger delivers missing-proof list."

edit_job 530acccd-ed1d-4f2f-8eaa-db095f76493a "$GATE Deep risk synthesis: OVH-required for board-level synthesis. Hostinger sends owner report and decisions needed."

edit_job 54e25ff3-7bc5-4b30-8c2d-ccdfcc9f6b53 "$GATE Weekly board brief: route strategic synthesis to OVH; Hostinger collects compact evidence and sends final owner report."
