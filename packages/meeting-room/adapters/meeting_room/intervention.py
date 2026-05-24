"""
Intervention check â€” "should the AI raise its hand right now?"

Called after each transcribed utterance (or on a heartbeat).
Fans out to specialty advisors in parallel, then asks a judge LLM
whether to speak and what to say.

Returns:
  { speak: False, reason: str }
  or
  { speak: True, message: str, urgency: str, reason: str, touched_advisors: list[str], cost_usd: float }

The AI only speaks when:
  1. There is a concrete signal (risk, opportunity, fact, contradiction)
  2. It hasn't already been said in the last 5 turns
  3. It brings immediate value to the current conversation
  4. It fits in ONE clear sentence (max 30 words)
"""

import asyncio
import json
import logging
import os
from typing import TypedDict

from . import short_term_memory as stm

logger = logging.getLogger("meeting_room.intervention")


# â”€â”€â”€ Judge system prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_JUDGE_SYSTEM = """\
You are the single AI voice advisor in an ongoing meeting with other humans.
You must NOT interrupt. You intervene only when you have something clear, useful, and non-redundant to say.

STRICT criteria to intervene:
1. There is a concrete signal (risk, opportunity, omitted fact, contradiction).
2. It has NOT already been said in the last 5 turns.
3. It brings immediate value to the current conversation.
4. You can summarize it in ONE clear sentence (max 30 words).

If NONE of these criteria are met, do not intervene.

You receive:
- The meeting topic
- Recent transcript
- Parallel observations from your specialty advisors (CFO, CTO, COO, CRM...)
- Long-term memory excerpt (who the user is, their values, history)

Respond in STRICT JSON (no markdown, no surrounding prose):
{
  "speak": true | false,
  "message": "If speak=true, ONE clear sentence (max 30 words). Otherwise empty string.",
  "urgency": "low" | "normal" | "high",
  "reason": "Why (1 short sentence). If speak=false, explain why not.",
  "touched_advisors": ["cfo" | "cto" | "coo" | "crm" | "legal" | "product" | ...]
}

