"""
Text-to-Speech — ElevenLabs voice synthesis.

Takes text + advisor_id and returns mp3 audio bytes.
Each advisor role has a dedicated voice so meeting participants
can distinguish who is speaking.

Default voices (all ElevenLabs stock voices, no custom cloning required):
  cfo     → Rachel  (JBFqnCBsd6RMkjVDRZzb) — clear, authoritative
  cto     → Adam    (pNInz6obpgDQGcFmaJgB) — calm, technical
  coo     → Domi    (AZnzlk1XvdvUeBnXmlld) — decisive, operational
  crm     → Elli    (MF3mGyEYCl7XYWbV9V6O) — warm, approachable
  legal   → Josh    (TxGEqnHWrfWFTfGW9XjX) — measured, precise
  product → Bella   (EXAVITQu4vr4xnSDxMaL) — energetic, user-focused
  chair   → Antoni  (ErXwobaYiN019PkySvjV) — composed, neutral
"""

import os
import time
import logging
from typing import TypedDict

logger = logging.getLogger("meeting_room.tts")

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

# Default voice map — override per advisor via MEETING_VOICE_{ADVISOR_ID} env vars
DEFAULT_VOICES: dict[str, str] = {
    "cfo":     os.getenv("MEETING_VOICE_CFO",     "JBFqnCBsd6RMkjVDRZzb"),  # Rachel
    "cto":     os.getenv("MEETING_VOICE_CTO",     "pNInz6obpgDQGcFmaJgB"),  # Adam
    "coo":     os.getenv("MEETING_VOICE_COO",     "AZnzlk1XvdvUeBnXmlld"),  # Domi
    "crm":     os.getenv("MEETING_VOICE_CRM",     "MF3mGyEYCl7XYWbV9V6O"),  # Elli
    "legal":   os.getenv("MEETING_VOICE_LEGAL",   "TxGEqnHWrfWFTfGW9XjX"),  # Josh
    "product": os.getenv("MEETING_VOICE_PRODUCT", "EXAVITQu4vr4xnSDxMaL"),  # Bella
    "chair":   os.getenv("MEETING_VOICE_CHAIR",   "ErXwobaYiN019PkySvjV"),  # Antoni
}

# ElevenLabs pricing: ~$0.30 per 1000 chars (Starter plan)
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
    model_id: str = "eleven_turbo_v2_5",
) -> TTSResult:
    """
    Synthesize text to speech using ElevenLabs.

    Args:
        text:          Text to synthesize (max 800 chars recommended)
        advisor_id:    Advisor role — selects default voice if voice_id not set
        voice_id:      Override voice ID (ElevenLabs voice ID)
        output_format: Audio format (mp3_44100_128 | pcm_16000 | pcm_22050)
        model_id:      ElevenLabs model (eleven_turbo_v2_5 is fast + multilingual)

    Returns TTSResult with audio bytes, cost, and metadata.
    """
    if not ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY not set — TTS unavailable")

    effective_voice = voice_id or DEFAULT_VOICES.get(advisor_id, DEFAULT_VOICES["cfo"])
    chars = len(text)
    started = time.monotonic()

    try:
        import httpx
    except ImportError:
        raise RuntimeError("httpx not installed. Run: pip install httpx")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{effective_voice}"
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": _output_format_to_mime(output_format),
    }
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
            raise RuntimeError(f"ElevenLabs TTS failed {resp.status_code}: {err_text}")
        audio = resp.content

    elapsed_ms = int((time.monotonic() - started) * 1000)
    cost = round(chars * _COST_PER_CHAR, 6)

    logger.debug("tts: %d chars → %d bytes in %dms (voice=%s)", chars, len(audio), elapsed_ms, effective_voice)

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
    return bool(ELEVENLABS_API_KEY)


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
