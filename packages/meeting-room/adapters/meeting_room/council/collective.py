"""
AI Worker Collective â€” multi-model meeting council.

5-stage orchestration:
  1. Primary (primary model)  â€” role-specialist answer
  2. Reviewers in parallel    â€” independent scoring (reviewer models)
  3. Weighted consensus       â€” 66% threshold
  4. Chairman synthesis       â€” only if consensus fails
  5. Behavioral overlay       â€” pattern signals from transcript

The council uses 3 different model families to prevent bias collapse.
Validated against cross-family disagreement in review scoring.

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

# â”€â”€â”€ Worker registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_WORKERS: dict[str, dict] = {
    "primary": {
        "family":      "primary",
        "model":       os.getenv("PRIMARY_LLM_MODEL",    "primary-meeting-model"),
        "vote_weight": 1.5,
        "role":        "ROLE_SPECIALIST",
    },
    "reviewer_1": {
        "family":      "reviewer",
        "model":       os.getenv("REVIEWER_LLM_MODEL", "reviewer-meeting-model"),
        "vote_weight": 1.3,
        "role":        "BALANCED_REVIEWER",
    },
    "reviewer_2": {
        "family":      "chair",
        "model":       os.getenv("CHAIR_REVIEWER_LLM_MODEL", "chair-reviewer-model"),
        "vote_weight": 1.2,
        "role":        "FAST_REVIEWER",
    },
    "chairman": {
        "family":      "chair",
        "model":       os.getenv("CHAIR_LLM_MODEL",   "chair-reviewer-model"),
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


# â”€â”€â”€ Main collective â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
          primary_user_prompt   str   (or callable â†’ str)
          reviewer_user_prompt  callable(transcript, primary_output) â†’ str   (optional)
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

        # â”€â”€ Stage 1: Primary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        # â”€â”€ Stage 2: Parallel reviews â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        # â”€â”€ Stage 3: Weighted consensus voting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        voting = self._compute_voting(reviews)
        record["stages"]["voting"] = voting

        # â”€â”€ Stage 4: Chairman (only if consensus fails) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        chairman_resp = None
        if not voting["consensus"]:
            chairman_resp = await _run_chairman(
                worker=self.workers["chairman"],
                scenario=scenario,
                primary_output=primary_resp["output"],
                reviews=reviews,
            )
            record["stages"]["chairman"] = chairman_resp

        # â”€â”€ Stage 5: Behavioral overlay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if scenario.get("transcript"):
            record["stages"]["behavioral"] = _run_behavioral_overlay(scenario["transcript"])

        # â”€â”€ Final verdict â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        # â”€â”€ Totals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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


# â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        f"[{r['reviewer_role'].upper()}] overall={r['scores'].get('overall',50)} â€” {json.dumps(r['scores'])}"
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

    if family == "primary":
        output, cost = await _call_primary(model, system, user, temperature, max_tokens)
    elif family == "reviewer":
        output, cost = await _call_reviewer(model, system, user, temperature, max_tokens)
    elif family == "chair":
        output, cost = await _call_chair(model, system, user, temperature, max_tokens)
    else:
        raise ValueError(f"Unknown provider family: {family}")

    return {
        "output":     output,
        "cost_usd":   cost,
        "latency_ms": int((time.monotonic() - start) * 1000),
    }


async def _call_primary(model, system, user, temperature, max_tokens):
    return await _call_chat_completion(
        api_key_env="PRIMARY_LLM_API_KEY",
        base_url_env="PRIMARY_LLM_API_BASE_URL",
        model=model,
        system=system,
        user=user,
        temperature=temperature,
        max_tokens=max_tokens,
        input_price_per_million=3.0,
        output_price_per_million=15.0,
    )


async def _call_reviewer(model, system, user, temperature, max_tokens):
    return await _call_chat_completion(
        api_key_env="REVIEWER_LLM_API_KEY",
        base_url_env="REVIEWER_LLM_API_BASE_URL",
        model=model,
        system=system,
        user=user,
        temperature=temperature,
        max_tokens=max_tokens,
        input_price_per_million=2.5,
        output_price_per_million=10.0,
    )


async def _call_chair(model, system, user, temperature, max_tokens):
    return await _call_chat_completion(
        api_key_env="CHAIR_LLM_API_KEY",
        base_url_env="CHAIR_LLM_API_BASE_URL",
        model=model,
        system=system,
        user=user,
        temperature=temperature,
        max_tokens=max_tokens,
        input_price_per_million=0.075,
        output_price_per_million=0.30,
    )


async def _call_chat_completion(
    *,
    api_key_env: str,
    base_url_env: str,
    model: str,
    system: str,
    user: str,
    temperature: float,
    max_tokens: int,
    input_price_per_million: float,
    output_price_per_million: float,
):
    api_key = os.getenv(api_key_env) or os.getenv("LLM_ROUTER_API_KEY", "")
    base_url = os.getenv(base_url_env) or os.getenv("LLM_ROUTER_API_BASE_URL", "")
    if not api_key or not base_url:
        raise RuntimeError(f"{api_key_env} and {base_url_env} or LLM_ROUTER_API_* must be configured")

    try:
        import httpx
    except ImportError as exc:
        raise RuntimeError("httpx is required for LLM router calls") from exc

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(f"{base_url.rstrip('/')}/chat/completions", headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices") or []
    text = ""
    if choices:
        message = choices[0].get("message") or {}
        text = message.get("content") or choices[0].get("text") or ""

    usage = data.get("usage") or {}
    prompt_tokens = float(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    completion_tokens = float(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    cost = (prompt_tokens * input_price_per_million + completion_tokens * output_price_per_million) / 1_000_000
    return text, round(cost, 6)

def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()

