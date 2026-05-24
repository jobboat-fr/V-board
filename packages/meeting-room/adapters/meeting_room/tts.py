"""
Text-to-Speech â€” voice provider voice synthesis.

Takes text + advisor_id and returns mp3 audio bytes.
Each advisor role has a dedicated voice so meeting participants
can distinguish who is speaking.

Default voices are provider-neutral aliases. Override per advisor with MEETING_VOICE_{ADVISOR_ID}.
"""

import os
import time
import logging
from typing import TypedDict

logger = logging.getLogger("meeting_room.tts")

VOICE_API_KEY = os.getenv("VOICE_API_KEY", "")
VOICE_API_BASE_URL = os.getenv("VOICE_API_BASE_URL", "https://voice-provider.example/v1")
VOICE_API_KEY_HEADER = os.getenv("VOICE_API_KEY_HEADER", "Authorization")

# Default voice map â€” override per advisor via MEETING_VOICE_{ADVISOR_ID} env vars
DEFAULT_VOICES: dict[str, str] = {
    "cfo":     os.getenv("MEETING_VOICE_CFO",     "voice-cfo-default"),
    "cto":     os.getenv("MEETING_VOICE_CTO",     "voice-cto-default"),
    "coo":     os.getenv("MEETING_VOICE_COO",     "voice-coo-default"),
    "crm":     os.getenv("MEETING_VOICE_CRM",     "voice-crm-default"),
    "legal":   os.getenv("MEETING_VOICE_LEGAL",   "voice-legal-default"),
    "product": os.getenv("MEETING_VOICE_PRODUCT", "voice-product-default"),
    "chair":   os.getenv("MEETING_VOICE_CHAIR",   "voice-chair-default"),
}

# Default estimate for paid voice synthesis pricing
_COST_PER_CHAR = 0.00030


class TTSResult(TypedDict):
    audio: bytes
    mime_type: str
    voice_id: str
    chars: int
    cost_usd: float
    ms: int
    model: str


async def synthesize(
    text: str,
    *,
    advisor_id: str = "cfo",
    voice_id: str | None = None,
    output_format: str = "mp3_44100_128",
    model_id: str = "voice-default-fast",
) -> TTSResult:
    """
    Synthesize text to speech using voice provider.

    Args:
        text:          Text to synthesize (max 800 chars recommended)
        advisor_id:    Advisor role â€” selects default voice if voice_id not set
        voice_id:      Override voice ID (voice provider voice ID)
        output_format: Audio format (mp3_44100_128 | pcm_16000 | pcm_22050)
        model_id:      voice provider model identifier

    Returns TTSResult with audio bytes, cost, and metadata.
    """
    if not VOICE_API_KEY:
        raise RuntimeError("VOICE_API_KEY not set â€” TTS unavailable")

    effective_voice = voice_id or DEFAULT_VOICES.get(advisor_id, DEFAULT_VOICES["cfo"])
    chars = len(text)
    started = time.monotonic()

    try:
        import httpx
    except ImportError:
        raise RuntimeError("httpx not installed. Run: pip install httpx")

    url = f"{VOICE_API_BASE_URL.rstrip('/')}/text-to-speech/{effective_voice}"
    headers = {
        "Content-Type": "application/json",
        "Accept": _output_format_to_mime(output_format),
    }
    if VOICE_API_KEY_HEADER.lower() == "authorization":
        headers["Authorization"] = f"Bearer {VOICE_API_KEY}"
    else:
        headers[VOICE_API_KEY_HEADER] = VOICE_API_KEY
    body = {
        "text": text,
        "model_id": model_id,
        "output_format": output_format,
        "voice_settings": {
            "stability": 0.45,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, headers=headers, json=body)
        if not resp.is_success:
            err_text = resp.text[:400]
            raise RuntimeError(f"voice provider TTS failed {resp.status_code}: {err_text}")
        audio = resp.content

    elapsed_ms = int((time.monotonic() - started) * 1000)
    cost = round(chars * _COST_PER_CHAR, 6)

    logger.debug("tts: %d chars â†’ %d bytes in %dms (voice=%s)", chars, len(audio), elapsed_ms, effective_voice)

    return TTSResult(
        audio=audio,
        mime_type=_output_format_to_mime(output_format),
        voice_id=effective_voice,
        chars=chars,
        cost_usd=cost,
        ms=elapsed_ms,
        model=model_id,
    )


def is_configured() -> bool:
    return bool(VOICE_API_KEY)


def get_voice_id(advisor_id: str) -> str:
    return DEFAULT_VOICES.get(advisor_id, DEFAULT_VOICES["cfo"])


def _output_format_to_mime(fmt: str) -> str:
    if fmt.startswith("mp3"):
        return "audio/mpeg"
    if fmt.startswith("pcm"):
        return "audio/pcm"
    if fmt.startswith("ogg"):
        return "audio/ogg"
    return "audio/mpeg"


