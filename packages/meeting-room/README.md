# Meeting Room

Live AI advisors for meetings: listen, decide, escalate, speak, and preserve evidence.

The meeting-room package is a FastAPI service that lets V-Board workers participate in a meeting context as CFO, CTO, COO, CRM, Legal, Product, or custom roles.

## No-Key Demo

From the repo root:

```bash
python -m pip install -r packages/meeting-room/requirements.txt pytest
python packages/meeting-room/scripts/demo_meeting_room.py
```

Or:

```bash
npm run demo:meeting
```

The demo uses the real HTTP handlers in process. It creates a room, adds advisors, captures transcript lines, detects a commitment, proposes a legal/CFO intervention, pauses for host approval, resumes with context, and prints the evidence files.

## What The Service Does

1. Joins meeting rooms and maintains a per-room transcript buffer.
2. Runs an intervention judge that decides whether an advisor should speak.
3. Applies host/owner authority gates before risky speech.
4. Delegates deep analysis to the 5-stage AI worker collective when needed.
5. Supports configurable speech-to-text, voice, and avatar adapters.
6. Writes transcripts, decisions, commitments, escalations, avatar sessions, and media references under `VBOARD_DATA_ROOT`.

## Required Environment

```bash
MEETING_ROOM_API_TOKEN=<long-random-secret>
MEETING_ROOM_REQUIRE_TOKEN=true
```

Optional provider configuration:

```bash
PRIMARY_LLM_API_KEY=
PRIMARY_LLM_API_BASE_URL=
REVIEWER_LLM_API_KEY=
REVIEWER_LLM_API_BASE_URL=
CHAIR_LLM_API_KEY=
CHAIR_LLM_API_BASE_URL=
LLM_ROUTER_API_KEY=
LLM_ROUTER_API_BASE_URL=

STT_API_KEY=
STT_SDK_MODULE=
STT_SDK_CLIENT=
VOICE_API_KEY=
VOICE_API_BASE_URL=
VOICE_API_KEY_HEADER=Authorization
AVATAR_API_KEY=
AVATAR_API_BASE_URL=

LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe. |
| `GET` | `/ready` | Readiness and provider state. |
| `GET` | `/advisors` | List advisor roles. |
| `POST` | `/meeting/join` | Join a room as an AI advisor. |
| `POST` | `/meeting/leave` | End a room and flush memory. |
| `POST` | `/meeting/transcript` | Push a text utterance. |
| `POST` | `/meeting/stt` | Transcribe audio through configured STT adapter. |
| `POST` | `/meeting/tts` | Synthesize speech through configured voice adapter. |
| `POST` | `/meeting/check` | Decide whether an advisor should intervene. |
| `POST` | `/council/analyze` | Run full 5-stage council analysis. |
| `GET` | `/meeting/status` | List active rooms. |
| `POST` | `/meeting/preflight` | Run host authority gates. |
| `GET` | `/meeting/escalations/{room_id}` | List pending escalations. |
| `POST` | `/meeting/escalation/respond` | Approve or reject an escalation. |
| `POST` | `/meeting/avatar/provider` | Create an optional avatar provider session. |
| `POST` | `/meeting/avatar/provider/echo` | Send text/audio to avatar echo mode. |

## Layout

```text
adapters/meeting_room/server.py              FastAPI app
adapters/meeting_room/security.py            validation and redaction
adapters/meeting_room/policy.py              preflight and intervention gates
adapters/meeting_room/intervention.py        lightweight should-I-speak judge
adapters/meeting_room/evidence_store.py      JSONL evidence chain
adapters/meeting_room/stt.py                 configurable STT adapter
adapters/meeting_room/tts.py                 configurable voice adapter
adapters/meeting_room/avatar.py              configurable avatar adapter
adapters/meeting_room/council/collective.py  5-stage council orchestration
tests/                                       no-key pytest suite
scripts/check_meeting_room_security.py       static guardrails
scripts/demo_meeting_room.py                 no-key demo
```

## Tests

```bash
python -m pip install -r requirements.txt pytest
PYTHONPATH=. python -m pytest tests -q
python scripts/check_meeting_room_security.py
```

## Security

See [`../../docs/meeting-room-security.md`](../../docs/meeting-room-security.md).

Key invariants:

- Token required in production.
- Localhost/private-network binding by default.
- Request size limits and base64 audio limits.
- Evidence paths are contained under `VBOARD_DATA_ROOT`.
- Provider keys are never stored in evidence logs.
- Avatar meeting tokens are removed from room status.