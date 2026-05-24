"""
LiveKit control-plane adapter for the meeting-room server.

This module is deliberately conservative: it does not claim that a media
participant is connected unless a real LiveKit runtime is available and the
join call succeeds. Callers receive a truthful status indicating the server
is ready for transcript, council, and TTS work while the media worker is
provisioned separately.
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from typing import Any


CONTROL_PLANE = "control-plane"
REALTIME = "realtime"


@dataclass
class LiveKitReadiness:
    configured: bool
    mode: str
    sdk_available: bool
    url_configured: bool
    api_key_configured: bool
    api_secret_configured: bool
    can_connect_media: bool
    status: str
    reason: str | None = None


def _mode() -> str:
    mode = os.getenv("MEETING_ROOM_LIVEKIT_MODE", CONTROL_PLANE).strip().lower()
    return REALTIME if mode == REALTIME else CONTROL_PLANE


def _sdk_available() -> tuple[bool, str | None]:
    try:
        import livekit  # noqa: F401
        return True, None
    except Exception as exc:  # pragma: no cover - depends on optional runtime
        return False, str(exc)


def readiness() -> dict[str, Any]:
    sdk_ok, sdk_error = _sdk_available()
    url_ok = bool(os.getenv("LIVEKIT_URL"))
    key_ok = bool(os.getenv("LIVEKIT_API_KEY"))
    secret_ok = bool(os.getenv("LIVEKIT_API_SECRET"))
    configured = url_ok and key_ok and secret_ok
    mode = _mode()
    can_connect = configured and sdk_ok and mode == REALTIME
    reason = None
    if not configured:
        reason = "livekit_env_missing"
    elif mode != REALTIME:
        reason = "control_plane_mode"
    elif not sdk_ok:
        reason = f"livekit_sdk_unavailable: {sdk_error}"

    return asdict(LiveKitReadiness(
        configured=configured,
        mode=mode,
        sdk_available=sdk_ok,
        url_configured=url_ok,
        api_key_configured=key_ok,
        api_secret_configured=secret_ok,
        can_connect_media=can_connect,
        status="ready" if can_connect else "deferred",
        reason=reason,
    ))


async def join_as_advisor(body: Any) -> dict[str, Any]:
    """
    Accept a LiveKit token and report the precise media-worker state.

    The V-Board HTTP server already handles the meeting transcript and council
    endpoints. This function is for the audio/video participant plane. Set
    MEETING_ROOM_LIVEKIT_MODE=realtime only when a real LiveKit worker runtime
    is installed and supervised.
    """
    status = readiness()
    if not getattr(body, "livekit_token", None):
        return {
            "status": "skipped",
            "phase": 2,
            "reason": "livekit_token_missing",
            "readiness": status,
        }

    if not status["can_connect_media"]:
        return {
            "status": "control_plane_ready",
            "phase": 2,
            "mode": status["mode"],
            "reason": status["reason"],
            "room_id": body.room_id,
            "advisor_id": body.advisor_id,
            "readiness": status,
        }

    # The actual media loop belongs in a supervised worker process because it
    # must keep running after the HTTP request returns. Returning this status is
    # production-safe: the caller knows the worker can be started, but this
    # request did not block while a persistent audio loop runs.
    return {
        "status": "media_worker_ready",
        "phase": 2,
        "mode": REALTIME,
        "room_id": body.room_id,
        "advisor_id": body.advisor_id,
        "identity": f"ai-{body.advisor_id}-{body.room_id}",
        "readiness": status,
    }
