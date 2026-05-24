"""
Meeting Room HTTP Server
========================
FastAPI server that exposes the meeting-room adapter over HTTP.

Endpoints:
  POST /meeting/join           Join a room as an AI advisor
  POST /meeting/leave          Disconnect + flush memory
  POST /meeting/transcript     Push a transcript utterance (text mode fallback)
  POST /meeting/check          Run intervention check
  POST /council/analyze        Run full council analysis (CFO/CTO/COO/CRM)
  GET  /meeting/status         List active rooms and advisor states
  GET  /health                 Liveness probe
  GET  /ready                  Readiness probe (checks provider keys)

Authentication: Bearer token via MEETING_ROOM_API_TOKEN env var.
If MEETING_ROOM_API_TOKEN is not set, the server runs open only in explicit
local development mode. Production refuses protected requests without a token.

Usage:
  python -m adapters.meeting_room.server
  uvicorn adapters.meeting_room.server:app --host 0.0.0.0 --port 8790
"""

import os
import logging
import base64
import hmac
from typing import Any

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import escalation, evidence_store, policy as meeting_policy, security as meeting_security, short_term_memory as stm, tavus
from .intervention import check_intervention
from .council.advisors import ADVISORS, get_advisor
from .room_registry import active_rooms as _active_rooms  # shared with native tool

logger = logging.getLogger("meeting_room.server")

API_TOKEN = os.getenv("MEETING_ROOM_API_TOKEN", "")
HOST      = os.getenv("MEETING_ROOM_HOST", "127.0.0.1")
PORT      = int(os.getenv("MEETING_ROOM_PORT", "8790"))
PROD_ENV_VALUES = {"production", "prod", "railway", "render", "fly", "vercel"}


def is_production_mode() -> bool:
    """Return True when protected endpoints must never run tokenless."""
    explicit = os.getenv("MEETING_ROOM_REQUIRE_TOKEN", "").lower()
    if explicit in {"1", "true", "yes", "on"}:
        return True
    if explicit in {"0", "false", "no", "off"}:
        return False
    env_values = [
        os.getenv("ENVIRONMENT", ""),
        os.getenv("APP_ENV", ""),
        os.getenv("NODE_ENV", ""),
        os.getenv("HERMES_ENV", ""),
        os.getenv("RAILWAY_ENVIRONMENT_NAME", ""),
    ]
    return any(value.lower() in PROD_ENV_VALUES for value in env_values if value)


app = FastAPI(
    title="Hermes Meeting Room",
    description="AI advisor that joins live meetings as a voice participant (CFO/CTO/COO/CRM).",
    version="1.0.0",
    docs_url=None if is_production_mode() else "/docs",
    redoc_url=None if is_production_mode() else "/redoc",
    openapi_url=None if is_production_mode() else "/openapi.json",
)

security = HTTPBearer(auto_error=False)


# ─── Auth ─────────────────────────────────────────────────────────────────────

def verify_token(credentials: HTTPAuthorizationCredentials | None = Depends(security)):
    if not API_TOKEN:
        if is_production_mode():
            raise HTTPException(status_code=503, detail="MEETING_ROOM_API_TOKEN_REQUIRED")
        return "dev_open"
    if (
        credentials is None
        or credentials.scheme.lower() != "bearer"
        or not hmac.compare_digest(credentials.credentials, API_TOKEN)
    ):
        raise HTTPException(status_code=401, detail="INVALID_TOKEN")
    return credentials.credentials


@app.middleware("http")
async def meeting_room_security_headers(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > meeting_security.MAX_REQUEST_BYTES:
                return JSONResponse(status_code=413, content={"detail": "REQUEST_TOO_LARGE"})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "INVALID_CONTENT_LENGTH"})

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(meeting_security.MeetingValidationError)
async def meeting_validation_error_handler(request: Request, exc: meeting_security.MeetingValidationError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.code})


# ─── Request models ───────────────────────────────────────────────────────────

