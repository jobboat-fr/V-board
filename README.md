<div align="center">

<img src="docs/assets/banner.svg" alt="V-Board - Your entire ops team, automated." width="900"/>

<br/>

[![License: MIT](https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square&labelColor=0d0b08&color=7eca6c)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&labelColor=0d0b08&color=7eca6c)](package.json)
[![Python](https://img.shields.io/badge/python-%3E%3D3.11-blue?style=flat-square&labelColor=0d0b08&color=4a9eca)](packages/meeting-room/requirements.txt)
[![Docker](https://img.shields.io/badge/docker-compose-ready?style=flat-square&labelColor=0d0b08&color=e8a020)](docker-compose.yml)
[![CI](https://img.shields.io/github/actions/workflow/status/jobboat-fr/V-board/ci.yml?branch=main&style=flat-square&labelColor=0d0b08&label=CI)](https://github.com/jobboat-fr/V-board/actions)

</div>

---

V-Board is an open-source AI operations stack for routing business work, coordinating specialist AI departments, producing evidence-backed decisions, and keeping humans in control of the actions that matter.

Built for teams that want an AI front desk, CFO, CTO, legal reviewer, sales operator, meeting advisor, and back-office analyst - without letting an agent blindly spend tokens, send messages, or mutate records.

## What It Does

- Routes work before any model call, using deterministic rules and evidence checks.
- Delegates hard questions to a council of specialist workers.
- Keeps outbound communication in the runner/front-desk layer.
- Blocks unsafe or under-evidenced work instead of hallucinating.
- Produces durable work orders, decisions, transcripts, commitments, and audit logs.
- Runs a live meeting-room service where AI advisors can listen, intervene, escalate, and preserve evidence.
- Supports bring-your-own-provider keys for LLMs, speech-to-text, voice, avatars, and bank data.

## The Core Promise

V-Board does not try to be one magic chatbot. It behaves like an operating team:

1. Front desk receives the request.
2. Ops core classifies it and checks evidence.
3. Council prepares specialist analysis when needed.
4. Runner executes only allowed actions.
5. Evidence is written so humans can audit the result.

The main invariant is simple: **the council prepares, the runner communicates.**

## Prerequisites — Hermes Agent (required on every server)

V-Board does not ship its own message gateway, LLM router, cron execution engine, or channel delivery layer. All of that runs through **[Hermes Agent](https://github.com/NousResearch/hermes-agent)**, which must be installed on every machine or container that runs ops-core, council, or runner.

Every runner cron job, every outbound WhatsApp/Telegram notification, every inbox fetch, and every model call fallback calls the `agent_runtime` CLI binary — which is Hermes. Without it the containers start but nothing executes.

```bash
# Install on each server / inside each container
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.bashrc

# V-Board calls the binary as "agent_runtime" — create the alias
ln -sf "$(which hermes)" /usr/local/bin/agent_runtime

# Verify
agent_runtime status
```

If you are migrating from OpenClaw:

```bash
hermes claw migrate
```

See [`docs/AGENT_RUNTIME.md`](docs/AGENT_RUNTIME.md) for per-container Dockerfile setup, workspace layout, cron job registration, environment variables, and OpenClaw migration.

---

## Quick Start

```bash
npm install
npm test --workspaces --if-present
```

Run the no-key meeting-room demo:

```bash
python -m pip install -r packages/meeting-room/requirements.txt pytest
python packages/meeting-room/scripts/demo_meeting_room.py
```

The demo creates a temporary meeting, adds CFO and Legal advisors, captures a transcript commitment, triggers a high-risk intervention, pauses for host approval, resumes with context, and prints the evidence directory.

## Docker Start

```bash
cp .env.example .env
# Fill at least VBOARD_COUNCIL_TOKEN and VBOARD_API_TOKEN for protected services.
docker compose up -d --build
curl http://127.0.0.1:8788/health
```

Optional local model profile:

```bash
docker compose --profile ollama up -d
```

## Packages

| Package | Role |
|---|---|
| `packages/ops-core` | Routing gate, HTTP API, MCP tools, work orders, finance/CFO stack, observability. |
| `packages/council` | Specialist AI council, model routing, cost guard, safety gates, department workflows. |
| `packages/runner` | Cron jobs, evidence collection, report rendering, outbound delivery, quality gates. |
| `packages/meeting-room` | FastAPI meeting advisor with transcript memory, intervention logic, escalation gates, voice/avatar hooks. |
| `front-desk` | Public-facing operator policies and communication modules. |
| `back-office` | Infrastructure, diagnostics, server, cost, and hard technical operations policies. |

## Architecture

Each diagram covers one flow independently. Read them in order for the full system picture, or jump to the one relevant to what you are building.

### Request Entry — 8-Step Routing Pipeline

Every `POST /route` runs this fixed sequence. Steps 1, 2, 3, 5, 6, 7 are deterministic — zero LLM cost.

```mermaid
flowchart LR
    IN([POST /route]) --> P1["① TaskRouter.classify\nkeyword · urgency P0–P3\nrestriction flags"]
    P1 --> P2["② CostGuard.evaluate\ndaily + monthly budget\nnormal / cheap / stop"]
    P2 --> P3["③ buildWorkflow\nD_fast score · mail policy\nlead structuring"]
    P3 --> P4["④ applyKitchenWorkers\nparallel mail classifier\nhot / warm / cold / spam"]
    P4 --> P5["⑤ evaluateDealRoom\n0–100 deal score\ncaptain at 82 · pass at 92"]
    P5 --> P6["⑥ enforceSafetyGates\n× 10 enforced\nany hit → block + owner notify"]
    P6 --> P7["⑦ buildWorkOrder\nL1 DRAFT → L4 HARD_BLOCK\ndurable unit of work"]
    P7 --> P8["⑧ CouncilRuntime.run\nmodel call · judge decision\nevidence write"]
    P8 --> EV[(Evidence store)]
```

### Mail Triage — Inbound Email Classification

```mermaid
flowchart LR
    EMAIL([Inbound email\nor agent_runtime push]) --> EXT["Extract entities\nemail · phone · website"]
    EXT --> SIG["buildCompanySignals\nlanguage · urgency · sector\npain points"]
    SIG --> SCORE["D_fast prospect score\nS × T × Psi × Phi − 1−E"]
    SCORE --> LABEL{"classifyMail\ntemperature 0–100"}
    LABEL -->|"≥ 70 or reply thread"| HOT["hot_mail\nHOT_MAIL_OWNER_APPROVAL"]
    LABEL -->|"35–69 or prior thread"| WARM["warm_mail\nWARM_MAIL_OWNER_APPROVAL"]
    LABEL -->|"restricted topic"| RINT["restricted_internal\nRESTRICTED_MAIL_OWNER_ONLY"]
    LABEL -->|"casino · crypto · spam kw"| SPAM["spam\nSPAM_NO_REPLY — no action"]
    LABEL -->|"cold + outbound"| COMP{"compliance\nprecheck"}
    COMP -->|"pass · conf ≥ 0.75"| DRAFT["cold_mail\nauto_send_allowed\nCold email draft"]
    COMP -->|"fail"| CBLK["COLD_REJECT_BLOCKS_AUTOSEND"]
    HOT & WARM & RINT & CBLK --> OWN["owner_whatsapp\nnotify_owner"]
    DRAFT --> CRM["CRM upsert packet\nlead_id · stage · next_action"]
```

### Lead Scout — Prospect Scoring and Outreach Preparation

```mermaid
flowchart LR
    REQ(["Lead request\nlead_scout · cold_email_campaign\ncrm_pipeline"]) --> SIG["buildCompanySignals\nentities · sector · pain points"]
    SIG --> DFST["D_fast formula\nS × T × Psi × Phi − 1−E\nnormalized 0–1"]
    DFST -->|"D_fast > 0.60"| STR["strong_pick\n+7 deal room pts\nstage: qualified_draft_ready"]
    DFST -->|"D_fast ≥ 0.30"| MAY["maybe\n+3 deal room pts\nstage: research_needed"]
    DFST -->|"D_fast < 0.30"| REJ["reject\n−30 deal room pts"]
    STR & MAY --> DEAL["evaluateDealRoom\ncombined score 0–100"]
    DEAL -->|"score ≥ 82"| CAP["Deal captain activated\n6 team briefs\nCFO · CTO · CRM · Legal · Market · Ops"]
    DEAL -->|"score ≥ 92"| OWNP["Owner-pass\nauto-approve path"]
    CAP --> WO3["Work Order L3\nOWNER_GATE"]
    REJ --> WO4["Work Order L4\nHARD_BLOCK"]
    OWNP & WO3 --> OFF["bestOffer selection\nAI assistant / funnel / booking\nwebsite / MVP / discovery"]
    OFF --> EDRAFT["buildColdEmailDraft\nlanguage FR/EN\nopt-out included"]
```

### Deal Room — High-Value Deal Activation

```mermaid
flowchart TD
    IN(["Deal room score ≥ 82"]) --> ACT["Deal Room activated\ndeal_room.active = true"]
    ACT --> BRIEFS["6 team briefs computed\nmarket · crm · finance\ntechnical · operations · compliance"]
    BRIEFS --> CAP["Deal captain role injected\nweight premium-judge\ncondense all briefs → one packet"]
    CAP --> GATE["DEAL_ROOM_OWNER_REVIEW\nsafety gate triggered"]
    GATE --> BLOCK["All auto-send blocked\nall CRM writes blocked"]
    BLOCK --> OWN["owner_whatsapp\nHot mail requires approval"]
    OWN --> APPR{"Owner reviews\ndecision packet"}
    APPR -->|approved| SEND["Runner sends\nexact approved message"]
    APPR -->|rejected| LOG["Evidence log\nblocked decision"]
    IN2(["score ≥ 92"]) --> OWNP["Owner-pass flag\nskips captain overhead"]
    OWNP --> OWN
```

### Safety Gate Enforcement — All 10 Gates

```mermaid
flowchart TD
    EVAL["evaluateSafetyGates\ncheck all conditions"] --> G1{"non-owner +\nrestricted topic?"}
    G1 -->|yes| N1["NON_OWNER_RESTRICTED_REFUSAL"]
    EVAL --> G2{"route.restricted?"}
    G2 -->|yes| N2["OWNER_ONLY_RESTRICTED_DATA"]
    EVAL --> G3{"mail label?"}
    G3 -->|hot| N3["HOT_MAIL_OWNER_APPROVAL"]
    G3 -->|warm| N4["WARM_MAIL_OWNER_APPROVAL"]
    G3 -->|restricted| N5["RESTRICTED_MAIL_OWNER_ONLY"]
    G3 -->|spam| N6["SPAM_NO_REPLY"]
    EVAL --> G4{"deal_room.active?"}
    G4 -->|yes| N7["DEAL_ROOM_OWNER_REVIEW"]
    EVAL --> G5{"cold + reject\n+ weak signals?"}
    G5 -->|yes| N8["COLD_REJECT_BLOCKS_AUTOSEND"]
    EVAL --> G6{"budget mode?"}
    G6 -->|force_cheap| N9["BUDGET_FORCE_CHEAP_MODE"]
    G6 -->|hard_stop| N10["BUDGET_HARD_STOP"]
    N1 & N2 & N3 & N4 & N5 & N6 & N7 & N8 & N9 & N10 --> BLK["autoSendBlocked = true\nall send + CRM actions blocked"]
    BLK --> OWN["owner_whatsapp notify_owner\ninjected if no owner channel present"]
```

### Work Order Lifecycle — L1 to L4

```mermaid
flowchart LR
    REQ(["Routed + safety-gated\nrequest"]) --> WO["buildWorkOrder\nassign department · owner · evidence links"]
    WO --> L1["L1 DRAFT\ncandidate for auto-send\ncold compliance not yet confirmed"]
    L1 -->|"cold mail\ncompliance pass\nconf ≥ 0.75"| L2["L2 AUTO_SEND_COLD\nauto_send_allowed = true\nno gate triggered"]
    L1 -->|"warm / hot / restricted\nor approval_required"| L3["L3 OWNER_GATE\nowner must approve\nbefore any send"]
    L1 -->|"safety gate hit\nor budget hard_stop"| L4["L4 HARD_BLOCK\nno automated action\nblocked_reason logged"]
    L2 --> ACT["Send cold email\nCRM upsert\nidempotency key checked"]
    L3 --> NOT["owner_whatsapp\napproval request + payload"]
    L4 --> EV1["Evidence log\nblocked_reason + gates"]
    ACT & NOT & EV1 --> EV[(Work order store\nEMP · EST tagged)]
```

### AI Council Consensus — AIWorkerCollective 5-Stage

```mermaid
flowchart TD
    IN(["Council task\nfrom CouncilRuntime"]) --> PRI["Primary model  w=1.5\nrole-specialist answer\ndepartment prompt injected"]
    PRI --> R1["Reviewer 1  w=1.3\nindependent score 0–100\nrelevance · accuracy · risk · tone · overall"]
    PRI --> R2["Reviewer 2  w=1.2\nindependent score 0–100\nthree separate model families"]
    R1 & R2 --> VOTE{"weighted agreement\n≥ 0.66?\noverall ≥ 70 to approve"}
    VOTE -->|"consensus"| BEH["Behavioral overlay\n6 keyword patterns\nno LLM · urgency · dominance · appeasement"]
    VOTE -->|"no consensus"| CHAIR["Chairman  w=2.0\nsynthesize both reviewer\ncritiques into final answer"]
    CHAIR --> BEH
    BEH --> OUT["Council output\nrecommend / object / summarize\nfacts_emp · estimates_est · risks"]
    OUT --> GUARD["Hard invariant\ncannot send email · chat\nCRM update · payment · legal commitment"]
```

### Meeting Room Intervention — 3-Guard Chain

```mermaid
flowchart LR
    AUDIO(["Audio / transcript push\nPOST /meetings/room_id/transcript"]) --> STT["STT or raw text\nadded to room transcript"]
    STT --> G1{"transcript\nempty?"}
    G1 -->|"yes"| SKIP(["skip — zero cost"])
    G1 -->|"no"| G2{"AI spoke in\nlast 3 turns?"}
    G2 -->|"yes"| SKIP
    G2 -->|"no"| G3{"advisor\nsignal present?"}
    G3 -->|"none"| SKIP
    G3 -->|"signal"| FANS["6 advisors in parallel\nCFO · CTO · COO · CRM · Legal · Product\neach generates intervention candidate"]
    FANS --> JUDGE["Judge LLM\nshould_speak: bool\nmessage: str · strict JSON"]
    JUDGE --> RISK{"high risk?\nlegal / financial\nhigh urgency"}
    RISK -->|"normal"| WRITE["Write intervention\nto transcript\nevidence stored"]
    RISK -->|"high"| APPR["Host approval gate\npaused — wait for\nPOST /approve"]
    APPR -->|"approved + context"| WRITE
    APPR -->|"denied"| SKIP
    WRITE --> EV[(meetings/date/room_id/\ntranscripts · commitments · escalations)]
```

### Finance / CFO Stack — Bank Reconciliation

```mermaid
flowchart LR
    BANK(["Bank API\nBANK_API_AUTH or LOGIN/SECRET"]) --> FETCH["bankApi.fetchTransactions\nnormalize · deduplicate"]
    FETCH --> MATCH["Match transactions\nagainst invoices + receipts\naccounting/ directory"]
    MATCH --> CFO["buildCfoStack\nBeancount ledger generation\nEMP facts · EST estimates"]
    CFO --> VAL{"validation\npass?"}
    VAL -->|"missing docs\nor inconsistent"| CLOSE["fail closed\nowner_whatsapp alert\nno partial report"]
    VAL -->|"pass"| REP["CFO report\n[EMP] verified · [EST] estimated\nno raw keys in output"]
    REP --> WO["Work Order\nfinance_ops category\nevidence links"]
    WO --> EV[(Evidence store\nprovider keys never logged)]
```

### Budget / Cost Guard — Model Plan Selection

```mermaid
flowchart LR
    REQ(["Incoming request\nstep 2 of pipeline"]) --> READ["CostGuard.evaluate\nread BudgetStore\ndaily + monthly totals"]
    READ --> EVAL{"budget\nstatus?"}
    EVAL -->|"under limit"| NORM["mode: normal\nfull model plan\npremium model allowed"]
    EVAL -->|"approaching warn"| CHEAP["mode: force_cheap\nstandard / cheap model only\nBUDGET_FORCE_CHEAP_MODE gate"]
    EVAL -->|"hard limit exceeded"| STOP["mode: hard_stop\nall LLM calls blocked\nBUDGET_HARD_STOP gate"]
    NORM --> MODEL["Select model plan\npremium-judge · standard · cheap"]
    CHEAP --> MODEL
    STOP --> OWN["owner_whatsapp\nbudget hard stop alert"]
    MODEL --> LOG[(Cost log\nper-request token count)]
```

### Cron — Daily Records Refresh

```mermaid
flowchart LR
    TRIG(["vboard_daily_records_refresh\nscheduled runner"]) --> FIN["Read finance state\nCFO stack output\nops/finance/"]
    FIN --> MAIL["Read mail state\ninbox snapshot\nmail/triage/"]
    MAIL --> LEADS["Read leads state\nCRM pipeline\nops/leads/"]
    LEADS --> BUILD["Build knowledge packet\ncross-reference all sources"]
    BUILD --> KNW["Write KNOWLEDGE.md\nops/runner/\nfacts + estimates"]
    BUILD --> HB["Write HEARTBEAT.md\nlast-run timestamp\nservice health markers"]
```

### Cron — Cost Guardrail

```mermaid
flowchart LR
    TRIG(["vboard_cost_guardrail_deterministic\nscheduled runner"]) --> READ["Read agent_runtime\ntoken usage state\ncurrent session counts"]
    READ --> D1{"daily total\n> DAILY_TOKEN_WARN\n750 000 tokens?"}
    D1 -->|"yes"| A1["owner_whatsapp\ndaily budget warning\nremaining budget estimate"]
    D1 -->|"no"| D2{"single run input\n> SINGLE_RUN_INPUT_WARN\n200 000 tokens?"}
    D2 -->|"yes"| A2["owner_whatsapp\nsingle-run spike alert\nrun identifier included"]
    D2 -->|"no"| OK(["within budget — no action"])
    A1 & A2 --> LOG[(Cost log\nalert timestamp + counts)]
```

### Cron — Mail Triage Collect

```mermaid
flowchart LR
    TRIG(["mail_triage_collect\nscheduled runner"]) --> FETCH["Fetch inbox via agent_runtime\nMAIL_TRIAGE_LIMIT = 20\nmost recent unprocessed"]
    FETCH --> SAVE["Save raw snapshot\nmail/triage/latest_inbox_snapshot.json\ntimestamped"]
    SAVE --> CALL["Call council pipeline\nVBOARD_COUNCIL_SCRIPT\nmail_triage category"]
    CALL --> LABELS["Mail labels assigned\nhot / warm / cold / spam\nper message"]
    LABELS --> WO["Work orders created\none per actionable message\nL1–L4 automation level"]
    WO --> EV[(mail/triage/\nwork orders + labels)]
```

### Cron — Finance Run

```mermaid
flowchart LR
    TRIG(["vboard_finance_run\nscheduled runner"]) --> MODE{"run mode\narg?"}
    MODE -->|"build"| CFO["buildCfoStack\nfull bank reconciliation\nBeancount ledger"]
    MODE -->|"status"| STAT["financeStatus\nread-only ledger summary\nno bank call"]
    CFO --> BEAN["Beancount output\nbalanced entries\ncurrency normalized"]
    BEAN --> REP["CFO report\n[EMP] verified balances\n[EST] projected items"]
    STAT --> REP
    REP --> EV[(Evidence store\nfiscal period snapshot)]
```

### Cron — Document Memory Refresh

```mermaid
flowchart LR
    TRIG(["vboard_document_memory_refresh\nscheduled runner"]) --> WALK["Walk docs/ and accounting/\nall PDF and ODS files\nrecursive scan"]
    WALK --> HASH["SHA-256 fingerprint\nper file content\nbuild seen-set"]
    HASH --> DEDUP{"fingerprint in\ndedup cache?"}
    DEDUP -->|"yes"| SKIP(["skip — already indexed"])
    DEDUP -->|"no"| EXT["Extract text\npdftotext for PDF\nODS sheet parser"]
    EXT --> IDX["Write to context index\nops/context/\nchunked + tagged"]
    IDX --> CACHE["Update dedup cache\nTTL 5–15 min per category\nmax 2000 entries"]
```

### Cron — Ops Status and Prod Doctor

```mermaid
flowchart LR
    T1(["vboard_ops_status_collect\nscheduled"]) --> READ["Read ops/runner/*.json\nall status files\naggregate packet"]
    T2(["vboard_prod_doctor\nscheduled"]) --> CRONS["Read active cron job list\ncheck expected schedules"]
    CRONS --> HC["Call agent_runtime\nrunner health check\nHTTP probe"]
    HC --> ISSUES{"issues or\nmissed runs?"}
    ISSUES -->|"yes"| OWN["owner_whatsapp\nops alert with details"]
    ISSUES -->|"no"| OK(["healthy — no action"])
    READ & OWN & OK --> EV[(ops/runner/\nstatus snapshots)]
```

### Route Policy — Council vs Local Dispatch

```mermaid
flowchart TD
    IN(["Classified request\nTaskRouter output"]) --> CAT{"category?"}
    CAT -->|"morning_brief\nmail_triage\nlead_scout\nlegal_accounting\ndeal_desk\napproval_queue"| COUNCIL["Route to Council\nfull 8-step pipeline\nWork Order + evidence required"]
    CAT -->|"simple_chat\ndaily_communications\nmail_labeling\nproductivity_ops"| LOCAL["Route locally\nRunner handles directly\nno council call"]
    COUNCIL --> WO["Work Order created\ndepartment · owner\nevidence links"]
    LOCAL --> ACT["Direct action\nowner-gated if restricted\nno model overhead"]
    WO & ACT --> EV[(Evidence store)]
```

### Output Quality Gate — Council Text Validation

```mermaid
flowchart LR
    IN(["Council output text\nstdin"]) --> LEN{"length\n≥ 120 chars?"}
    LEN -->|"no"| F1["TOO_SHORT\nexit 2\noutput blocked"]
    LEN -->|"yes"| SENT{"ends with\ncomplete sentence?"}
    SENT -->|"no"| F2["PARTIAL_SENTENCE_END\nexit 2\ntruncation detected"]
    SENT -->|"yes"| NARR{"forbidden process\nnarration patterns?"}
    NARR -->|"found"| F3["FORBIDDEN_PROCESS_NARRATION\nexit 2\nmeta-commentary blocked"]
    NARR -->|"clean"| PASS(["exit 0\noutput delivered to runner"])
    F1 & F2 & F3 --> LOG["Quality gate log\nblocked output + reason"]
```

## Algorithms

V-Board is not a prompt wrapper. Each layer runs a defined algorithm before any model call is made.

### VBoardCouncilEngine - 8-Step Request Pipeline

Every POST to `/route` runs a fixed 8-step pipeline. Steps 1, 2, 3, 5, 6, and 7 are deterministic - no LLM, no variable cost.

```
Step 1  TaskRouter.classify()        Zero-cost keyword/regex category, urgency, restriction flags
Step 2  CostGuard.evaluate()         Daily/monthly budget check; selects model plan or hard-stops
Step 3  buildWorkflow()              Prospect Score (D_fast formula), mail policy, lead structuring
Step 4  applyKitchenWorkers()        Parallel mail classifier - hot / warm / cold / spam
Step 5  evaluateDealRoom()           0-100 deal score; activates deal captain at 82, owner-pass at 92
Step 6  enforceSafetyGates()         10 named gates; any trigger blocks all send/CRM actions
Step 7  buildWorkOrder()             Durable work unit with L1 Draft -> L4 Hard Block automation level
Step 8  CouncilRuntime.run()         Model call + ExecutiveJudge decision tree + evidence write
```

### Prospect Score (D_fast)

Deterministic lead qualification computed before any model call:

```
D_fast = (S x T x Psi) x Phi - (1 - E)   [normalized 0-1]

S   Structure     contact reachability    (8 if email/site/phone, else 5)
T   Timing        urgency signals         (8 if keyword match, else 6)
Psi   Upside        pain points             (5 if needs discovery, else 8)
Phi   Connectivity  sector fit              (8 for saas/agency/edu/recruiting, else 6)
E   Exposure      risk level              (5 if restricted keywords, else 9)

strong_pick (D_fast > 0.60) -> +7 deal room pts
maybe       (D_fast >= 0.30) -> +3 deal room pts
reject      (D_fast < 0.30) -> -30 deal room pts
```

### AIWorkerCollective - 5-Stage Meeting Council

Used in the meeting room when a high-stakes intervention is considered:

```
Stage 1  Primary model          role-specialist answer                   weight 1.5
Stage 2  2x Reviewers parallel  independent scoring (0-100)              weights 1.3, 1.2
Stage 3  Weighted consensus     agreement >= 0.66 required for approval
Stage 4  Chairman synthesis     invoked only when consensus fails        weight 2.0
Stage 5  Behavioral overlay     keyword pattern scan (no LLM call)
```

Reviewers score on: `relevance`, `accuracy`, `risk_assessment`, `tone`, `overall`. A reviewer approves when `overall >= 70`. The chairman synthesizes a final answer from both reviewer critiques and is only invoked when consensus fails. Three independent model families prevent bias collapse.

### Intervention Judge - Token-Efficient Guard Chain

Before any LLM fan-out, three deterministic guards short-circuit the intervention check:

```
Guard 1  transcript empty?           -> skip (no cost)
Guard 2  AI spoke in last 3 turns?   -> skip (no cost)
Guard 3  no advisor signal?          -> skip (saves all fan-out tokens)
         then, only if all pass
         6 specialty advisors in parallel (CFO, CTO, COO, CRM, Legal, Product)
         then
         single judge LLM call -> strict JSON decision
```

### Safety Gates

10 named gates enforced deterministically before and after model calls. Any triggered gate blocks all automated send and CRM actions and forces an `owner_whatsapp:notify_owner` action:

`NON_OWNER_RESTRICTED_REFUSAL` | `OWNER_ONLY_RESTRICTED_DATA` | `HOT_MAIL_OWNER_APPROVAL` | `WARM_MAIL_OWNER_APPROVAL` | `RESTRICTED_MAIL_OWNER_ONLY` | `SPAM_NO_REPLY` | `DEAL_ROOM_OWNER_REVIEW` | `COLD_REJECT_BLOCKS_AUTOSEND` | `BUDGET_FORCE_CHEAP_MODE` | `BUDGET_HARD_STOP`

### Behavioral Pattern Overlay

Runs a keyword scan over each meeting transcript. No LLM call. Currently detects 6 patterns (`urgency_inflation`, `commitment_avoidance`, `dominance_signaling`, `appeasement`, `trust_building`, `defensive_posture`). The full 572-pattern behavioral registry is the Phase 4 target.

See [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) for complete specifications with thresholds, formulas, and implementation status.

---

## Contracts That Matter

- **Route decision**: every task gets a category, urgency, temperature, ownership state, and allowed next step.
- **Work order**: every non-trivial task becomes a durable unit of work with status, owner, department, and evidence links.
- **Evidence record**: reports separate empirical facts from estimates with `[EMP]` and `[EST]` tags.
- **Council output**: council may recommend, object, and summarize, but it cannot send external messages.
- **Meeting event**: transcripts, decisions, commitments, escalations, avatar sessions, and generated audio are logged per room.
- **Provider adapter**: provider-specific secrets and SDKs stay at the adapter edge, not in the product core.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/CONTRACTS.md`](docs/CONTRACTS.md), [`docs/PROVIDER_ADAPTERS.md`](docs/PROVIDER_ADAPTERS.md), and [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md).

## Meeting Room

The meeting room is the flagship interactive path:

1. A room is created with active advisors such as CFO, CTO, COO, Legal, Product, or CRM.
2. Human transcript or audio enters the room.
3. The advisor council checks whether intervention is useful.
4. Risky, legal, or high-urgency interventions pause for host approval.
5. Approved interventions resume with context and are written to the transcript.
6. Evidence is stored under `VBOARD_DATA_ROOT/meetings/<date>/<room_id>/`.

See [`docs/MEETING_ROOM.md`](docs/MEETING_ROOM.md).

## Provider Model

Core code is provider-neutral. Operators can wire their own:

| Capability | Generic env |
|---|---|
| Primary LLM | `PRIMARY_LLM_API_KEY`, `PRIMARY_LLM_API_BASE_URL` |
| Reviewer LLM | `REVIEWER_LLM_API_KEY`, `REVIEWER_LLM_API_BASE_URL` |
| Chair LLM | `CHAIR_LLM_API_KEY`, `CHAIR_LLM_API_BASE_URL` |
| LLM router | `LLM_ROUTER_API_KEY`, `LLM_ROUTER_API_BASE_URL` |
| Speech-to-text | `STT_API_KEY`, `STT_SDK_MODULE`, `STT_SDK_CLIENT` |
| Voice | `VOICE_API_KEY`, `VOICE_API_BASE_URL`, `VOICE_API_KEY_HEADER` |
| Avatar | `AVATAR_API_KEY`, `AVATAR_API_BASE_URL` |
| Bank data | `BANK_API_AUTH` or `BANK_API_LOGIN` / `BANK_API_SECRET` |

## Security Invariants

- Protected services require bearer tokens in production.
- Meeting-room containers bind to localhost by default.
- File reads and writes are scoped under configured data roots.
- Provider keys are never written to evidence logs.
- The council cannot send email, chat, CRM updates, payments, filings, or legal commitments.
- The CFO stack fails closed when bank validation is missing or inconsistent.
- CI scans for hardcoded secrets, phone numbers, private server IPs, and unsafe council send permissions.

See [`SECURITY.md`](SECURITY.md) and [`docs/meeting-room-security.md`](docs/meeting-room-security.md).

## Development

```bash
npm install
npm test --workspaces --if-present
npm run demo:meeting
```

Meeting-room tests:

```bash
python -m pip install -r packages/meeting-room/requirements.txt pytest
python -m pytest packages/meeting-room/tests -q
```

Syntax and guardrails used during verification:

```bash
node packages/council/scripts/check_all.js
node packages/ops-core/tests/run.js
python packages/meeting-room/scripts/check_meeting_room_security.py
```

## Status

This repository is an actively developed open-source automation framework. The architecture is stable; the gaps below are known and tracked.

### What is shipped

- Full 8-step deterministic routing pipeline (TaskRouter -> CostGuard -> WorkOrder -> CouncilRuntime)
- 10 safety gates enforced before model calls
- D_fast prospect scoring formula (zero LLM cost)
- 0-100 deal room score with six team briefs
- 5-stage AIWorkerCollective council with weighted consensus voting
- Intervention judge with 3-guard token-efficient chain
- Meeting room with transcript memory, escalation, host approval, and evidence store
- JS test suite (`packages/ops-core/tests/run.js`, `packages/council/scripts/hardening_test.js`)
- Python test suite (`packages/meeting-room/tests/`)
- GitHub Actions CI for JS, meeting-room, and deploy

### Gaps vs production-shipped quality

| Gap | Impact | Priority |
|-----|--------|----------|
| Behavioral overlay: 6 patterns implemented, 572 planned | Meeting room misses most behavioral signals | Phase 4 |
| No JSON schemas for route decision, work order, evidence contracts | Downstream consumers can't validate | High |
| No CHANGELOG.md | Integrators can't track breaking changes | High |
| No GitHub issue templates | Community contribution friction | Medium |
| No rate limiting on HTTP endpoints | DoS risk at scale | Medium |
| Dedup cache is in-process only | Does not survive restarts | Medium |
| No operator dashboard | Cost/blocked-work visibility requires log parsing | Low |
| Provider adapter examples limited to core | Integrators must read source to onboard | Low |

### Next milestones

- Stable JSON schemas for route decisions, work orders, evidence, and meeting events
- CHANGELOG.md and semantic release tags
- Issue templates and contribution guide
- Rate limiting on `/route` and meeting-room endpoints
- Behavioral pattern registry expansion (Phase 4)
- One-command Docker demo with seeded fixtures
- Operator dashboard for model usage, cost, blocked work, and evidence trails

## License

MIT. See [`LICENSE`](LICENSE).
