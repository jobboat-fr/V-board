"""Optional avatar provider avatar channel for meeting-room advisors.

avatar provider has two useful modes for this project:

* full: avatar provider runs the complete CVI pipeline for a persona/replica.
* echo: The meeting brain remains the brain and avatar provider renders supplied text/audio.

This module only uses server-side API keys. Callers may pass a key for a
single request, but it is never persisted in evidence logs.
"""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlparse

from . import evidence_store, security

AVATAR_API_BASE_URL = os.getenv("AVATAR_API_BASE_URL", "https://avatarapi.com")
HTTP_TIMEOUT_SECONDS = security.env_int("AVATAR_HTTP_TIMEOUT_SECONDS", 30, minimum=5, maximum=120)


def is_configured(api_key: str | None = None) -> bool:
    return bool(api_key or os.getenv("AVATAR_API_KEY"))


def _api_key(api_key: str | None = None) -> str:
    key = api_key or os.getenv("AVATAR_API_KEY", "")
    if not key:
        raise RuntimeError("AVATAR_API_KEY not set - avatar unavailable")
    return key


def _base_url() -> str:
    raw_url = (os.getenv("AVATAR_API_BASE_URL") or AVATAR_API_BASE_URL).rstrip("/")
    parsed = urlparse(raw_url)
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise RuntimeError("avatar provider base URL must use https")
    if not parsed.netloc:
        raise RuntimeError("avatar provider base URL is invalid")
    return raw_url


def _clean_error(prefix: str, status_code: int, body: str, api_key: str) -> RuntimeError:
    detail = security.redact_secret(body[:200], api_key)
    suffix = f": {detail}" if detail else ""
    return RuntimeError(f"{prefix} failed {status_code}{suffix}")


def advisor_system_prompt(advisor: dict[str, Any], topic: str = "") -> str:
    topic = security.checked_text(
        topic,
        field="topic",
        max_chars=security.MAX_CONTEXT_CHARS,
    )
    return (
        f"You are the {advisor.get('name', 'AI')} advisor "
        f"({advisor.get('specialty', 'General')}) in a live meeting. "
        f"{'Meeting topic: ' + topic + '. ' if topic else ''}"
        "Be concise, practical, and collegial. Speak only when useful. "
        "When using echo mode, The meeting brain supplies the actual words; this persona "
        "mainly controls avatar presence and delivery."
    )


async def create_persona(
    *,
    api_key: str | None = None,
    persona_name: str,
    system_prompt: str | None = None,
    pipeline_mode: str = "echo",
    default_replica_id: str | None = None,
) -> dict[str, Any]:
    try:
        import httpx
    except ImportError:
        raise RuntimeError("httpx not installed. Run: pip install httpx")

    key = _api_key(api_key)
    mode = pipeline_mode if pipeline_mode in {"full", "echo"} else "echo"
    body: dict[str, Any] = {
        "persona_name": security.checked_text(
            persona_name,
            field="persona_name",
            max_chars=256,
            required=True,
        ),
        "pipeline_mode": mode,
    }
    if system_prompt and mode == "full":
        body["system_prompt"] = security.checked_text(
            system_prompt,
            field="system_prompt",
            max_chars=security.MAX_CONTEXT_CHARS,
        )
    if default_replica_id:
        body["default_replica_id"] = security.checked_text(
            default_replica_id,
            field="default_replica_id",
            max_chars=256,
            required=True,
        )

    async with httpx.AsyncClient(
        timeout=float(HTTP_TIMEOUT_SECONDS),
        limits=httpx.Limits(max_connections=5, max_keepalive_connections=2),
    ) as client:
        resp = await client.post(
            f"{_base_url()}/v2/personas",
            headers={"x-api-key": key, "Content-Type": "application/json"},
            json=body,
        )
        if not resp.is_success:
            raise _clean_error("avatar provider persona", resp.status_code, resp.text, key)
        return resp.json()


