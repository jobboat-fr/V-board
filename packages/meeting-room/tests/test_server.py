"""
Unit tests — adapters/meeting_room/server.py
No API keys required.  External calls (STT, TTS, intervention, council) are mocked.
"""

import base64
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_rooms(tmp_path, monkeypatch):
    """Wipe both the active-room registry AND the transcript buffers between tests."""
    monkeypatch.setenv("AZZCO_DATA_ROOT", str(tmp_path))
    from adapters.meeting_room import escalation, evidence_store, room_registry, short_term_memory as stm
    room_registry.active_rooms.clear()
    stm._rooms.clear()
    escalation.clear()
    evidence_store._ROOM_DIRS.clear()
    yield
    room_registry.active_rooms.clear()
    stm._rooms.clear()
    escalation.clear()
    evidence_store._ROOM_DIRS.clear()


@pytest.fixture()
def client():
    """TestClient in dev-mode (no token required)."""
    from adapters.meeting_room import server as srv
    original = srv.API_TOKEN
    srv.API_TOKEN = ""           # open / dev mode
    with TestClient(srv.app) as c:
        yield c
    srv.API_TOKEN = original


@pytest.fixture()
def secured_client():
    """TestClient with API_TOKEN = 'test-secret'."""
    from adapters.meeting_room import server as srv
    original = srv.API_TOKEN
    srv.API_TOKEN = "test-secret"
    with TestClient(srv.app) as c:
        yield c
    srv.API_TOKEN = original


# ── Probes ────────────────────────────────────────────────────────────────────

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["service"] == "hermes-meeting-room"
    assert data["version"] == "1.0.0"


def test_ready_returns_all_fields(client):
    r = client.get("/ready")
    assert r.status_code == 200
    data = r.json()
    for field in (
        "ok", "production_mode", "auth_required", "token_configured", "stt_configured", "tts_configured",
        "tavus_configured", "evidence_root",
        "anthropic_configured", "openai_configured", "google_configured",
        "livekit_configured", "livekit_agent", "active_rooms",
    ):
        assert field in data, f"Missing field: {field}"


def test_ready_active_rooms_count(client):
    from adapters.meeting_room import server as srv
    srv._active_rooms["room-x"] = {"room_id": "room-x"}
    r = client.get("/ready")
    assert r.json()["active_rooms"] == 1


# ── Advisors (public — no auth required) ─────────────────────────────────────

def test_advisors_list_no_auth(client):
    r = client.get("/advisors")
    assert r.status_code == 200
    data = r.json()
    assert "advisors" in data
    assert len(data["advisors"]) >= 4  # 4 core + optional legal/product


def test_advisors_no_triggers_exposed(client):
    """triggers is internal — must not appear in the public listing."""
    r = client.get("/advisors")
    for adv in r.json()["advisors"]:
        assert "triggers" not in adv, f"triggers leaked for advisor {adv.get('id')}"


def test_advisors_correct_ids(client):
    r = client.get("/advisors")
    ids = {a["id"] for a in r.json()["advisors"]}
    assert {"cfo", "cto", "coo", "crm"}.issubset(ids)  # core 4 always present


def test_advisors_have_required_fields(client):
    r = client.get("/advisors")
    for adv in r.json()["advisors"]:
        for field in ("id", "name", "specialty", "color", "voice_id"):
            assert field in adv, f"Advisor {adv.get('id')} missing public field {field}"


# ── Auth ──────────────────────────────────────────────────────────────────────

def test_secured_rejects_missing_token(secured_client):
    r = secured_client.get("/meeting/status")
    assert r.status_code == 401


def test_secured_rejects_wrong_token(secured_client):
    r = secured_client.get(
        "/meeting/status", headers={"Authorization": "Bearer wrong-token"}
    )
    assert r.status_code == 401


def test_secured_accepts_correct_token(secured_client):
    r = secured_client.get(
        "/meeting/status", headers={"Authorization": "Bearer test-secret"}
    )
    assert r.status_code == 200