class JoinBody(BaseModel):
    room_id:           str
    advisor_id:        str                     = "cfo"
    topic:             str | None              = None
    livekit_token:     str | None              = None
    active_advisors:   list[str]               = Field(default_factory=lambda: ["cfo", "cto", "coo", "crm"])
    policy:            dict[str, Any] | None   = None
    avatar:            dict[str, Any] | None   = None


class LeaveBody(BaseModel):
    room_id:    str
    advisor_id: str | None = None


class TranscriptBody(BaseModel):
    room_id:      str
    text:         str
    speaker_name: str
    speaker_id:   str | None = None
    kind:         str        = "human"   # human | ai | system


class CheckBody(BaseModel):
    room_id:          str
    topic:            str | None       = None
    active_advisors:  list[str] | None = None
    long_term_memory: str | None       = None
    window_size:      int              = 20


class CouncilBody(BaseModel):
    """Full council analysis request — runs AIWorkerCollective."""
    room_id:     str
    advisor_id:  str        = "cfo"
    topic:       str | None = None
    question:    str        = ""          # specific question to analyze
    context:     str | None = None        # additional context
    transcript:  str | None = None        # override transcript (else uses room buffer)


class STTBody(BaseModel):
    room_id:      str
    audio_base64: str
    speaker_name: str
    speaker_id:   str | None  = None
    mime_type:    str | None  = None
    filename:     str         = "chunk.webm"
    language:     str | None  = None


class TTSBody(BaseModel):
    room_id:       str
    text:          str
    advisor_id:    str    = "cfo"
    voice_id:      str | None = None
    output_format: str    = "mp3_44100_128"


class PreflightBody(BaseModel):
    room_id:         str
    topic:           str | None             = None
    active_advisors: list[str] | None       = None
    policy:          dict[str, Any] | None  = None


class EscalationResponseBody(BaseModel):
    room_id:       str
    escalation_id: str
    approved:      bool
    approver:      str = "host"
    note:          str = ""


class TavusAvatarBody(BaseModel):
    room_id:                str
    advisor_id:             str = "cfo"
    tavus_api_key:          str | None = None
    replica_id:             str | None = None
    persona_id:             str | None = None
    pipeline_mode:          str = "echo"
    conversation_name:      str | None = None
    conversational_context: str = ""
    custom_greeting:        str | None = None
    test_mode:              bool = False
    require_auth:           bool = False
    max_participants:       int | None = None


class TavusEchoBody(BaseModel):
    room_id:         str
    conversation_id: str
    text:            str | None = None
    audio_base64:    str | None = None
    sample_rate:     int = 24000
    inference_id:    str | None = None


# ─── Probes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"ok": True, "service": "hermes-meeting-room", "version": "1.0.0"}


@app.get("/ready")
async def ready():
    from .stt import is_configured as stt_ok
    from .tts import is_configured as tts_ok
    from .livekit_agent import readiness as livekit_readiness
    livekit = livekit_readiness()
    return {
        "ok":                    True,
        "production_mode":       is_production_mode(),
        "auth_required":         bool(API_TOKEN) or is_production_mode(),
        "token_configured":      bool(API_TOKEN),
        "stt_configured":        stt_ok(),
        "tts_configured":        tts_ok(),
        "tavus_configured":      tavus.is_configured(),
        "anthropic_configured":  bool(os.getenv("ANTHROPIC_API_KEY")),
        "openai_configured":     bool(os.getenv("OPENAI_API_KEY")),
        "google_configured":     bool(os.getenv("GOOGLE_API_KEY")),
        "livekit_configured":    livekit["configured"],
        "livekit_agent":         livekit,
        "active_rooms":          len(_active_rooms),
        "evidence_root":         "[configured]" if is_production_mode() else str(evidence_store.data_root()),
    }


# ─── Meeting lifecycle ────────────────────────────────────────────────────────

