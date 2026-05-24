"""
hermes-agent — Meeting Room Adapter
Joins a live voice/video meeting as an AI participant.

Components:
  server.py          — FastAPI HTTP server (join/leave/check/bridge)
  short_term_memory  — per-room ring buffer (200 utterances, 4h TTL)
  stt                — Groq Whisper speech-to-text
  tts                — ElevenLabs voice synthesis
  intervention       — decides when the AI should speak
  council/           — multi-provider advisor council (CFO/CTO/COO/CRM)
"""