def test_dev_mode_no_token_needed(client):
    r = client.get("/meeting/status")
    assert r.status_code == 200


def test_production_requires_token_even_if_missing_env():
    from adapters.meeting_room import server as srv
    original = srv.API_TOKEN
    srv.API_TOKEN = ""
    try:
        with patch.dict(os.environ, {"MEETING_ROOM_REQUIRE_TOKEN": "true"}):
            with TestClient(srv.app) as c:
                r = c.get("/meeting/status")
        assert r.status_code == 503
        assert r.json()["detail"] == "MEETING_ROOM_API_TOKEN_REQUIRED"
    finally:
        srv.API_TOKEN = original


# ── Meeting status ────────────────────────────────────────────────────────────

def test_status_empty(client):
    r = client.get("/meeting/status")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["active_rooms"] == 0
    assert data["rooms"] == []


# ── Meeting join ──────────────────────────────────────────────────────────────

def test_join_success(client):
    r = client.post("/meeting/join", json={"room_id": "room-1", "advisor_id": "cfo"})
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["room_id"] == "room-1"
    assert data["advisor_id"] == "cfo"
    assert data["advisor_name"] == "CFO"


def test_join_registers_in_status(client):
    client.post("/meeting/join", json={"room_id": "room-1", "advisor_id": "cto"})
    data = client.get("/meeting/status").json()
    assert data["active_rooms"] == 1
    assert data["rooms"][0]["room_id"] == "room-1"
    assert data["rooms"][0]["advisor_id"] == "cto"


def test_join_unknown_advisor_returns_400(client):
    r = client.post("/meeting/join", json={"room_id": "room-1", "advisor_id": "ghost"})
    assert r.status_code == 400
    assert "ghost" in r.json()["detail"]


def test_join_default_advisor_is_cfo(client):
    r = client.post("/meeting/join", json={"room_id": "room-2"})
    assert r.json()["advisor_id"] == "cfo"


def test_join_all_four_advisors(client):
    for advisor_id in ("cfo", "cto", "coo", "crm"):
        r = client.post("/meeting/join", json={
            "room_id": f"room-{advisor_id}", "advisor_id": advisor_id
        })
        assert r.status_code == 200, f"join failed for {advisor_id}"