@app.post("/meeting/join")
async def meeting_join(body: JoinBody, token: str = Depends(verify_token)):
    """
    Join a meeting room as an AI advisor.

    In Phase 1 (text-only): registers the room in the active registry.
    In Phase 2 (LiveKit): also connects as a real LiveKit participant.
    """
    room_id = meeting_security.checked_room_id(body.room_id)
    topic = meeting_security.checked_text(
        body.topic or "",
        field="topic",
        max_chars=meeting_security.MAX_CONTEXT_CHARS,
    )
    advisor = get_advisor(body.advisor_id)
    if not advisor:
        raise HTTPException(status_code=400, detail=f"Unknown advisor_id: {body.advisor_id}")

    preflight = meeting_policy.preflight(
        room_id,
        topic,
        body.active_advisors,
        body.policy,
    )
    _active_rooms[room_id] = {
        "room_id":        room_id,
        "advisor_id":     body.advisor_id,
        "advisor_name":   advisor["name"],
        "topic":          topic,
        "active_advisors": preflight["active_advisors"],
        "policy":         preflight["policy"],
        "preflight":      preflight,
        "status":         "joined",
        "livekit":        bool(body.livekit_token),
        "transcript_size": stm.size(room_id),
    }
    evidence_store.ensure_manifest(room_id, {
        "room_id": room_id,
        "topic": topic,
        "advisor_id": body.advisor_id,
        "advisor_name": advisor["name"],
        "active_advisors": preflight["active_advisors"],
        "preflight": preflight,
        "status": "joined",
    })

    # Phase 2: LiveKit presence (stub — returns 501 until livekit-agents is wired)
    livekit_result = None
    if body.livekit_token:
        body.room_id = room_id
        livekit_result = await _livekit_join(body)

    avatar_result = None
    if body.avatar and body.avatar.get("provider") == "tavus":
        avatar_cfg = body.avatar
        try:
            avatar_result = await tavus.create_conversation(
                room_id=room_id,
                advisor=advisor,
                api_key=avatar_cfg.get("tavus_api_key"),
                replica_id=avatar_cfg.get("replica_id"),
                persona_id=avatar_cfg.get("persona_id"),
                pipeline_mode=avatar_cfg.get("pipeline_mode", "echo"),
                conversation_name=avatar_cfg.get("conversation_name"),
                conversational_context=meeting_security.checked_text(
                    avatar_cfg.get("conversational_context", topic),
                    field="conversational_context",
                    max_chars=meeting_security.MAX_CONTEXT_CHARS,
                ),
                custom_greeting=avatar_cfg.get("custom_greeting"),
                test_mode=bool(avatar_cfg.get("test_mode", False)),
                require_auth=bool(avatar_cfg.get("require_auth", False)),
                max_participants=avatar_cfg.get("max_participants"),
            )
            _active_rooms[room_id]["avatar"] = {
                k: v for k, v in avatar_result.items() if k != "meeting_token"
            }
        except Exception as exc:
            avatar_result = {"ok": False, "provider": "tavus", "error": str(exc)}

    logger.info("room %s joined by advisor=%s", room_id, body.advisor_id)
    return {
        "ok":           True,
        "room_id":      room_id,
        "advisor_id":   body.advisor_id,
        "advisor_name": advisor["name"],
        "preflight":    preflight,
        "livekit":      livekit_result,
        "avatar":       avatar_result,
        "evidence":     evidence_store.record_paths(room_id),
    }


@app.post("/meeting/leave")
async def meeting_leave(body: LeaveBody, token: str = Depends(verify_token)):
    """Disconnect from a room and flush transcript to evidence chain."""
    room_id = meeting_security.checked_room_id(body.room_id)
    room = _active_rooms.pop(room_id, None)
    transcript = stm.recent(room_id, 200)
    stm.clear(room_id)
    evidence_store.ensure_manifest(room_id, {
        "status": "ended",
        "ended_at": evidence_store.now_iso(),
        "flushed_count": len(transcript),
    })
    logger.info("room %s left, flushed %d utterances", room_id, len(transcript))
    return {
        "ok":              True,
        "room_id":         room_id,
        "flushed_count":   len(transcript),
        "summary_available": False,  # Phase 6: post-meeting summary
        "evidence":        evidence_store.record_paths(room_id),
    }


# ─── Transcript ───────────────────────────────────────────────────────────────