No emojis. Professional tone."""


def _advisor_system(specialty_name: str) -> str:
    return (
        f"You are the {specialty_name} advisor silently listening to an ongoing meeting. "
        f"Your role: produce ONE relevant observation on what was just said, from a "
        f"{specialty_name} perspective, in 1-2 sentences max. "
        f'If you have nothing useful to add, write exactly "NOTHING TO SIGNAL". No emojis.'
    )


# â”€â”€â”€ Advisor registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ADVISORS = {
    "cfo":     {"name": "CFO â€” Finance & ROI"},
    "cto":     {"name": "CTO â€” Technology & Architecture"},
    "coo":     {"name": "COO â€” Operations & Execution"},
    "crm":     {"name": "CRM â€” Customer Relations & Pipeline"},
    "legal":   {"name": "Legal â€” Compliance & Risk"},
    "product": {"name": "Product â€” UX & Roadmap"},
}


# â”€â”€â”€ Main entry point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def check_intervention(ctx: dict) -> dict:
    """
    ctx keys:
      room_id              str
      topic                str
      active_advisors      list[str]   default: ["cfo", "cto", "coo", "crm"]
      long_term_memory     str         optional excerpt
      window_size          int         default: 20
    """
    room_id          = ctx["room_id"]
    topic            = ctx.get("topic", "")
    active_advisors  = ctx.get("active_advisors", ["cfo", "cto", "coo", "crm"])
    long_term_memory = ctx.get("long_term_memory", "")
    window_size      = ctx.get("window_size", 20)

    window = stm.recent(room_id, window_size)

    # â”€â”€ Guard 1: empty transcript
    if not window:
        return {"speak": False, "reason": "transcript_empty"}

    # â”€â”€ Guard 2: AI just spoke recently (last 3 turns)
    if any(u["kind"] == "ai" for u in window[-3:]):
        return {"speak": False, "reason": "just_spoke_recently"}

    transcript = "\n".join(f"{u['speaker_name']}: {u['text']}" for u in window)

    # â”€â”€ Fan-out: parallel specialty observations
    observations = await _run_specialty_fan_out(
        active_advisors, topic, transcript
    )

    # â”€â”€ Guard 3: no specialist had anything to say â†’ skip judge (saves tokens)
    if not observations:
        return {"speak": False, "reason": "no_advisor_signal"}

    # â”€â”€ Judge: should we actually speak?
    result = await _run_judge(topic, transcript, observations, long_term_memory)
    return result


# â”€â”€â”€ Fan-out â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _run_specialty_fan_out(
    active_advisors: list[str],
    topic: str,
    transcript: str,
) -> list[dict]:
    """Run all active advisors in parallel and collect non-empty observations."""

    async def _ask_advisor(advisor_id: str) -> dict | None:
        cfg = ADVISORS.get(advisor_id)
        if not cfg:
            return None
        prompt = (
            f"Meeting topic: {topic or 'unspecified'}\n\n"
            f"Recent transcript:\n{transcript}\n\n"
            f"Your {cfg['name']} observation (1-2 sentences or 'NOTHING TO SIGNAL'):"
        )
        try:
            text = await _llm_call(
                system=_advisor_system(cfg["name"]),
                user=prompt,
                temperature=0.3,
                max_tokens=120,
            )
            if "NOTHING TO SIGNAL" in text.upper():
                return None
            return {"advisor_id": advisor_id, "observation": text.strip()}
        except Exception as exc:
            logger.warning("advisor %s failed: %s", advisor_id, exc)
            return None

    results = await asyncio.gather(*[_ask_advisor(aid) for aid in active_advisors])
    return [r for r in results if r is not None]


# â”€â”€â”€ Judge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _run_judge(
    topic: str,
    transcript: str,
    observations: list[dict],
    long_term_memory: str,
) -> dict:
    obs_block = "\n".join(
        f"[{o['advisor_id'].upper()}] {o['observation']}" for o in observations
    )
    parts = [f"Topic: {topic or 'unspecified'}"]
    if long_term_memory:
        parts.append(f"\nUser long-term memory:\n{long_term_memory}")
    parts.append(f"\nRecent transcript:\n{transcript}")
    parts.append(f"\nAdvisor observations:\n{obs_block}")
    parts.append("\nDecide: intervene or not. Respond in strict JSON.")
    prompt = "\n".join(parts)

    try:
        raw = await _llm_call(
            system=_JUDGE_SYSTEM,
            user=prompt,
            temperature=0.2,
            max_tokens=280,
        )
        cleaned = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        parsed = json.loads(cleaned)
    except Exception as exc:
        logger.warning("judge parse failed: %s", exc)
        return {"speak": False, "reason": "judge_parse_failed"}

    speak = bool(parsed.get("speak"))
    return {
        "speak": speak,
        "message": str(parsed.get("message", "")).strip() if speak else "",
        "urgency": parsed.get("urgency", "normal") if parsed.get("urgency") in ("low", "normal", "high") else "normal",
        "reason": str(parsed.get("reason", "")),
        "touched_advisors": [
            s for s in (parsed.get("touched_advisors") or [o["advisor_id"] for o in observations])
            if isinstance(s, str)
        ],
    }


# â”€â”€â”€ LLM call (uses agent runtime multi-provider client) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _llm_call(*, system: str, user: str, temperature: float, max_tokens: int) -> str:
    """
    Route to the best available LLM backend.

    Resolution order:
    1. agent runtime auxiliary_client.call_llm â€” respects the user's configured
       provider/model (configured LLM providers)
    2. Direct primary LLM SDK â€” fallback when running outside
       the main agent runtime process (e.g. standalone HTTP server mode).

    The auxiliary client is synchronous; we offload it to a thread so
    the meeting-room's async fan-out can stay non-blocking.
    """
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    # 1 â€” agent runtime native: respects whatever model/provider the user configured
    try:
        from agent.auxiliary_client import call_llm
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: call_llm(
                task="meeting",
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            ),
        )
        return resp.choices[0].message.content or ""
    except Exception:
        pass

    # 2 - direct SDK fallback (standalone / container mode).
    # Operators provide the module and async client class for their chosen LLM SDK.
    primary_key = os.getenv("PRIMARY_LLM_API_KEY", "")
    module_name = os.getenv("PRIMARY_LLM_SDK_MODULE", "")
    client_name = os.getenv("PRIMARY_LLM_SDK_CLIENT", "")
    if primary_key and module_name and client_name:
        import importlib
        try:
            module = importlib.import_module(module_name)
            AsyncPrimaryClient = getattr(module, client_name)
        except (ImportError, AttributeError) as exc:
            raise RuntimeError("configured primary LLM SDK is not available") from exc
        client = AsyncPrimaryClient(api_key=primary_key)
        msg = await client.messages.create(
            model=os.getenv("COUNCIL_PRIMARY_MODEL", "primary-meeting-model"),
            system=system,
            messages=[{"role": "user", "content": user}],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return msg.content[0].text if msg.content else ""

    raise RuntimeError(
        "No LLM provider available for meeting-room intervention judge. "
        "Set PRIMARY_LLM_API_KEY plus PRIMARY_LLM_SDK_MODULE/PRIMARY_LLM_SDK_CLIENT, "
        "or configure the platform LLM router."
    )

