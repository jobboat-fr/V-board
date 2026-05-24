"""Durable evidence store for meeting-room sessions.

The in-memory transcript buffer is useful for live reasoning, but meeting
work also needs an auditable trail: transcript lines, decisions, escalations,
commitments, avatar sessions, and generated media metadata. This module keeps
that trail as JSONL files under:

    $VBOARD_DATA_ROOT/meetings/YYYY-MM-DD/<room_id>/

If VBOARD_DATA_ROOT is not set, it falls back to ./data.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import security

_ROOM_DIRS: dict[str, Path] = {}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def data_root() -> Path:
    return security.resolve_data_root(os.getenv("VBOARD_DATA_ROOT", ""))


def safe_room_id(room_id: str) -> str:
    return security.safe_component(room_id, fallback="room", max_length=security.MAX_ROOM_ID_CHARS)


def meeting_dir(room_id: str, *, create: bool = True) -> Path:
    security.checked_room_id(room_id)
    if room_id in _ROOM_DIRS:
        path = _ROOM_DIRS[room_id]
    else:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        path = data_root() / "meetings" / day / safe_room_id(room_id)
        path = security.assert_under_root(path, data_root())
        _ROOM_DIRS[room_id] = path
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def record_paths(room_id: str) -> dict[str, str]:
    root = meeting_dir(room_id)
    return {
        "root": str(root),
        "manifest": str(root / "manifest.json"),
        "transcript": str(root / "transcript.jsonl"),
        "decisions": str(root / "decisions.jsonl"),
        "commitments": str(root / "commitments.jsonl"),
        "escalations": str(root / "escalations.jsonl"),
        "avatars": str(root / "avatars.jsonl"),
        "media_dir": str(root / "media"),
    }


def ensure_manifest(room_id: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    root = meeting_dir(room_id)
    manifest_path = root / "manifest.json"
    manifest: dict[str, Any]
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}
    else:
        manifest = {}

    manifest.setdefault("room_id", room_id)
    manifest.setdefault("created_at", now_iso())
    manifest.setdefault("schema_version", 1)
    if metadata:
        manifest.update(metadata)
    manifest["updated_at"] = now_iso()
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return manifest


def append_jsonl(room_id: str, stream: str, record: dict[str, Any]) -> dict[str, Any]:
    root = meeting_dir(room_id)
    payload = {"ts": now_iso(), **record}
    path = root / f"{stream}.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
    return payload


def log_transcript(room_id: str, utterance: dict[str, Any]) -> dict[str, Any]:
    return append_jsonl(room_id, "transcript", {"room_id": room_id, "utterance": utterance})


def log_decision(room_id: str, decision: dict[str, Any]) -> dict[str, Any]:
    return append_jsonl(room_id, "decisions", {"room_id": room_id, "decision": decision})


def log_commitments(room_id: str, commitments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        append_jsonl(room_id, "commitments", {"room_id": room_id, "commitment": item})
        for item in commitments
    ]


def log_escalation(room_id: str, escalation: dict[str, Any]) -> dict[str, Any]:
    return append_jsonl(room_id, "escalations", {"room_id": room_id, "escalation": escalation})


def log_avatar(room_id: str, avatar: dict[str, Any]) -> dict[str, Any]:
    return append_jsonl(room_id, "avatars", {"room_id": room_id, "avatar": avatar})


def write_audio(room_id: str, audio: bytes, *, prefix: str = "speech", suffix: str = ".mp3") -> dict[str, Any]:
    media_dir = meeting_dir(room_id) / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    filename = (
        f"{security.safe_component(prefix, fallback='speech')}-"
        f"{int(time.time() * 1000)}"
        f"{security.safe_audio_suffix(suffix)}"
    )
    path = security.assert_under_root(media_dir / filename, meeting_dir(room_id))
    path.write_bytes(audio)
    return {
        "path": str(path),
        "bytes": len(audio),
        "filename": filename,
    }


def extract_commitments(room_id: str, utterance: dict[str, Any]) -> list[dict[str, Any]]:
    """Small deterministic extractor for the first durable commitment log.

    This is intentionally conservative. An LLM extractor can be layered on
    later, but this catches the common meeting phrases without network calls.
    """
    text = str(utterance.get("text", "")).strip()
    lowered = text.lower()
    markers = (
        "i will ",
        "i'll ",
        "we will ",
        "we'll ",
        "i can ",
        "we can ",
        "i commit ",
        "we commit ",
        "action item",
        "follow up",
    )
    if not any(marker in lowered for marker in markers):
        return []

    speaker = utterance.get("speaker_name") or utterance.get("speaker_id") or "Unknown"
    commitment = {
        "id": f"c-{int(time.time() * 1000)}",
        "room_id": room_id,
        "speaker_name": speaker,
        "speaker_id": utterance.get("speaker_id"),
        "text": text[:1000],
        "source_utterance_id": utterance.get("id"),
        "status": "open",
        "detected_by": "rule",
        "detected_at": now_iso(),
    }
    return [commitment]