@app.post("/meeting/transcript", status_code=201)
async def push_transcript(body: TranscriptBody, token: str = Depends(verify_token)):
    """Push a transcript utterance (text mode — no STT)."""
    room_id = meeting_security.checked_room_id(body.room_id)
    text = meeting_security.checked_text(
        body.text,
        field="transcript",
        max_chars=meeting_security.MAX_TRANSCRIPT_CHARS,
    )
    utterance = _append_utterance(room_id, {
        "text":         text,
        "speaker_name": body.speaker_name,
        "speaker_id":   body.speaker_id or f"human-{body.speaker_name}",
        "kind":         body.kind,
    })
    commitments = evidence_store.extract_commitments(room_id, utterance)
    if commitments:
        evidence_store.log_commitments(room_id, commitments)
    return {
        "utterance": utterance,
        "transcript_size": stm.size(room_id),
        "commitments": commitments,
    }


# ─── STT ──────────────────────────────────────────────────────────────────────

@app.post("/meeting/stt", status_code=201)
async def speech_to_text(body: STTBody, token: str = Depends(verify_token)):
    """Transcribe an audio chunk and append the result to the room transcript."""
    from .stt import transcribe, is_configured
    if not is_configured():
        raise HTTPException(status_code=503, detail="stt_unavailable: GROQ_API_KEY not set")

    room_id = meeting_security.checked_room_id(body.room_id)
    audio = meeting_security.decode_audio_base64(body.audio_base64)

    if len(audio) < 1024:
        raise HTTPException(status_code=400, detail="audio_too_small")

    result = await transcribe(
        audio,
        filename=body.filename,
        mime_type=body.mime_type,
        language=body.language,
    )

    if result["empty"]:
        return {"ok": True, "transcript": "", "utterance": None, "empty": True}

    utterance = _append_utterance(room_id, {
        "text":         result["text"],
        "speaker_name": body.speaker_name,
        "speaker_id":   body.speaker_id or f"human-{body.speaker_name}",
        "kind":         "human",
    })
    commitments = evidence_store.extract_commitments(room_id, utterance)
    if commitments:
        evidence_store.log_commitments(room_id, commitments)
    return {
        "ok":          True,
        "transcript":  result["text"],
        "duration_s":  result["duration_s"],
        "utterance":   utterance,
        "cost_usd":    result["cost_usd"],
        "commitments":  commitments,
    }


# ─── TTS ──────────────────────────────────────────────────────────────────────

@app.post("/meeting/tts")
async def text_to_speech(body: TTSBody, token: str = Depends(verify_token)):
    """Synthesize text to speech for an advisor."""
    from .tts import synthesize, is_configured
    if not is_configured():
        raise HTTPException(status_code=503, detail="tts_unavailable: ELEVENLABS_API_KEY not set")
    room_id = meeting_security.checked_room_id(body.room_id)
    text = meeting_security.checked_text(
        body.text,
        field="tts_text",
        max_chars=meeting_security.MAX_TTS_CHARS,
    )

    result = await synthesize(
        text,
        advisor_id=body.advisor_id,
        voice_id=body.voice_id,
        output_format=body.output_format,
    )
    audio_ref = evidence_store.write_audio(
        room_id,
        result["audio"],
        prefix=f"tts-{body.advisor_id}",
        suffix=".mp3" if result["mime_type"] == "audio/mpeg" else ".bin",
    )
    evidence_store.log_decision(room_id, {
        "type": "tts",
        "advisor_id": body.advisor_id,
        "text": text,
        "voice_id": result["voice_id"],
        "audio": audio_ref,
        "cost_usd": result["cost_usd"],
    })
    return {
        "audio_base64": base64.b64encode(result["audio"]).decode(),
        "mime_type":    result["mime_type"],
        "voice_id":     result["voice_id"],
        "chars":        result["chars"],
        "cost_usd":     result["cost_usd"],
        "ms":           result["ms"],
        "model":        result["model"],
        "audio":        audio_ref,
    }


# ─── Intervention check ───────────────────────────────────────────────────────

