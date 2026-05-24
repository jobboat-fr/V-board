#!/usr/bin/env python3
"""Run a no-key V-Board meeting-room demo.

The demo uses FastAPI's in-process TestClient, so it does not need a running
server or real provider keys. It exercises the same HTTP handlers used by the
service: join, transcript, intervention check, escalation, approval, and status.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

# Keep the demo self-contained and safe to run repeatedly.
DEMO_DATA_ROOT = Path(tempfile.mkdtemp(prefix="vboard-meeting-demo-"))
os.environ["VBOARD_DATA_ROOT"] = str(DEMO_DATA_ROOT)
os.environ["MEETING_ROOM_REQUIRE_TOKEN"] = "false"

from fastapi.testclient import TestClient  # noqa: E402
from adapters.meeting_room import escalation, evidence_store, room_registry, short_term_memory as stm  # noqa: E402
from adapters.meeting_room import server as srv  # noqa: E402


async def fake_intervention(ctx: dict) -> dict:
    """Deterministic demo intervention: useful, risky, and approval-gated."""
    return {
        "speak": True,
        "message": "Pause signature until Legal confirms the liability clause.",
        "urgency": "high",
        "reason": "The transcript contains a commitment attached to legal risk.",
        "touched_advisors": ["legal", "cfo"],
    }


def reset_state() -> None:
    room_registry.active_rooms.clear()
    stm._rooms.clear()
    escalation.clear()
    evidence_store._ROOM_DIRS.clear()
    srv.API_TOKEN = ""
    srv.check_intervention = fake_intervention


def post(client: TestClient, path: str, payload: dict) -> dict:
    response = client.post(path, json=payload)
    response.raise_for_status()
    return response.json()


def get(client: TestClient, path: str) -> dict:
    response = client.get(path)
    response.raise_for_status()
    return response.json()


def main() -> int:
    reset_state()
    room_id = "demo-board-meeting"

    with TestClient(srv.app) as client:
        join = post(client, "/meeting/join", {
            "room_id": room_id,
            "advisor_id": "cfo",
            "topic": "Vendor contract and launch budget approval",
            "active_advisors": ["cfo", "legal", "cto"],
            "policy": {
                "owner_scope": "host_approval",
                "worker_can_decide_alone": False,
                "gate_high_urgency": True,
                "gate_legal": True,
            },
        })

        post(client, "/meeting/transcript", {
            "room_id": room_id,
            "speaker_name": "Founder",
            "text": "I will send the revised contract today if the liability clause is acceptable.",
        })
        post(client, "/meeting/transcript", {
            "room_id": room_id,
            "speaker_name": "Operations",
            "text": "The launch budget is tight, but the vendor wants signature before Friday.",
        })

        check = post(client, "/meeting/check", {"room_id": room_id})
        pending = get(client, f"/meeting/escalations/{room_id}")

        approved = None
        if check.get("escalation_required"):
            approved = post(client, "/meeting/escalation/respond", {
                "room_id": room_id,
                "escalation_id": check["escalation_id"],
                "approved": True,
                "approver": "host",
                "note": "Approved for demo.",
            })

        status = get(client, "/meeting/status")
        paths = evidence_store.record_paths(room_id)

    summary = {
        "ok": True,
        "tagline": "Your entire ops team, automated.",
        "room_id": room_id,
        "advisor": join["advisor_name"],
        "preflight": join["preflight"],
        "intervention": {
            "speak": check.get("speak"),
            "escalation_required": check.get("escalation_required"),
            "proposed_message": check.get("proposed_message") or check.get("message"),
            "gate": check.get("gate"),
        },
        "pending_escalations_before_approval": len(pending.get("escalations", [])),
        "approved_message": approved.get("message") if approved else None,
        "active_rooms": status["active_rooms"],
        "evidence_root": paths["root"],
        "evidence_files": {
            "manifest": paths["manifest"],
            "transcript": paths["transcript"],
            "decisions": paths["decisions"],
            "commitments": paths["commitments"],
            "escalations": paths["escalations"],
        },
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())