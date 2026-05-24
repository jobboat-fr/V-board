"""Meeting authority and escalation policy.

This is the concrete form of the pre-flight and async gate diagram:
before a meeting starts, the owner decides how much authority workers have.
During the meeting, each proposed intervention is either allowed immediately
or paused for host approval with all context preserved.
"""

from __future__ import annotations

from typing import Any

DEFAULT_ACTIVE_ADVISORS = ["cfo", "cto", "coo", "crm"]
DEFAULT_POLICY: dict[str, Any] = {
    "owner_scope": "host_approval",  # autonomous | host_approval | observe_only
    "worker_can_decide_alone": False,
    "requires_legal_review": False,
    "gate_high_urgency": True,
    "gate_legal": True,
    "token_budget_usd": 1.0,
    "response_sla_ms": 2000,
    "approval_contact": "host",
}


def normalize_policy(raw: dict[str, Any] | None = None) -> dict[str, Any]:
    policy = dict(DEFAULT_POLICY)
    if raw:
        for key, value in raw.items():
            if value is not None:
                policy[key] = value

    owner_scope = str(policy.get("owner_scope", "host_approval")).lower()
    if owner_scope not in {"autonomous", "host_approval", "observe_only"}:
        owner_scope = "host_approval"
    policy["owner_scope"] = owner_scope

    policy["worker_can_decide_alone"] = bool(policy.get("worker_can_decide_alone"))
    policy["requires_legal_review"] = bool(policy.get("requires_legal_review"))
    policy["gate_high_urgency"] = bool(policy.get("gate_high_urgency", True))
    policy["gate_legal"] = bool(policy.get("gate_legal", True))

    try:
        policy["token_budget_usd"] = max(0.0, float(policy.get("token_budget_usd", 1.0)))
    except (TypeError, ValueError):
        policy["token_budget_usd"] = DEFAULT_POLICY["token_budget_usd"]

    try:
        policy["response_sla_ms"] = max(250, int(policy.get("response_sla_ms", 2000)))
    except (TypeError, ValueError):
        policy["response_sla_ms"] = DEFAULT_POLICY["response_sla_ms"]

    return policy


def preflight(room_id: str, topic: str, active_advisors: list[str] | None, raw_policy: dict[str, Any] | None) -> dict[str, Any]:
    policy = normalize_policy(raw_policy)
    advisors = active_advisors or DEFAULT_ACTIVE_ADVISORS
    legal_keywords = ("contract", "legal", "liability", "compliance", "gdpr", "rgpd", "nda", "terms")
    if topic and any(word in topic.lower() for word in legal_keywords):
        policy["requires_legal_review"] = True

    return {
        "room_id": room_id,
        "owner_scope": policy["owner_scope"],
        "worker_can_decide_alone": policy["worker_can_decide_alone"],
        "requires_legal_review": policy["requires_legal_review"],
        "active_advisors": advisors,
        "token_budget_usd": policy["token_budget_usd"],
        "response_sla_ms": policy["response_sla_ms"],
        "approval_contact": policy["approval_contact"],
        "policy": policy,
    }


def urgency_rank(value: Any) -> int:
    if isinstance(value, (int, float)):
        if value >= 8:
            return 3
        if value >= 4:
            return 2
        return 1
    text = str(value or "normal").lower()
    return {"low": 1, "normal": 2, "medium": 2, "high": 3, "critical": 3}.get(text, 2)


def gate_intervention(result: dict[str, Any], room: dict[str, Any]) -> dict[str, Any]:
    """Return a gate decision for a proposed intervention."""
    policy = normalize_policy(room.get("policy"))
    if not result.get("speak"):
        return {"action": "silent", "reason": result.get("reason", "no_speech")}

    touched = [str(item).lower() for item in result.get("touched_advisors", [])]
    urgency = urgency_rank(result.get("urgency", "normal"))
    reasons: list[str] = []

    if policy["owner_scope"] == "observe_only":
        reasons.append("observe_only")
    if policy["owner_scope"] == "host_approval" and not policy["worker_can_decide_alone"]:
        reasons.append("host_approval_required")
    if policy["requires_legal_review"]:
        reasons.append("preflight_legal_review_required")
    if policy["gate_legal"] and "legal" in touched:
        reasons.append("legal_advisor_touched")
    if policy["gate_high_urgency"] and urgency >= 3:
        reasons.append("high_urgency")

    if reasons:
        return {
            "action": "escalate",
            "reason": ",".join(reasons),
            "approval_contact": policy["approval_contact"],
        }

    return {"action": "allow", "reason": "within_worker_authority"}