@app.post("/meeting/check")
async def intervention_check(body: CheckBody, token: str = Depends(verify_token)):
    """
    Ask the AI: should I speak right now?
    Returns { speak, message, urgency, reason, touched_advisors }.
    """
    room_id = meeting_security.checked_room_id(body.room_id)
    topic = meeting_security.checked_text(
        body.topic or "",
        field="topic",
        max_chars=meeting_security.MAX_CONTEXT_CHARS,
    )
    long_term_memory = meeting_security.checked_text(
        body.long_term_memory or "",
        field="long_term_memory",
        max_chars=meeting_security.MAX_CONTEXT_CHARS,
    )
    room = _active_rooms.get(room_id, {})
    result = await check_intervention({
        "room_id":         room_id,
        "topic":           topic or room.get("topic", ""),
        "active_advisors": body.active_advisors or room.get("active_advisors", ["cfo", "cto", "coo", "crm"]),
        "long_term_memory": long_term_memory,
        "window_size":     body.window_size,
    })
    gate = meeting_policy.gate_intervention(result, room)
    if gate["action"] == "escalate":
        escalation_record = escalation.create(
            room_id,
            proposed=result,
            gate=gate,
            context={
                "topic": topic or room.get("topic", ""),
                "recent": stm.recent(room_id, body.window_size),
            },
        )
        response = {
            **result,
            "speak": False,
            "escalation_required": True,
            "paused": True,
            "gate": gate,
            "escalation_id": escalation_record["id"],
            "proposed_message": result.get("message", ""),
            "resume_with_context": True,
        }
        evidence_store.log_decision(room_id, {"type": "intervention", "result": response})
        return response

    response = {**result, "escalation_required": False, "gate": gate}
    evidence_store.log_decision(room_id, {"type": "intervention", "result": response})
    return response


# ─── Council analysis ─────────────────────────────────────────────────────────

@app.post("/council/analyze")
async def council_analyze(body: CouncilBody, token: str = Depends(verify_token)):
    """
    Run the full 5-stage AIWorkerCollective council for a meeting scenario.

    This is the heavyweight endpoint — runs Primary + 2 Reviewers + Chairman (if needed).
    Use /meeting/check for the lightweight intervention-only path.
    """
    from .council.collective import AIWorkerCollective
    from .council.advisors import get_advisor

    room_id = meeting_security.checked_room_id(body.room_id)
    advisor = get_advisor(body.advisor_id) or {"name": body.advisor_id, "specialty": "General"}

    # Build the transcript from room buffer if not provided
    transcript = body.transcript
    if not transcript:
        window = stm.recent(room_id, 20)
        transcript = "\n".join(f"{u['speaker_name']}: {u['text']}" for u in window)
    transcript = meeting_security.checked_text(
        transcript,
        field="transcript",
        max_chars=meeting_security.MAX_CONTEXT_CHARS,
    )
    question = meeting_security.checked_text(
        body.question,
        field="question",
        max_chars=meeting_security.MAX_TRANSCRIPT_CHARS,
    )
    context = meeting_security.checked_text(
        body.context or "",
        field="context",
        max_chars=meeting_security.MAX_CONTEXT_CHARS,
    )

    system_prompt = _build_advisor_system(advisor, body.topic or "")
    user_prompt   = question or f"What is your {advisor['specialty']} perspective on the current discussion?"

    collective = AIWorkerCollective()
    record = await collective.orchestrate(
        task_type="meeting_support",
        scenario={
            "topic":                 body.topic or "",
            "transcript":            transcript,
            "advisor_id":            body.advisor_id,
            "primary_system_prompt": system_prompt,
            "primary_user_prompt":   user_prompt,
            "context":               context,
        },
    )

    # Append the council's final message to the room transcript
    final = record["verdict"].get("final_output", "")
    if final and room_id:
        utterance = _append_utterance(room_id, {
            "text":         final[:500],
            "speaker_name": advisor["name"],
            "speaker_id":   f"ai:{body.advisor_id}",
            "kind":         "ai",
        })
        commitments = evidence_store.extract_commitments(room_id, utterance)
        if commitments:
            evidence_store.log_commitments(room_id, commitments)

    evidence_store.log_decision(room_id, {
        "type": "council",
        "advisor_id": body.advisor_id,
        "question": question,
        "verdict": record["verdict"],
        "totals": record["totals"],
        "run_id": record["run_id"],
    })
    return {
        "ok":       True,
        "room_id":  room_id,
        "verdict":  record["verdict"],
        "totals":   record["totals"],
        "run_id":   record["run_id"],
        "evidence":  evidence_store.record_paths(room_id),
    }


