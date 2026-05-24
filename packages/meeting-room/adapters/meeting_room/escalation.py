"""Async escalation gates for meeting-room interventions."""

from __future__ import annotations

import time
import uuid
from typing import Any

from . import evidence_store

_ESCALATIONS: dict[str, dict[str, Any]] = {}


def create(room_id: str, proposed: dict[str, Any], gate: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    escalation_id = f"esc-{uuid.uuid4().hex[:12]}"
    record = {
        "id": escalation_id,
        "room_id": room_id,
        "status": "pending",
        "created_at": evidence_store.now_iso(),
        "created_unix": time.time(),
        "gate": gate,
        "proposed": proposed,
        "context": context or {},
    }
    _ESCALATIONS[escalation_id] = record
    evidence_store.log_escalation(room_id, record)
    return record


def get(escalation_id: str) -> dict[str, Any] | None:
    return _ESCALATIONS.get(escalation_id)


def list_for_room(room_id: str, *, include_resolved: bool = True) -> list[dict[str, Any]]:
    items = [item for item in _ESCALATIONS.values() if item.get("room_id") == room_id]
    if not include_resolved:
        items = [item for item in items if item.get("status") == "pending"]
    return sorted(items, key=lambda item: item.get("created_unix", 0))


def respond(escalation_id: str, *, approved: bool, approver: str = "host", note: str = "") -> dict[str, Any]:
    record = _ESCALATIONS.get(escalation_id)
    if not record:
        raise KeyError(escalation_id)

    record["status"] = "approved" if approved else "rejected"
    record["resolved_at"] = evidence_store.now_iso()
    record["approver"] = approver
    record["note"] = note
    evidence_store.log_escalation(record["room_id"], record)
    evidence_store.log_decision(record["room_id"], {
        "type": "escalation_response",
        "escalation_id": escalation_id,
        "approved": approved,
        "approver": approver,
        "note": note,
        "message": record.get("proposed", {}).get("message", ""),
    })
    return record


def clear() -> None:
    _ESCALATIONS.clear()
