# V-Board Algorithms

Technical reference for the deterministic routing, council orchestration, scoring, and behavioral systems.

---

## 1. VBoardCouncilEngine - 8-Step Request Pipeline

Every inbound request to `POST /route` runs through a fixed 8-step pipeline in `packages/council/src/index.js`. Steps are synchronous unless explicitly async.

```
Request
  |
  |- Step 1: TaskRouter.classify()          <- zero-cost keyword/regex ladder
  |- Step 2: CostGuard.evaluate()           <- budget check, model plan selection
  |- Step 3: buildWorkflow()                <- signals, mail policy, lead structuring
  |- Step 4: applyKitchenWorkers()          <- parallel mail classifier (async)
  |- Step 5: evaluateDealRoom()             <- 0-100 deal score
  |- Step 6: enforceSafetyGates()           <- 10 named gates, action blocking
  |- Step 7: buildWorkOrder()               <- durable unit of work, L1-L4 level
  \- Step 8: CouncilRuntime.run()           <- model call (optional), evidence build
```

### Step 1 - TaskRouter (deterministic, zero LLM cost)

`packages/council/src/router/task_router.js` -> `routePolicy.classify()`

Classifies every request into a category, urgency (P0-P3), and a set of routing flags without any model call. Runs a keyword ladder first, then a regex pass, and short-circuits on first match.

Output fields:
- `category` - e.g. `lead_scout`, `mail_triage`, `mail_labeling`, `deal_support`, `finance_query`
- `urgency` - `P0` (legal/breach/blocked payment) through `P3` (low priority)
- `restricted` - true if sensitive data detected
- `requireOwnerApproval` - pre-set by policy, not by a model
- `channel` - inferred from request

### Step 2 - CostGuard

`packages/council/src/ops/cost_guard.js`

Reads running daily and monthly spend from `BudgetStore`. Selects a model plan from `MODEL_REGISTRY` based on remaining headroom. Hard-stops the request if budget is exhausted.

Budget modes:
- `normal` - full model plan
- `force_cheap` - downgrade to cheapest model family
- `hard_stop` - refuse all non-trivial LLM work, push to owner review

### Step 3 - buildWorkflow + Prospect Score

`packages/council/src/workflows/company_workflows.js`
`packages/council/src/signals/company_signal_engine.js`

`buildCompanySignals()` runs a deterministic scoring function over the request text. No LLM call. Output includes:

```
prospect_score: {
  S   - Structure      (contact reachability: 8 if email/site/phone, else 5)
  T   - Timing         (urgency keywords: 8 if match, else 6)
  Psi - Upside         (pain points: 5 if "needs discovery", else 8)
  Phi - Connectivity   (sector fit: 8 for saas/agency/education/recruiting, else 6)
  E   - Exposure       (risk: 5 if restricted keywords, else 9)
  D_fast = (S x T x Psi) x Phi - (1 - E)   [normalized 0-1]
  decision: "strong_pick" (> 0.6) | "maybe" (>= 0.3) | "reject" (< 0.3)
}
```

`D_fast` is a fast prospect qualification composite. It does not require an LLM call and runs before any model billing.

### Step 4 - Kitchen Workers (parallel, async)

`packages/council/src/kitchen/kitchen_runtime.js`

Runs mail classification in parallel with the workflow build. Uses a `ClassifierProvider` to label each email:

- `hot_mail` - high-value inbound, requires owner approval before agent send
- `warm_mail` - qualified but not urgent, owner approval required
- `cold_mail` - outbound prospect email, may auto-send if all gates pass
- `restricted_internal` - internal/confidential, owner-only
- `spam` - no reply

Output feeds directly into safety gate evaluation (Step 6).

### Step 5 - Deal Room

`packages/council/src/deal_room/deal_room.js`

Computes a 0-100 deal score without a model call by combining:

| Signal | Points |
|--------|--------|
| Base from mail temperature_score | varies |
| Lead evidence (website, email, contact) | +5-20 |
| Mail label `hot_mail` | floor at 88 |
| Mail label `warm_mail` | floor at 58 |
| Prospect decision `strong_pick` | +7 |
| Prospect decision `maybe` | +3 |
| Prospect decision `reject` | -30 |
| Budget/pricing keywords in text | +8 |
| Contract/signature keywords | +10 |
| Meeting/demo keywords | +8 |
| Urgency keywords | +7 |
| Decision-maker keywords | +5 |
| Restricted signal | -10 |

Thresholds:
- `DEAL_ROOM_THRESHOLD = 82` - activates deal captain model + 6-team brief
- `OWNER_PASS_THRESHOLD = 92` - owner may approve autonomously

When the deal room activates, six team briefs are generated for: CRM/Sales, Compliance/Privacy, Finance, Legal, Memory/Records, Quality Council.

