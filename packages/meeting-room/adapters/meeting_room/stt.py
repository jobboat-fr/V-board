"""
Speech-to-Text — Groq Whisper transcription.

Accepts a raw audio buffer (bytes) and returns the transcript text.
Used by the meeting room capture loop: mic chunks → base64 → this function.

Provider: Groq (free tier covers typical meeting usage)
Model: whisper-large-v3-turbo (fast, multilingual)
"""

import os
import time
import logging
from typing import TypedDict

logger = logging.getLogger("meeting_room.stt")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
DEFAULT_MODEL = os.getenv("STT_MODEL", "whisper-large-v3-turbo")
DEFAULT_LANGUAGE = os.getenv("STT_LANGUAGE", "fr")


class STTResult(TypedDict):
    text: str
    duration_s: float | None
    cost_usd: float
    model: str
    empty: bool


async def transcribe(
    audio: bytes,
    *,
    filename: str = "chunk.webm",
    mime_type: str | None = None,
    language: str | None = None,
    model: str | None = None,
) -> STTResult:
    """
    Transcribe an audio buffer using Groq Whisper.

    Args:
        audio:     Raw audio bytes (webm/opus recommended, min 1KB)
        filename:  Filename hint for the API (used to infer format)
        mime_type: MIME type override (e.g. "audio/webm;codecs=opus")
        language:  BCP-47 language code (default: "fr")
        model:     Whisper model override

    Returns STTResult with text, duration, cost estimate, and empty flag.
    """
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY not set — STT unavailable")

    if len(audio) < 1024:
        return STTResult(text="", duration_s=None, cost_usd=0.0, model=model or DEFAULT_MODEL, empty=True)

    try:
        from groq import AsyncGroq
    except ImportError:
        raise RuntimeError("groq package not installed. Run: pip install groq")

    client = AsyncGroq(api_key=GROQ_API_KEY)
    started = time.monotonic()

    # Build the file tuple groq SDK expects: (filename, bytes, mime_type)
    effective_mime = mime_type or _infer_mime(filename)
    file_tuple = (filename, audio, effective_mime)

    response = await client.audio.transcriptions.create(
        file=file_tuple,
        model=model or DEFAULT_MODEL,
        language=language or DEFAULT_LANGUAGE,
        response_format="verbose_json",
    )

    elapsed = time.monotonic() - started
    text = (getattr(response, "text", "") or "").strip()
    duration = getattr(response, "duration", None)

    # Groq Whisper pricing: ~$0.111 / hour of audio
    cost = (float(duration or 0) / 3600) * 0.111

    logger.debug("stt: transcribed %d bytes in %.2fs → %d chars", len(audio), elapsed, len(text))

    return STTResult(
        text=text,
        duration_s=duration,
        cost_usd=round(cost, 6),
        model=model or DEFAULT_MODEL,
        empty=len(text) < 2,
    )


def is_configured() -> bool:
    return bool(GROQ_API_KEY)


def _infer_mime(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()
    return {
        "webm": "audio/webm",
        "mp3":  "audio/mpeg",
        "mp4":  "audio/mp4",
        "ogg":  "audio/ogg",
        "wav":  "audio/wav",
        "flac": "audio/flac",
        "m4a":  "audio/mp4",
    }.get(ext, "audio/webm")