async def create_conversation(
    *,
    room_id: str,
    advisor: dict[str, Any],
    api_key: str | None = None,
    replica_id: str | None = None,
    persona_id: str | None = None,
    pipeline_mode: str = "echo",
    conversation_name: str | None = None,
    conversational_context: str = "",
    custom_greeting: str | None = None,
    test_mode: bool = False,
    require_auth: bool = False,
    max_participants: int | None = None,
) -> dict[str, Any]:
    try:
        import httpx
    except ImportError:
        raise RuntimeError("httpx not installed. Run: pip install httpx")

    key = _api_key(api_key)
    room_id = security.checked_room_id(room_id)
    conversational_context = security.checked_text(
        conversational_context,
        field="conversational_context",
        max_chars=security.MAX_CONTEXT_CHARS,
    )
    if conversation_name:
        conversation_name = security.checked_text(
            conversation_name,
            field="conversation_name",
            max_chars=256,
        )
    if custom_greeting:
        custom_greeting = security.checked_text(
            custom_greeting,
            field="custom_greeting",
            max_chars=security.MAX_TRANSCRIPT_CHARS,
        )
    if replica_id:
        replica_id = security.checked_text(replica_id, field="replica_id", max_chars=256)
    if persona_id:
        persona_id = security.checked_text(persona_id, field="persona_id", max_chars=256)

    mode = pipeline_mode if pipeline_mode in {"full", "echo"} else "echo"
    if not persona_id:
        persona = await create_persona(
            api_key=key,
            persona_name=f"V-Board {advisor.get('name', 'Advisor')}",
            system_prompt=advisor_system_prompt(advisor, conversational_context),
            pipeline_mode=mode,
            default_replica_id=replica_id,
        )
        persona_id = persona["persona_id"]

    body: dict[str, Any] = {
        "persona_id": persona_id,
        "conversation_name": conversation_name or f"V-Board meeting {security.safe_component(room_id, fallback='room')}",
        "test_mode": bool(test_mode),
        "require_auth": bool(require_auth),
    }
    if replica_id:
        body["replica_id"] = replica_id
    if conversational_context:
        body["conversational_context"] = conversational_context
    if custom_greeting:
        body["custom_greeting"] = custom_greeting
    if max_participants:
        body["max_participants"] = max(2, int(max_participants))

    async with httpx.AsyncClient(
        timeout=float(HTTP_TIMEOUT_SECONDS),
        limits=httpx.Limits(max_connections=5, max_keepalive_connections=2),
    ) as client:
        resp = await client.post(
            f"{_base_url()}/v2/conversations",
            headers={"x-api-key": key, "Content-Type": "application/json"},
            json=body,
        )
        if not resp.is_success:
            raise _clean_error("avatar provider conversation", resp.status_code, resp.text, key)
        data = resp.json()

    result = {
        "ok": True,
        "provider": "avatar",
        "pipeline_mode": mode,
        "room_id": room_id,
        "advisor_id": advisor.get("id"),
        "persona_id": persona_id,
        "conversation_id": data.get("conversation_id"),
        "conversation_url": data.get("conversation_url"),
        "status": data.get("status"),
        "meeting_token": data.get("meeting_token"),
        "test_mode": bool(test_mode),
    }
    evidence_store.log_avatar(room_id, {k: v for k, v in result.items() if k != "meeting_token"})
    return result


def echo_payload(
    conversation_id: str,
    *,
    text: str | None = None,
    audio_base64: str | None = None,
    sample_rate: int = 24000,
    inference_id: str | None = None,
) -> dict[str, Any]:
    conversation_id = security.checked_text(
        conversation_id,
        field="conversation_id",
        max_chars=256,
        required=True,
    )
    if text is not None:
        text = security.checked_text(
            text,
            field="text",
            max_chars=security.MAX_TTS_CHARS,
        )
    if audio_base64 is not None:
        security.decode_audio_base64(audio_base64)
    sample_rate = min(max(int(sample_rate), 8_000), 48_000)
    if inference_id:
        inference_id = security.checked_text(inference_id, field="inference_id", max_chars=256)

    properties: dict[str, Any] = {
        "modality": "audio" if audio_base64 else "text",
        "done": True,
    }
    if text is not None:
        properties["text"] = text
    if audio_base64 is not None:
        properties["audio"] = audio_base64
        properties["sample_rate"] = sample_rate
    if inference_id:
        properties["inference_id"] = inference_id

    return {
        "message_type": "conversation",
        "event_type": "conversation.echo",
        "conversation_id": conversation_id,
        "properties": properties,
    }
