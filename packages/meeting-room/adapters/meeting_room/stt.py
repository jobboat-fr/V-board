"""
Speech-to-Text â€” speech-to-text provider transcription.

Accepts a raw audio buffer (bytes) and returns the transcript text.
Used by the meeting room capture loop: mic chunks â†’ base64 â†’ this function.

Provider: configurable speech-to-text provider
Model: configurable fast multilingual transcription model
"""

import os
import time
import logging
from typing import TypedDict

logger = logging.getLogger("meeting_room.stt")

STT_API_KEY = os.getenv("STT_API_KEY", "")
STT_SDK_MODULE = os.getenv("STT_SDK_MODULE", "")
STT_SDK_CLIENT = os.getenv("STT_SDK_CLIENT", "")
DEFAULT_MODEL = os.getenv("STT_MODEL", "stt-default-model")
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
    Transcribe an audio buffer using speech-to-text provider.

    Args:
        audio:     Raw audio bytes (webm/opus recommended, min 1KB)
        filename:  Filename hint for the API (used to infer format)
        mime_type: MIME type override (e.g. "audio/webm;codecs=opus")
        language:  BCP-47 language code (default: "fr")
        model:     Whisper model override

    Returns STTResult with text, duration, cost estimate, and empty flag.
    """
    if not STT_API_KEY:
        raise RuntimeError("STT_API_KEY not set â€” STT unavailable")

    if len(audio) < 1024:
        return STTResult(text="", duration_s=None, cost_usd=0.0, model=model or DEFAULT_MODEL, empty=True)

    if not STT_SDK_MODULE or not STT_SDK_CLIENT:
        raise RuntimeError("STT_SDK_MODULE and STT_SDK_CLIENT must be set when using SDK transcription")

    try:
        import importlib
        module = importlib.import_module(STT_SDK_MODULE)
        AsyncSttClient = getattr(module, STT_SDK_CLIENT)
    except (ImportError, AttributeError) as exc:
        raise RuntimeError("configured speech-to-text SDK package is not available") from exc

    client = AsyncSttClient(api_key=STT_API_KEY)
    started = time.monotonic()

    # Build the file tuple expected by the configured SDK: (filename, bytes, mime_type)
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

    # Default estimate for low-cost speech-to-text pricing
    cost = (float(duration or 0) / 3600) * 0.111

    logger.debug("stt: transcribed %d bytes in %.2fs â†’ %d chars", len(audio), elapsed, len(text))

    return STTResult(
        text=text,
        duration_s=duration,
        cost_usd=round(cost, 6),
        model=model or DEFAULT_MODEL,
        empty=len(text) < 2,
    )


def is_configured() -> bool:
    return bool(STT_API_KEY)


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

