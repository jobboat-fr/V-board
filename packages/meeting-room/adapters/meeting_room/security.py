"""Shared safety limits and sanitizers for the meeting-room adapter."""

from __future__ import annotations

import base64
import binascii
import os
import re
from pathlib import Path

_SAFE_COMPONENT = re.compile(r"[^A-Za-z0-9_.-]+")
_ALLOWED_AUDIO_SUFFIXES = {".mp3", ".wav", ".ogg", ".webm", ".m4a", ".bin"}


class MeetingValidationError(ValueError):
    """Validation error with an HTTP-friendly status code."""

    def __init__(self, code: str, *, status_code: int = 400):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(max(value, minimum), maximum)


MAX_ROOM_ID_CHARS = env_int("MEETING_ROOM_MAX_ROOM_ID_CHARS", 160, minimum=1, maximum=512)
MAX_TRANSCRIPT_CHARS = env_int("MEETING_ROOM_MAX_TRANSCRIPT_CHARS", 20_000, minimum=256, maximum=200_000)
MAX_CONTEXT_CHARS = env_int("MEETING_ROOM_MAX_CONTEXT_CHARS", 60_000, minimum=1_000, maximum=300_000)
MAX_TTS_CHARS = env_int("MEETING_ROOM_MAX_TTS_CHARS", 2_000, minimum=32, maximum=20_000)
MAX_AUDIO_BYTES = env_int("MEETING_ROOM_MAX_AUDIO_BYTES", 10 * 1024 * 1024, minimum=1024, maximum=50 * 1024 * 1024)
MAX_REQUEST_BYTES = env_int("MEETING_ROOM_MAX_REQUEST_BYTES", 14 * 1024 * 1024, minimum=4096, maximum=64 * 1024 * 1024)


def safe_component(value: str | None, *, fallback: str = "item", max_length: int = 96) -> str:
    cleaned = _SAFE_COMPONENT.sub("_", str(value or "").strip())
    cleaned = cleaned.strip("._")[:max_length]
    return cleaned or fallback


def safe_audio_suffix(value: str | None) -> str:
    suffix = str(value or ".bin").strip().lower()
    if not suffix.startswith("."):
        suffix = f".{suffix}"
    return suffix if suffix in _ALLOWED_AUDIO_SUFFIXES else ".bin"


def checked_room_id(room_id: str) -> str:
    text = str(room_id or "").strip()
    if not text:
        raise MeetingValidationError("room_id_required")
    if len(text) > MAX_ROOM_ID_CHARS:
        raise MeetingValidationError("room_id_too_long", status_code=413)
    if any(ord(char) < 32 or ord(char) == 127 for char in text):
        raise MeetingValidationError("room_id_invalid")
    return text


def checked_text(value: str | None, *, field: str, max_chars: int, required: bool = False) -> str:
    text = str(value or "")
    if required and not text.strip():
        raise MeetingValidationError(f"{field}_required")
    if len(text) > max_chars:
        raise MeetingValidationError(f"{field}_too_large", status_code=413)
    if "\x00" in text:
        raise MeetingValidationError(f"{field}_invalid")
    return text


def decode_audio_base64(value: str, *, max_bytes: int = MAX_AUDIO_BYTES) -> bytes:
    encoded = str(value or "")
    # Base64 expands by roughly 4/3. Reject obviously huge payloads before
    # allocating the decoded bytes.
    if len(encoded) > int(max_bytes * 1.4) + 64:
        raise MeetingValidationError("audio_too_large", status_code=413)
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise MeetingValidationError("invalid_audio_base64")
    if len(decoded) > max_bytes:
        raise MeetingValidationError("audio_too_large", status_code=413)
    return decoded


def resolve_data_root(raw_root: str | None = None) -> Path:
    root = str(raw_root or "").strip()
    path = Path(root).expanduser() if root else Path.cwd() / "data"
    return path.resolve()


def assert_under_root(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    root_resolved = root.resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise MeetingValidationError("path_outside_data_root", status_code=403)
    return resolved


def redact_secret(text: str, *secrets: str | None) -> str:
    redacted = str(text or "")
    for secret in secrets:
        if secret:
            redacted = redacted.replace(secret, "[REDACTED]")
    return redacted