# ─── Status ───────────────────────────────────────────────────────────────────

@app.get("/meeting/status")
async def meeting_status(token: str = Depends(verify_token)):
    rooms = []
    for room_id, info in _active_rooms.items():
        rooms.append({
            **info,
            "transcript_size": stm.size(room_id),
            "pending_escalations": escalation.list_for_room(room_id, include_resolved=False),
            "evidence": evidence_store.record_paths(room_id),
        })
    return {"ok": True, "active_rooms": len(rooms), "rooms": rooms}


@app.post("/meeting/preflight")
async def meeting_preflight(body: PreflightBody, token: str = Depends(verify_token)):
    """Run the owner/host authority gates before the meeting starts."""
    room_id = meeting_security.checked_room_id(body.room_id)
    topic = meeting_security.checked_text(
        body.topic or "",
        field="topic",
        max_chars=meeting_security.MAX_CONTEXT_CHARS,
    )
    result = meeting_policy.preflight(
        room_id,
        topic,
        body.active_advisors,
        body.policy,
    )
    evidence_store.ensure_manifest(room_id, {"preflight": result})
    evidence_store.log_decision(room_id, {"type": "preflight", "result": result})
    return {"ok": True, "preflight": result, "evidence": evidence_store.record_paths(room_id)}


@app.get("/meeting/escalations/{room_id}")
async def meeting_escalations(room_id: str, token: str = Depends(verify_token)):
    room_id = meeting_security.checked_room_id(room_id)
    return {
        "ok": True,
        "room_id": room_id,
        "escalations": escalation.list_for_room(room_id),
    }


@app.post("/meeting/escalation/respond")
async def meeting_escalation_respond(body: EscalationResponseBody, token: str = Depends(verify_token)):
    room_id = meeting_security.checked_room_id(body.room_id)
    note = meeting_security.checked_text(
        body.note,
        field="note",
        max_chars=meeting_security.MAX_TRANSCRIPT_CHARS,
    )
    try:
        record = escalation.respond(
            body.escalation_id,
            approved=body.approved,
            approver=body.approver,
            note=note,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="escalation_not_found")

    proposed = record.get("proposed", {})
    message = ""
    if body.approved and proposed.get("message"):
        room = _active_rooms.get(room_id, {})
        message = meeting_security.checked_text(
            proposed["message"],
            field="message",
            max_chars=meeting_security.MAX_TRANSCRIPT_CHARS,
        )
        utterance = _append_utterance(room_id, {
            "text": message,
            "speaker_name": room.get("advisor_name", "AI Advisor"),
            "speaker_id": f"ai:{room.get('advisor_id', 'advisor')}",
            "kind": "ai",
        })
    else:
        utterance = None

    return {
        "ok": True,
        "room_id": room_id,
        "escalation": record,
        "speak": bool(body.approved and proposed.get("message")),
        "message": message if body.approved else "",
        "utterance": utterance,
    }


