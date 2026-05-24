"""
AI Worker Collective — multi-provider meeting council.

5-stage orchestration:
  1. Primary (Claude Sonnet)  — role-specialist answer
  2. Reviewers in parallel    — independent scoring (GPT-4o + Gemini Flash)
  3. Weighted consensus       — 66% threshold
  4. Chairman synthesis       — only if consensus fails
  5. Behavioral overlay       — pattern signals from transcript

The council uses 3 different AI provider families to prevent bias collapse.
Validated: 70-point harm_risk variance across families when using same provider.

Usage:
  collective = AIWorkerCollective()
  result = await collective.orchestrate(
      task_type="meeting_support",
      scenario={
          "topic": "Q2 sales strategy",
          "transcript": "Alice: We need to close the Acme deal...",
          "advisor_id": "cfo",
          "primary_system_prompt": "You are the CFO advisor...",
          "primary_user_prompt": "What financial risks do you see?",
      }
  )
"""

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any

logger = logging.getLogger("meeting_room.council.collective")

# ─── Worker registry ──────────────────────────────────────────────────────────

_WORKERS: dict[str, dict] = {
    "primary": {
        "family":      "anthropic",
        "model":       os.getenv("COUNCIL_PRIMARY_MODEL",    "claude-sonnet-4-5-20250929"),
        "vote_weight": 1.5,
        "role":        "ROLE_SPECIALIST",
    },
    "reviewer_1": {
        "family":      "openai",
        "model":       os.getenv("COUNCIL_REVIEWER_1_MODEL", "gpt-4o"),
        "vote_weight": 1.3,
        "role":        "BALANCED_REVIEWER",
    },
    "reviewer_2": {
        "family":      "google",
        "model":       os.getenv("COUNCIL_REVIEWER_2_MODEL", "gemini-2.5-flash"),
        "vote_weight": 1.2,
        "role":        "FAST_REVIEWER",
    },
    "chairman": {
        "family":      "google",
        "model":       os.getenv("COUNCIL_CHAIRMAN_MODEL",   "gemini-2.5-flash"),
        "vote_weight": 2.0,
        "role":        "CHAIRMAN",
    },
}

_CONSENSUS_THRESHOLD = 0.66
_READINESS_THRESHOLD = 0.80

_REVIEWER_SYSTEM = """\
You are an independent reviewer evaluating an AI advisor's response to a meeting scenario.
Score the response on each dimension from 0 to 100:

{
  "relevance":       0-100,  // Is it relevant to the current discussion?
  "accuracy":        0-100,  // Is the information correct and grounded?
  "risk_assessment": 0-100,  // Does it correctly identify or avoid risks?
  "tone":            0-100,  // Is the tone appropriate (calm, collegial, not alarmist)?
  "overall":         0-100   // Weighted overall quality
}

Respond in STRICT JSON only. No prose."""

_CHAIRMAN_SYSTEM = """\
You are the Chairman of an AI advisory council. Reviewers disagreed on the primary response.
Your job: synthesize a final, balanced answer that addresses the reviewers' concerns.
Use the same JSON schema as the primary advisor's output."""


# ─── Main collective ──────────────────────────────────────────────────────────