def test_join_livekit_control_plane(client):
    """Phase 2 returns truthful worker status, not a fake media join."""
    r = client.post("/meeting/join", json={
        "room_id": "room-lk",
        "advisor_id": "cto",
        "livekit_token": "fake-livekit-token",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["livekit"] is not None
    assert data["livekit"]["status"] in {"control_plane_ready", "media_worker_ready"}
    assert data["livekit"]["phase"] == 2


def test_join_topic_stored(client):
    client.post("/meeting/join", json={
        "room_id": "room-1",
        "advisor_id": "cfo",
        "topic": "Q4 budget review",
    })
    rooms = client.get("/meeting/status").json()["rooms"]
    assert rooms[0]["topic"] == "Q4 budget review"


# ── Meeting leave ─────────────────────────────────────────────────────────────

def test_leave_removes_room(client):
    client.post("/meeting/join", json={"room_id": "room-1", "advisor_id": "cfo"})
    r = client.post("/meeting/leave", json={"room_id": "room-1"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert client.get("/meeting/status").json()["active_rooms"] == 0


def test_leave_reports_flushed_count(client):
    client.post("/meeting/join", json={"room_id": "room-1", "advisor_id": "cfo"})
    for text in ("First utterance", "Second utterance", "Third utterance"):
        client.post("/meeting/transcript", json={
            "room_id": "room-1", "text": text, "speaker_name": "Alice"
        })
    r = client.post("/meeting/leave", json={"room_id": "room-1"})
    assert r.json()["flushed_count"] == 3


def test_leave_nonexistent_room_is_safe(client):
    r = client.post("/meeting/leave", json={"room_id": "ghost-room"})
    assert r.status_code == 200
    assert r.json()["flushed_count"] == 0


def test_leave_clears_transcript(client):
    """After leave, the room transcript must be gone."""
    client.post("/meeting/join", json={"room_id": "room-1", "advisor_id": "cfo"})
    client.post("/meeting/transcript", json={
        "room_id": "room-1", "text": "Hello", "speaker_name": "A"
    })
    client.post("/meeting/leave", json={"room_id": "room-1"})
    # Re-join and push a new transcript — size must be 1, not 2
    client.post("/meeting/join", json={"room_id": "room-1", "advisor_id": "cfo"})
    r = client.post("/meeting/transcript", json={
        "room_id": "room-1", "text": "Fresh start", "speaker_name": "B"
    })
    assert r.json()["transcript_size"] == 1


# ── Transcript ────────────────────────────────────────────────────────────────

def test_transcript_push_returns_201(client):
    r = client.post("/meeting/transcript", json={
        "room_id": "room-1", "text": "We need to cut costs", "speaker_name": "Alice"
    })
    assert r.status_code == 201


def test_transcript_returns_utterance(client):
    r = client.post("/meeting/transcript", json={
        "room_id": "room-1", "text": "Deploy to prod", "speaker_name": "Bob"
    })
    u = r.json()["utterance"]
    assert u["text"] == "Deploy to prod"
    assert u["speaker_name"] == "Bob"
    assert u["kind"] == "human"
    assert u["id"].startswith("u-")


def test_transcript_increments_size(client):
    for i in range(3):
        client.post("/meeting/transcript", json={
            "room_id": "room-1", "text": f"msg {i}", "speaker_name": "A"
        })
    r = client.post("/meeting/transcript", json={
        "room_id": "room-1", "text": "msg 3", "speaker_name": "A"
    })
    assert r.json()["transcript_size"] == 4


def test_transcript_ai_kind(client):
    r = client.post("/meeting/transcript", json={
        "room_id": "room-1", "text": "Watch the cash burn", "speaker_name": "CFO", "kind": "ai"
    })
    assert r.json()["utterance"]["kind"] == "ai"


def test_transcript_speaker_id_auto_assigned(client):
    r = client.post("/meeting/transcript", json={
        "room_id": "room-1", "text": "Hello", "speaker_name": "Alice"
    })
    # speaker_id defaults to "human-Alice" when not provided
    u = r.json()["utterance"]
    assert u["speaker_id"] == "human-Alice"


def test_transcript_explicit_speaker_id(client):
    r = client.post("/meeting/transcript", json={
        "room_id": "room-1", "text": "Hello", "speaker_name": "Alice", "speaker_id": "alice-uid-42"
    })
    assert r.json()["utterance"]["speaker_id"] == "alice-uid-42"


# ── STT ───────────────────────────────────────────────────────────────────────

def test_transcript_extracts_commitment(client):
    r = client.post("/meeting/transcript", json={
        "room_id": "room-commit",
        "text": "I will send the revised contract.",
        "speaker_name": "Alice",
    })
    data = r.json()
    assert len(data["commitments"]) == 1
    assert data["commitments"][0]["speaker_name"] == "Alice"


def test_preflight_endpoint_persists_legal_gate(client):
    r = client.post("/meeting/preflight", json={
        "room_id": "room-preflight",
        "topic": "Vendor contract review",
        "active_advisors": ["legal", "cfo"],
        "policy": {"owner_scope": "host_approval"},
    })
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["preflight"]["requires_legal_review"] is True
    assert "manifest.json" in data["evidence"]["manifest"]


def test_join_can_create_tavus_avatar(client):
    avatar = {
        "ok": True,
        "provider": "tavus",
        "pipeline_mode": "echo",
        "room_id": "room-avatar",
        "advisor_id": "cfo",
        "persona_id": "p-1",
        "conversation_id": "c-1",
        "conversation_url": "https://example.test/c-1",
        "meeting_token": "secret-token",
    }
    with patch("adapters.meeting_room.tavus.create_conversation",
               new=AsyncMock(return_value=avatar)):
        r = client.post("/meeting/join", json={
            "room_id": "room-avatar",
            "advisor_id": "cfo",
            "avatar": {"provider": "tavus", "tavus_api_key": "tvk-user"},
        })
    assert r.status_code == 200
    data = r.json()
    assert data["avatar"]["conversation_id"] == "c-1"
    assert "meeting_token" not in client.get("/meeting/status").json()["rooms"][0]["avatar"]


def test_tavus_avatar_endpoint(client):
    avatar = {
        "ok": True,
        "provider": "tavus",
        "room_id": "room-avatar-2",
        "advisor_id": "cto",
        "conversation_id": "c-2",
        "conversation_url": "https://example.test/c-2",
    }
    with patch("adapters.meeting_room.tavus.create_conversation",
               new=AsyncMock(return_value=avatar)):
        r = client.post("/meeting/avatar/tavus", json={
            "room_id": "room-avatar-2",
            "advisor_id": "cto",
            "tavus_api_key": "tvk-user",
        })
    assert r.status_code == 200
    assert r.json()["conversation_id"] == "c-2"


def test_tavus_echo_endpoint(client):
    r = client.post("/meeting/avatar/tavus/echo", json={
        "room_id": "room-avatar-3",
        "conversation_id": "c-3",
        "text": "Here is the CTO view.",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["payload"]["event_type"] == "conversation.echo"
    assert data["payload"]["properties"]["text"] == "Here is the CTO view."


def test_stt_unavailable_without_groq_key(client):
    with patch("adapters.meeting_room.stt.is_configured", return_value=False):
        r = client.post("/meeting/stt", json={
            "room_id": "room-1",
            "audio_base64": base64.b64encode(b"x" * 2000).decode(),
            "speaker_name": "Alice",
        })
    assert r.status_code == 503
    assert "GROQ_API_KEY" in r.json()["detail"]


def test_stt_invalid_base64_returns_400(client):
    with patch("adapters.meeting_room.stt.is_configured", return_value=True):
        r = client.post("/meeting/stt", json={
            "room_id": "room-1",
            "audio_base64": "!!! not valid base64 !!!",
            "speaker_name": "Alice",
        })
    assert r.status_code == 400
    assert "invalid_audio_base64" in r.json()["detail"]


def test_stt_audio_too_small_returns_400(client):
    with patch("adapters.meeting_room.stt.is_configured", return_value=True):
        r = client.post("/meeting/stt", json={
            "room_id": "room-1",
            "audio_base64": base64.b64encode(b"tiny").decode(),
            "speaker_name": "Alice",
        })
    assert r.status_code == 400
    assert "audio_too_small" in r.json()["detail"]


def test_stt_empty_transcript(client):
    empty_result = {
        "text": "", "duration_s": 0.4, "cost_usd": 0.0,
        "model": "whisper-large-v3-turbo", "empty": True,
    }
    with patch("adapters.meeting_room.stt.is_configured", return_value=True), \
         patch("adapters.meeting_room.stt.transcribe", new=AsyncMock(return_value=empty_result)):
        r = client.post("/meeting/stt", json={
            "room_id": "room-1",
            "audio_base64": base64.b64encode(b"x" * 2000).decode(),
            "speaker_name": "Alice",
        })
    assert r.status_code == 201
    data = r.json()
    assert data["ok"] is True
    assert data["empty"] is True
    assert data["utterance"] is None
    assert data["transcript"] == ""


def test_stt_success_appends_utterance(client):
    stt_result = {
        "text": "The budget is too high.",
        "duration_s": 2.8, "cost_usd": 0.000086,
        "model": "whisper-large-v3-turbo", "empty": False,
    }
    with patch("adapters.meeting_room.stt.is_configured", return_value=True), \
         patch("adapters.meeting_room.stt.transcribe", new=AsyncMock(return_value=stt_result)):
        r = client.post("/meeting/stt", json={
            "room_id": "room-1",
            "audio_base64": base64.b64encode(b"x" * 2000).decode(),
            "speaker_name": "Alice",
        })
    assert r.status_code == 201
    data = r.json()
    assert data["transcript"] == "The budget is too high."
    assert data["utterance"]["speaker_name"] == "Alice"
    assert data["utterance"]["kind"] == "human"
    assert data["cost_usd"] == pytest.approx(0.000086)


def test_stt_success_increments_room_transcript(client):
    stt_result = {
        "text": "Cut the servers.", "duration_s": 1.5, "cost_usd": 0.00005,
        "model": "whisper-large-v3-turbo", "empty": False,
    }
    with patch("adapters.meeting_room.stt.is_configured", return_value=True), \
         patch("adapters.meeting_room.stt.transcribe", new=AsyncMock(return_value=stt_result)):
        client.post("/meeting/stt", json={
            "room_id": "room-stt",
            "audio_base64": base64.b64encode(b"x" * 2000).decode(),
            "speaker_name": "Bob",
        })

    from adapters.meeting_room import short_term_memory as stm
    assert stm.size("room-stt") == 1


# ── TTS ───────────────────────────────────────────────────────────────────────

def test_tts_unavailable_without_elevenlabs_key(client):
    with patch("adapters.meeting_room.tts.is_configured", return_value=False):
        r = client.post("/meeting/tts", json={
            "room_id": "room-1", "text": "Hello world", "advisor_id": "cfo"
        })
    assert r.status_code == 503
    assert "ELEVENLABS_API_KEY" in r.json()["detail"]


def test_tts_success_returns_audio_base64(client):
    fake_audio = b"\xff\xfb" + b"\x00" * 100
    tts_result = {
        "audio":     fake_audio,
        "mime_type": "audio/mpeg",
        "voice_id":  "JBFqnCBsd6RMkjVDRZzb",
        "chars":     11,
        "cost_usd":  0.0033,
        "ms":        320,
        "model":     "eleven_turbo_v2_5",
    }
    with patch("adapters.meeting_room.tts.is_configured", return_value=True), \
         patch("adapters.meeting_room.tts.synthesize", new=AsyncMock(return_value=tts_result)):
        r = client.post("/meeting/tts", json={
            "room_id": "room-1", "text": "Hello world", "advisor_id": "cfo"
        })
    assert r.status_code == 200
    data = r.json()
    assert "audio_base64" in data
    assert base64.b64decode(data["audio_base64"]) == fake_audio
    assert data["mime_type"] == "audio/mpeg"
    assert data["chars"] == 11
    assert data["model"] == "eleven_turbo_v2_5"


def test_tts_voice_id_in_response(client):
    tts_result = {
        "audio": b"\x00" * 50, "mime_type": "audio/mpeg",
        "voice_id": "AZnzlk1XvdvUeBnXmlld", "chars": 5,
        "cost_usd": 0.0015, "ms": 120, "model": "eleven_turbo_v2_5",
    }
    with patch("adapters.meeting_room.tts.is_configured", return_value=True), \
         patch("adapters.meeting_room.tts.synthesize", new=AsyncMock(return_value=tts_result)):
        r = client.post("/meeting/tts", json={
            "room_id": "room-1", "text": "Brief", "advisor_id": "coo"
        })
    assert r.json()["voice_id"] == "AZnzlk1XvdvUeBnXmlld"


# ── Intervention check ────────────────────────────────────────────────────────

def test_check_silence_guard(client):
    """Empty room → silence guard fires → speak=False."""
    silent = {
        "speak": False, "message": "", "urgency": 0,
        "reason": "silence_guard", "touched_advisors": [],
    }
    with patch("adapters.meeting_room.server.check_intervention",
               new=AsyncMock(return_value=silent)):
        r = client.post("/meeting/check", json={"room_id": "empty-room"})
    assert r.status_code == 200
    data = r.json()
    assert data["speak"] is False
    assert data["reason"] == "silence_guard"


def test_check_intervention_escalates_by_default(client):
    client.post("/meeting/join", json={"room_id": "room-1", "advisor_id": "cfo"})
    result = {
        "speak":           True,
        "message":         "Our burn rate needs immediate attention.",
        "urgency":         8,
        "reason":          "budget_alert",
        "touched_advisors": ["cfo"],
    }
    with patch("adapters.meeting_room.server.check_intervention",
               new=AsyncMock(return_value=result)):
        r = client.post("/meeting/check", json={
            "room_id": "room-1",
            "topic":   "Q4 planning",
            "active_advisors": ["cfo"],
        })
    assert r.status_code == 200
    data = r.json()
    assert data["speak"] is False
    assert data["escalation_required"] is True
    assert "burn rate" in data["proposed_message"]
    assert data["urgency"] == 8
    assert "cfo" in data["touched_advisors"]
    assert "escalation_id" in data


def test_check_intervention_allows_autonomous_low_risk_speech(client):
    client.post("/meeting/join", json={
        "room_id": "room-auto",
        "advisor_id": "cfo",
        "policy": {"owner_scope": "autonomous", "worker_can_decide_alone": True},
    })
    result = {
        "speak":           True,
        "message":         "One option is to defer noncritical spend for two weeks.",
        "urgency":         "normal",
        "reason":          "finance option",
        "touched_advisors": ["cfo"],
    }
    with patch("adapters.meeting_room.server.check_intervention",
               new=AsyncMock(return_value=result)):
        r = client.post("/meeting/check", json={
            "room_id": "room-auto",
            "topic":   "Q4 planning",
            "active_advisors": ["cfo"],
        })
    assert r.status_code == 200
    data = r.json()
    assert data["speak"] is True
    assert data["escalation_required"] is False
    assert data["gate"]["action"] == "allow"


def test_check_uses_room_topic_when_not_provided(client):
    """Topic not in body — server should pull from registered room."""
    client.post("/meeting/join", json={
        "room_id": "room-1", "advisor_id": "cfo", "topic": "product roadmap"
    })
    captured = {}

    async def fake_check(ctx):
        captured.update(ctx)
        return {"speak": False, "message": "", "urgency": 0, "reason": "ok", "touched_advisors": []}

    with patch("adapters.meeting_room.server.check_intervention", new=fake_check):
        client.post("/meeting/check", json={"room_id": "room-1"})

    assert captured.get("topic") == "product roadmap"


# ── Council analyze ───────────────────────────────────────────────────────────

def test_escalation_approval_resumes_with_context(client):
    client.post("/meeting/join", json={"room_id": "room-gate", "advisor_id": "legal"})
    client.post("/meeting/transcript", json={
        "room_id": "room-gate",
        "text": "The vendor liability clause changed.",
        "speaker_name": "Alice",
    })
    result = {
        "speak": True,
        "message": "Pause signature until legal reviews the liability clause.",
        "urgency": "high",
        "reason": "legal risk",
        "touched_advisors": ["legal"],
    }
    with patch("adapters.meeting_room.server.check_intervention",
               new=AsyncMock(return_value=result)):
        gated = client.post("/meeting/check", json={"room_id": "room-gate"}).json()

    pending = client.get("/meeting/escalations/room-gate").json()["escalations"]
    assert len(pending) == 1

    resumed = client.post("/meeting/escalation/respond", json={
        "room_id": "room-gate",
        "escalation_id": gated["escalation_id"],
        "approved": True,
        "approver": "host",
    }).json()
    assert resumed["speak"] is True
    assert resumed["utterance"]["kind"] == "ai"


def test_council_analyze_returns_verdict(client):
    mock_record = {
        "verdict": {
            "final_output":     "Cash flow looks concerning. Cut discretionary spend by 15%.",
            "consensus_score":  0.87,
            "consensus_reached": True,
        },
        "totals":  {"input_tokens": 1200, "output_tokens": 80, "cost_usd": 0.0042},
        "run_id":  "test-run-abc",
    }
    mock_collective = MagicMock()
    mock_collective.orchestrate = AsyncMock(return_value=mock_record)

    with patch("adapters.meeting_room.council.collective.AIWorkerCollective",
               return_value=mock_collective):
        r = client.post("/council/analyze", json={
            "room_id":    "room-1",
            "advisor_id": "cfo",
            "topic":      "Q4 financial review",
            "question":   "What is your take on the current burn rate?",
        })
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["verdict"]["consensus_reached"] is True
    assert data["run_id"] == "test-run-abc"
    assert "totals" in data


def test_council_analyze_appends_ai_utterance(client):
    """The council's final output should be stored in the room transcript."""
    mock_record = {
        "verdict": {"final_output": "Reduce headcount by 10%.", "consensus_reached": True},
        "totals":  {},
        "run_id":  "r-42",
    }
    mock_collective = MagicMock()
    mock_collective.orchestrate = AsyncMock(return_value=mock_record)

    with patch("adapters.meeting_room.council.collective.AIWorkerCollective",
               return_value=mock_collective):
        client.post("/council/analyze", json={
            "room_id":    "room-council",
            "advisor_id": "cfo",
            "question":   "Cut costs?",
        })

    from adapters.meeting_room import short_term_memory as stm
    window = stm.recent("room-council", 10)
    assert len(window) == 1
    assert window[0]["kind"] == "ai"
    assert window[0]["speaker_name"] == "CFO"
    assert "Reduce headcount" in window[0]["text"]


def test_council_analyze_unknown_advisor_falls_back_gracefully(client):
    """Unknown advisor_id should not crash — falls back to generic name."""
    mock_record = {
        "verdict": {"final_output": "General advice.", "consensus_reached": True},
        "totals":  {},
        "run_id":  "r-99",
    }
    mock_collective = MagicMock()
    mock_collective.orchestrate = AsyncMock(return_value=mock_record)

    with patch("adapters.meeting_room.council.collective.AIWorkerCollective",
               return_value=mock_collective):
        r = client.post("/council/analyze", json={
            "room_id":    "room-1",
            "advisor_id": "nonexistent",
            "question":   "Any thoughts?",
        })
    assert r.status_code == 200   # must not crash with 500


# ── Full room lifecycle (integration-style, all mocked) ──────────────────────

def test_full_lifecycle_join_transcript_check_leave(client):
    """
    Happy path: join → push 3 utterances → check → leave.
    Asserts state at each step.
    """
    # 1. Join
    r = client.post("/meeting/join", json={
        "room_id": "e2e-room",
        "advisor_id": "cto",
        "policy": {"owner_scope": "autonomous", "worker_can_decide_alone": True},
    })
    assert r.json()["ok"] is True

    # 2. Push 3 utterances
    for text in ("Server is down", "Need a hotfix", "Deploy candidate ready"):
        client.post("/meeting/transcript", json={
            "room_id": "e2e-room", "text": text, "speaker_name": "DevOps"
        })

    # 3. Verify transcript size
    status = client.get("/meeting/status").json()
    assert status["rooms"][0]["transcript_size"] == 3

    # 4. Intervention check (mocked)
    advice = {
        "speak": True, "message": "Rollback first, fix forward after.",
        "urgency": "normal", "reason": "release_option", "touched_advisors": ["cto"],
    }
    with patch("adapters.meeting_room.server.check_intervention",
               new=AsyncMock(return_value=advice)):
        r = client.post("/meeting/check", json={
            "room_id": "e2e-room",
            "active_advisors": ["cto"],
        })
    assert r.json()["speak"] is True
    assert r.json()["urgency"] == "normal"

    # 5. Leave
    r = client.post("/meeting/leave", json={"room_id": "e2e-room"})
    assert r.json()["flushed_count"] == 3
    assert client.get("/meeting/status").json()["active_rooms"] == 0
