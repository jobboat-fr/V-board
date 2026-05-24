# Meeting Room

Live meeting AI advisor — joins voice/video calls as a real participant with CFO, CTO, COO, CRM, Legal, and Product voices.

## Overview

The meeting-room adapter is a FastAPI service (port 8790) that:

1. Joins meeting rooms and maintains a per-room transcript buffer (200 utterances, 4-hour TTL)
2. Runs an intervention judge — decides when the AI should speak
3. Delegates hard analysis to the 5-stage **AIWorkerCollective** council (Primary → 2 Reviewers → Chairman if needed)
4. Synthesizes speech via ElevenLabs (TTS) and transcribes audio via Groq Whisper (STT)
5. Renders optional video avatars via the Tavus echo-mode pipeline
6. Writes a durable auditable evidence chain (transcripts, decisions, escalations, commitments) under `AZZCO_DATA_ROOT/meetings/YYYY-MM-DD/<room_id>/`

## Container

```
meeting-room (port 8790, 127.0.0.1 only)
│
├── adapters/meeting_room/
│   ├── server.py              FastAPI app — all HTTP endpoints
│   ├── security.py            Shared validators, limits, path containment
│   ├── intervention.py        "Should I speak?" judge
│   ├── evidence_store.py      Durable JSONL evidence chain
│   ├── short_term_memory.py   Per-room ring buffer
│   ├── escalation.py          Owner-approval gate
│   ├── policy.py              Meeting preflight and intervention gating
│   ├── tavus.py               BYOK Tavus video avatar (HTTPS-only, redacted errors)
│   ├── stt.py                 Groq Whisper transcription
│   ├── tts.py                 ElevenLabs voice synthesis
│   ├── livekit_agent.py       LiveKit media control plane (Phase 2)
│   └── council/
│       ├── advisors.py        CFO / CTO / COO / CRM / Legal / Product profiles
│       └── collective.py      AIWorkerCollective — 5-stage multi-provider council
│
├── tests/                     128 pytest tests, no real API keys required
├── scripts/
│   ├── check_meeting_room_security.py   14 static security guardrails
│   └── security/
│       └── harden-docker-published-port.sh  DOCKER-USER iptables rule
│
├── Dockerfile
├── docker-compose.yml         Standalone compose (single service)
├── requirements.txt
└── nginx.conf.example         TLS termination template
```

## Required Environment Variables

```bash
MEETING_ROOM_API_TOKEN=<long-random-secret>  # required in production
MEETING_ROOM_REQUIRE_TOKEN=true

# At least one AI provider for the council
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
```

Optional:
```bash
ELEVENLABS_API_KEY=     # TTS voice synthesis
GROQ_API_KEY=           # STT Groq Whisper
TAVUS_API_KEY=          # Tavus video avatar
LIVEKIT_URL=            # LiveKit media (Phase 2)
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe (public) |
| `GET` | `/ready` | Readiness probe — shows all provider states |
| `GET` | `/advisors` | List advisor roles (public) |
| `POST` | `/meeting/join` | Join a room as an AI advisor |
| `POST` | `/meeting/leave` | Disconnect and flush transcript |
| `POST` | `/meeting/transcript` | Push a text utterance |
| `POST` | `/meeting/stt` | Transcribe audio chunk (Groq Whisper) |
| `POST` | `/meeting/tts` | Synthesize advisor speech (ElevenLabs) |
| `POST` | `/meeting/check` | Intervention judge — should the AI speak? |
| `POST` | `/council/analyze` | Full 5-stage AIWorkerCollective analysis |
| `GET` | `/meeting/status` | List active rooms |
| `POST` | `/meeting/preflight` | Owner/host authority gate |
| `GET` | `/meeting/escalations/{room_id}` | Pending escalations |
| `POST` | `/meeting/escalation/respond` | Approve or reject escalation |
| `POST` | `/meeting/avatar/tavus` | Create Tavus video avatar |
| `POST` | `/meeting/avatar/tavus/echo` | Push text/audio to Tavus echo |

## Running Tests

```bash
cd packages/meeting-room
pip install -r requirements.txt pytest
PYTHONPATH=. python -m pytest tests/ -q
```

## Security

See [`docs/meeting-room-security.md`](../../docs/meeting-room-security.md) for the full operational security guide.

Key invariants:
- `MEETING_ROOM_REQUIRE_TOKEN=true` enforced in container default
- `127.0.0.1` bind only — never publicly exposed without TLS proxy
- `read_only` rootfs, `no-new-privileges`, `cap_drop: ALL`
- All evidence paths checked with `security.assert_under_root()`
- Provider BYOK keys are never persisted or echoed in errors