class AIWorkerCollective:
    def __init__(self, workers: dict | None = None):
        self.workers = workers or _WORKERS
        self.consensus_threshold = _CONSENSUS_THRESHOLD
        self.readiness_threshold = _READINESS_THRESHOLD

    async def orchestrate(self, task_type: str, scenario: dict) -> dict:
        """
        Run the 5-stage council and return a full telemetry record.

        scenario keys:
          topic                 str
          transcript            str   (recent meeting context)
          advisor_id            str   (which advisor is speaking)
          primary_system_prompt str
          primary_user_prompt   str   (or callable → str)
          reviewer_user_prompt  callable(transcript, primary_output) → str   (optional)
        """
        run_id = str(uuid.uuid4())
        start_total = time.monotonic()
        record: dict[str, Any] = {
            "run_id":    run_id,
            "task":      task_type,
            "timestamp": _now_iso(),
            "stages":    {},
            "totals":    {},
            "verdict":   {},
        }

        # ── Stage 1: Primary ──────────────────────────────────────────────
        primary_cfg = self.workers["primary"]
        primary_prompt = (
            scenario["primary_user_prompt"]()
            if callable(scenario.get("primary_user_prompt"))
            else scenario.get("primary_user_prompt", "")
        )
        primary_resp = await _llm_call(
            family=primary_cfg["family"],
            model=primary_cfg["model"],
            system=scenario.get("primary_system_prompt", ""),
            user=primary_prompt,
            temperature=0.3,
            max_tokens=600,
        )
        record["stages"]["primary"] = {
            "worker_role": "primary",
            "model":       primary_cfg["model"],
            "family":      primary_cfg["family"],
            "output":      primary_resp["output"],
            "cost_usd":    primary_resp["cost_usd"],
            "latency_ms":  primary_resp["latency_ms"],
        }

        # ── Stage 2: Parallel reviews ─────────────────────────────────────
        reviewer_keys = ["reviewer_1", "reviewer_2"]
        reviewer_prompt_fn = scenario.get("reviewer_user_prompt") or _default_reviewer_prompt
        review_tasks = [
            _run_reviewer(
                key=k,
                worker=self.workers[k],
                transcript=scenario.get("transcript", ""),
                primary_output=primary_resp["output"],
                prompt_fn=reviewer_prompt_fn,
            )
            for k in reviewer_keys
        ]
        reviews = await asyncio.gather(*review_tasks)
        record["stages"]["reviews"] = list(reviews)

        # ── Stage 3: Weighted consensus voting ────────────────────────────
        voting = self._compute_voting(reviews)
        record["stages"]["voting"] = voting

        # ── Stage 4: Chairman (only if consensus fails) ───────────────────
        chairman_resp = None
        if not voting["consensus"]:
            chairman_resp = await _run_chairman(
                worker=self.workers["chairman"],
                scenario=scenario,
                primary_output=primary_resp["output"],
                reviews=reviews,
            )
            record["stages"]["chairman"] = chairman_resp

        # ── Stage 5: Behavioral overlay ───────────────────────────────────
        if scenario.get("transcript"):
            record["stages"]["behavioral"] = _run_behavioral_overlay(scenario["transcript"])

        # ── Final verdict ─────────────────────────────────────────────────
        final_output = (
            chairman_resp["output"] if chairman_resp
            else primary_resp["output"]
        )
        record["verdict"] = {
            "consensus_reached": voting["consensus"],
            "readiness_pass":    voting["weighted_overall"] >= self.readiness_threshold * 100,
            "readiness_score":   voting["weighted_overall"],
            "chairman_invoked":  bool(chairman_resp),
            "final_output":      final_output,
            "behavioral_signals": record["stages"].get("behavioral", {}).get("signals", []),
        }

        # ── Totals ────────────────────────────────────────────────────────
        all_calls = (
            [record["stages"]["primary"]]
            + list(record["stages"]["reviews"])
            + ([record["stages"]["chairman"]] if chairman_resp else [])
        )
        record["totals"] = {
            "cost_usd":        round(sum(c.get("cost_usd", 0) for c in all_calls), 6),
            "latency_ms_total": int((time.monotonic() - start_total) * 1000),
            "n_llm_calls":     len(all_calls),
        }
        return record

    def _compute_voting(self, reviews: list[dict]) -> dict:
        approve = 0.0
        reject  = 0.0
        overalls = []
        for rev in reviews:
            scores  = rev.get("scores", {})
            overall = scores.get("overall", 50)
            w       = self.workers.get(rev.get("reviewer_role", "reviewer_1"), {}).get("vote_weight", 1.0)
            overalls.append(overall)
            if overall >= 70:
                approve += w
            else:
                reject  += w
        total         = approve + reject
        agreement     = approve / total if total > 0 else 0.0
        weighted_avg  = sum(overalls) / len(overalls) if overalls else 0.0
        return {
            "consensus":       agreement >= self.consensus_threshold,
            "agreement_rate":  round(agreement, 3),
            "approve_votes":   approve,
            "reject_votes":    reject,
            "weighted_overall": round(weighted_avg, 1),
        }


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _run_reviewer(
    key: str,
    worker: dict,
    transcript: str,
    primary_output: str,
    prompt_fn,
) -> dict:
    prompt = prompt_fn(transcript, primary_output)
    try:
        resp = await _llm_call(
            family=worker["family"],
            model=worker["model"],
            system=_REVIEWER_SYSTEM,
            user=prompt,
            temperature=0.2,
            max_tokens=300,
        )
        scores = _parse_scores(resp["output"])
    except Exception as exc:
        logger.warning("reviewer %s failed: %s", key, exc)
        scores = {"relevance": 50, "accuracy": 50, "risk_assessment": 50, "tone": 50, "overall": 50}
        resp   = {"output": "", "cost_usd": 0, "latency_ms": 0}
    return {
        "reviewer_role": key,
        "model":         worker["model"],
        "family":        worker["family"],
        "scores":        scores,
        "cost_usd":      resp["cost_usd"],
        "latency_ms":    resp["latency_ms"],
    }