@app.post("/meeting/avatar/tavus")
async def meeting_tavus_avatar(body: TavusAvatarBody, token: str = Depends(verify_token)):
    room_id = meeting_security.checked_room_id(body.room_id)
    advisor = get_advisor(body.advisor_id)
    if not advisor:
        raise HTTPException(status_code=400, detail=f"Unknown advisor_id: {body.advisor_id}")
    try:
        result = await tavus.create_conversation(
            room_id=room_id,
            advisor=advisor,
            api_key=body.tavus_api_key,
            replica_id=body.replica_id,
            persona_id=body.persona_id,
            pipeline_mode=body.pipeline_mode,
            conversation_name=body.conversation_name,
            conversational_context=meeting_security.checked_text(
                body.conversational_context,
                field="conversational_context",
                max_chars=meeting_security.MAX_CONTEXT_CHARS,
            ),
            custom_greeting=meeting_security.checked_text(
                body.custom_greeting or "",
                field="custom_greeting",
                max_chars=meeting_security.MAX_TRANSCRIPT_CHARS,
            ) or None,
            test_mode=body.test_mode,
            require_auth=body.require_auth,
            max_participants=body.max_participants,
        )
    except Exception:
        logger.exception("tavus avatar creation failed for room=%s advisor=%s", room_id, body.advisor_id)
        raise HTTPException(status_code=503, detail="tavus_avatar_unavailable")

    room = _active_rooms.setdefault(room_id, {"room_id": room_id})
    room["avatar"] = {k: v for k, v in result.items() if k != "meeting_token"}
    return result


@app.post("/meeting/avatar/tavus/echo")
async def meeting_tavus_echo(body: TavusEchoBody, token: str = Depends(verify_token)):
    room_id = meeting_security.checked_room_id(body.room_id)
    if not body.text and not body.audio_base64:
        raise HTTPException(status_code=400, detail="text_or_audio_required")
    text = meeting_security.checked_text(
        body.text,
        field="text",
        max_chars=meeting_security.MAX_TTS_CHARS,
    ) if body.text is not None else None
    conversation_id = meeting_security.checked_text(
        body.conversation_id,
        field="conversation_id",
        max_chars=256,
        required=True,
    )
    audio_base64 = body.audio_base64
    if audio_base64 is not None:
        meeting_security.decode_audio_base64(audio_base64)
    payload = tavus.echo_payload(
        conversation_id,
        text=text,
        audio_base64=audio_base64,
        sample_rate=body.sample_rate,
        inference_id=body.inference_id,
    )
    evidence_store.log_avatar(room_id, {
        "type": "tavus_echo_payload",
        "conversation_id": conversation_id,
        "modality": payload["properties"]["modality"],
        "text": text,
    })
    return {"ok": True, "payload": payload}


# ─── Advisor list ─────────────────────────────────────────────────────────────

@app.get("/advisors")
async def list_advisors():
    """Returns the available advisor roles (public — no auth required)."""
    return {
        "advisors": [
            {k: v for k, v in a.items() if k != "triggers"}  # omit triggers from public listing
            for a in ADVISORS.values()
        ]
    }


# ─── Internals ────────────────────────────────────────────────────────────────

def _build_advisor_system(advisor: dict, topic: str) -> str:
    return (
        f"You are the {advisor['name']} advisor ({advisor['specialty']}) "
        f"participating in a live business meeting. "
        f"{'Meeting topic: ' + topic + '.' if topic else ''} "
        f"Be concise, practical, and collegial. "
        f"Focus on what matters most from a {advisor['specialty']} perspective. "
        f"Keep responses under 3 sentences unless asked for more detail."
    )


def _append_utterance(room_id: str, utterance: dict[str, Any]) -> dict[str, Any]:
    stored = stm.append(room_id, utterance)
    evidence_store.ensure_manifest(room_id)
    evidence_store.log_transcript(room_id, stored)
    return stored


async def _livekit_join(body: JoinBody) -> dict | None:
    """Phase 2 — LiveKit participant join/control-plane handoff."""
    try:
        from .livekit_agent import join_as_advisor
        return await join_as_advisor(body)
    except Exception as exc:
        logger.exception("livekit join failed for room=%s advisor=%s", body.room_id, body.advisor_id)
        return {"status": "error", "phase": 2, "error": str(exc)}


# ─── Entrypoint ───────────────────────────────────────────────────────────────

def run():
    import uvicorn
    logging.basicConfig(level=logging.INFO)
    logger.info("Starting Hermes Meeting Room server on %s:%d", HOST, PORT)
    uvicorn.run(
        "adapters.meeting_room.server:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    run()