### Step 6 - Safety Gates

`packages/council/src/policy/safety_gates.js`

10 named gates. A gate triggers and sets `autoSendBlocked = true`:

| Gate | Trigger |
|------|---------|
| `NON_OWNER_RESTRICTED_REFUSAL` | Non-owner accessing restricted data |
| `OWNER_ONLY_RESTRICTED_DATA` | Route marked restricted |
| `HOT_MAIL_OWNER_APPROVAL` | Hot mail requires human approval |
| `WARM_MAIL_OWNER_APPROVAL` | Warm mail requires human approval |
| `RESTRICTED_MAIL_OWNER_ONLY` | Internal mail, owner only |
| `SPAM_NO_REPLY` | Spam detected |
| `DEAL_ROOM_OWNER_REVIEW` | Deal room active |
| `COLD_REJECT_BLOCKS_AUTOSEND` | Cold mail + prospect reject + weak scores |
| `BUDGET_FORCE_CHEAP_MODE` | Budget in cheap mode |
| `BUDGET_HARD_STOP` | Budget exhausted |

When any gate triggers, all send/CRM actions are blocked and an `owner_whatsapp:notify_owner` action is automatically appended to the allowed actions list. The council cannot override a triggered gate.

### Step 7 - Work Order

`packages/council/src/work_orders/work_order_kernel.js`

Every non-trivial request becomes a durable `WorkOrder` with:
- `id`, `status`, `department`, `owner`, `evidence_links`
- `automation_level` - L1 through L4:

| Level | Name | Meaning |
|-------|------|---------|
| L1 | `DRAFT` | Draft only; owner must initiate send |
| L2 | `AUTO_SEND_COLD` | Agent runtime may auto-send cold email |
| L3 | `OWNER_GATE` | Explicit owner approval required before action |
| L4 | `HARD_BLOCK` | Permanently blocked; do not proceed |

### Step 8 - CouncilRuntime

`packages/council/src/council/council_runtime.js`

Selects a model from `MODEL_REGISTRY` (or skips for `runner_local` routes), calls the LLM, applies the `ExecutiveJudge` decision tree, and writes evidence.

`ExecutiveJudge` decision logic:
- Confidence < 0.7 -> `owner_review`
- Contradiction detected -> `owner_review`
- P0 urgency + risks -> `urgent_owner_alert`
- Else -> produces `allowed_actions` and `blocked_actions` lists

---

## 2. AIWorkerCollective - 5-Stage Meeting Council

Python implementation in `packages/meeting-room/adapters/meeting_room/council/collective.py`.

Used by the meeting room when a high-stakes intervention is considered.

```
Stage 1: Primary model call       (weight 1.5)
Stage 2: 2x parallel reviewer     (weights 1.3, 1.2)
Stage 3: Weighted consensus vote  (threshold: agreement >= 0.66)
Stage 4: Chairman synthesis       (weight 2.0, only if consensus fails)
Stage 5: Behavioral overlay       (pattern scan, no LLM call)
```

### Vote Mechanics

Each reviewer scores the primary response on five dimensions (0-100):
`relevance`, `accuracy`, `risk_assessment`, `tone`, `overall`

A reviewer **approves** if `overall >= 70`.

```python
agreement = approve_weight_sum / (approve_weight_sum + reject_weight_sum)
consensus  = agreement >= 0.66
```

Weighted overall (for readiness gate):
```python
weighted_overall = mean(reviewer_overalls)
readiness_pass   = weighted_overall >= 80
```

Worker vote weights:

| Worker | Family | Weight |
|--------|--------|--------|
| primary | primary | 1.5 |
| reviewer_1 | reviewer | 1.3 |
| reviewer_2 | chair | 1.2 |
| chairman | chair | 2.0 |

The chairman is invoked **only** when `agreement < 0.66`. Its weight of 2.0 is used for telemetry; it produces the final output directly (not another vote round).

Three model families are used to prevent bias collapse. Each family maps to independent API credentials (`PRIMARY_LLM_*`, `REVIEWER_LLM_*`, `CHAIR_LLM_*`). If a family shares the same backend provider, operators should use different model versions to preserve independence.

### Cost Flow

Minimum LLM calls per council run: **3** (primary + 2 reviewers).
If consensus fails: **4** (+ chairman).

Cost is tracked per call and summed in `totals.cost_usd`. The caller can inspect `stages.primary.cost_usd`, `stages.reviews[*].cost_usd`, and `stages.chairman.cost_usd` separately.

---

## 3. Intervention Judge - Token-Efficient Guard Chain

`packages/meeting-room/adapters/meeting_room/intervention.py`

Called after each transcribed utterance. Uses three deterministic guards before any LLM call to minimize cost:

```
Guard 1: transcript empty?          -> speak: false, reason: transcript_empty
Guard 2: AI spoke in last 3 turns?  -> speak: false, reason: just_spoke_recently
Guard 3: no advisor signal?         -> speak: false, reason: no_advisor_signal
   then, only if all guards pass
Fan-out: parallel specialty advisors (CFO, CTO, COO, CRM, Legal, Product)
   then
Judge LLM: single call, strict JSON output
```

**Specialty advisors** (`active_advisors` list, default: `["cfo", "cto", "coo", "crm"]`):

| Advisor | Domain |
|---------|--------|
| `cfo` | Finance & ROI |
| `cto` | Technology & Architecture |
| `coo` | Operations & Execution |
| `crm` | Customer Relations & Pipeline |
| `legal` | Compliance & Risk |
| `product` | UX & Roadmap |

An advisor that returns `"NOTHING TO SIGNAL"` is dropped before the judge call. If all advisors return nothing (Guard 3), no judge call is made.

The judge responds in strict JSON: `{speak, message, urgency, reason, touched_advisors}`.

If `urgency` is `"high"`, the meeting room escalation policy may pause for host approval before inserting the intervention into the transcript.

---

## 4. Behavioral Pattern Overlay

`packages/meeting-room/adapters/meeting_room/council/collective.py` -> `_run_behavioral_overlay()`

Runs a keyword scan over the meeting transcript on every council call. No LLM call.

**Current state: 6 patterns implemented.**

| Pattern | Keywords |
|---------|----------|
| `urgency_inflation` | urgent, asap, immediately, critical, emergency |
| `commitment_avoidance` | maybe, perhaps, we'll see, not sure, depends |
| `dominance_signaling` | i decide, my call, end of story, final word |
| `appeasement` | of course, absolutely, whatever you want, you're right |
| `trust_building` | as i mentioned, as we discussed, you know me, trust me |
| `defensive_posture` | that's not my fault, not my responsibility, someone else |

**Target: 572+ patterns.** The full behavioral registry (covering negotiation, deception, authority, groupthink, conflict escalation, and commitment/consistency signals) is planned for Phase 4. The current implementation is a minimal functional baseline that exercises the overlay pipeline.

Detected signals are attached to `verdict.behavioral_signals` in the council telemetry record.

---

## 5. Dedup Cache

`packages/council/src/server.js`

Before any engine work, the server computes a SHA-256 fingerprint of the request:

```javascript
seed = { category, channel, prompt[0:400], email.{id,from,subject,threadId} }
key  = sha256(JSON.stringify(seed)).slice(0, 16)
```

If the same key is seen within the TTL, the cached result is returned immediately with `cached: true`:

| Category | TTL |
|----------|-----|
| `mail_labeling` | 10 minutes |
| `mail_triage` | 10 minutes |
| `lead_scout` | 15 minutes |
| default | 5 minutes |

The cache is in-process (Map) and does not survive restarts. Maximum 2000 entries; entries older than 30 minutes are evicted when the limit is reached.

---

## 6. Route Logger + Observability

`packages/council/src/ops/route_logger.js`

Every completed request appends a JSON line to a rolling log file. Accessible via `GET /ops/routes?limit=N` (max 100 entries). Fields logged per route:

`runId`, `timestamp`, `category`, `urgency`, `restricted`, `owner`, `channel`, `department`, `workOrder.{id,status,automationLevel,nextActor}`, `dealRoom.{active,score,decision,confidence}`, `budget.{mode,estimatedUsd}`, `safetyGates[]`, `decision.action`, `allowedActions[]`, `blockedActions[]`

---

## Implementation Status

| Subsystem | Status |
|-----------|--------|
| VBoardCouncilEngine 8-step pipeline | [x] Implemented |
| TaskRouter deterministic classify | [x] Implemented |
| CostGuard + BudgetStore | [x] Implemented |
| Prospect Score (D_fast formula) | [x] Implemented |
| Deal Room (0-100 score) | [x] Implemented |
| 10 Safety Gates | [x] Implemented |
| Work Order L1-L4 | [x] Implemented |
| Dedup cache | [x] Implemented |
| AIWorkerCollective 5-stage council | [x] Implemented |
| Weighted consensus vote | [x] Implemented |
| Intervention judge 3-guard chain | [x] Implemented |
| Specialty advisor fan-out (6 advisors) | [x] Implemented |
| Behavioral overlay (6 patterns) | [x] Baseline only |
| Behavioral overlay (572+ patterns) | [ ] Phase 4 |
| JSON contract schemas | [ ] Planned |
| Python meeting-room test suite | [x] Exists (test_advisors.py, test_server.py) |
| JS test suite | [x] Exists (run.js + hardening_test.js) |
| CHANGELOG | [ ] Missing |
| Issue templates | [ ] Missing |