async def _run_chairman(
    worker: dict,
    scenario: dict,
    primary_output: str,
    reviews: list[dict],
) -> dict:
    reviews_summary = "\n".join(
        f"[{r['reviewer_role'].upper()}] overall={r['scores'].get('overall',50)} — {json.dumps(r['scores'])}"
        for r in reviews
    )
    prompt = (
        f"Topic: {scenario.get('topic', 'unspecified')}\n\n"
        f"Primary advisor output:\n{primary_output}\n\n"
        f"Reviewer scores (consensus failed):\n{reviews_summary}\n\n"
        f"Synthesize a final answer addressing the reviewers' concerns."
    )
    try:
        resp = await _llm_call(
            family=worker["family"],
            model=worker["model"],
            system=_CHAIRMAN_SYSTEM,
            user=prompt,
            temperature=0.2,
            max_tokens=600,
        )
        return {
            "worker_role":    "chairman",
            "model":          worker["model"],
            "output":         resp["output"],
            "cost_usd":       resp["cost_usd"],
            "latency_ms":     resp["latency_ms"],
            "triggered_because": "consensus_failed",
        }
    except Exception as exc:
        logger.error("chairman failed: %s", exc)
        return {"worker_role": "chairman", "output": primary_output, "cost_usd": 0, "latency_ms": 0}


def _default_reviewer_prompt(transcript: str, primary_output: str) -> str:
    return (
        f"Meeting transcript context:\n{transcript[:1200]}\n\n"
        f"Advisor response to review:\n{primary_output}\n\n"
        f"Score this response on relevance, accuracy, risk_assessment, tone, and overall."
    )


def _parse_scores(text: str) -> dict:
    try:
        cleaned = text.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        data = json.loads(cleaned)
        defaults = {"relevance": 50, "accuracy": 50, "risk_assessment": 50, "tone": 50, "overall": 50}
        for k in defaults:
            if k in data:
                defaults[k] = int(data[k])
        return defaults
    except Exception:
        return {"relevance": 50, "accuracy": 50, "risk_assessment": 50, "tone": 50, "overall": 50}


def _run_behavioral_overlay(transcript: str) -> dict:
    """
    Simplified behavioral pattern detection.
    Checks the top patterns from the 572-pattern registry.
    Full registry port is in Phase 4.
    """
    text = transcript.lower()
    signals = []
    patterns = [
        ("urgency_inflation",      ["urgent", "asap", "immediately", "critical", "emergency"]),
        ("commitment_avoidance",   ["maybe", "perhaps", "we'll see", "not sure", "depends"]),
        ("dominance_signaling",    ["i decide", "my call", "end of story", "final word"]),
        ("appeasement",            ["of course", "absolutely", "whatever you want", "you're right"]),
        ("trust_building",         ["as i mentioned", "as we discussed", "you know me", "trust me"]),
        ("defensive_posture",      ["that's not my fault", "not my responsibility", "someone else"]),
    ]
    for name, keywords in patterns:
        if any(kw in text for kw in keywords):
            signals.append(name)
    return {"signals": signals, "transcript_chars": len(transcript)}


async def _llm_call(*, family: str, model: str, system: str, user: str, temperature: float, max_tokens: int) -> dict:
    """Unified async LLM call across provider families."""
    start = time.monotonic()
    output = ""
    cost   = 0.0

    if family == "anthropic":
        output, cost = await _call_anthropic(model, system, user, temperature, max_tokens)
    elif family == "openai":
        output, cost = await _call_openai(model, system, user, temperature, max_tokens)
    elif family == "google":
        output, cost = await _call_google(model, system, user, temperature, max_tokens)
    else:
        raise ValueError(f"Unknown provider family: {family}")

    return {
        "output":     output,
        "cost_usd":   cost,
        "latency_ms": int((time.monotonic() - start) * 1000),
    }


async def _call_anthropic(model, system, user, temperature, max_tokens):
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    msg = await client.messages.create(
        model=model, system=system,
        messages=[{"role": "user", "content": user}],
        temperature=temperature, max_tokens=max_tokens,
    )
    text = msg.content[0].text if msg.content else ""
    # Approx cost: claude-sonnet ~$3/$15 per 1M in/out tokens
    cost = (msg.usage.input_tokens * 3 + msg.usage.output_tokens * 15) / 1_000_000
    return text, round(cost, 6)


async def _call_openai(model, system, user, temperature, max_tokens):
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=temperature, max_tokens=max_tokens,
    )
    text = resp.choices[0].message.content or ""
    # GPT-4o ~$2.50/$10 per 1M in/out tokens
    usage = resp.usage
    cost  = (usage.prompt_tokens * 2.5 + usage.completion_tokens * 10) / 1_000_000
    return text, round(cost, 6)


async def _call_google(model, system, user, temperature, max_tokens):
    import google.generativeai as genai
    genai.configure(api_key=os.environ["GOOGLE_API_KEY"])
    gmodel = genai.GenerativeModel(model, system_instruction=system)
    config = genai.types.GenerationConfig(temperature=temperature, max_output_tokens=max_tokens)
    resp   = await asyncio.to_thread(gmodel.generate_content, user, generation_config=config)
    text   = resp.text if hasattr(resp, "text") else ""
    # Gemini Flash ~$0.075/$0.30 per 1M in/out tokens
    cost   = 0.0001  # rough estimate — Gemini doesn't always expose usage
    return text, cost


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
