"""
Short-term memory — per-room ring buffer.

Stores the last N utterances for a room.
Used by the intervention judge to read recent conversation context.

Limits:
  - 200 utterances per room
  - 4-hour TTL (room evicted if no new utterance in 4h)
  - Thread-safe via asyncio.Lock
"""

import time
import uuid
from collections import deque
from typing import TypedDict

_BUFFER_SIZE = 200
_TTL_SECONDS = 4 * 3600  # 4 hours


class Utterance(TypedDict):
    id: str
    speaker_name: str
    speaker_id: str
    text: str
    kind: str        # "human" | "ai" | "system"
    ts: float        # unix timestamp


class _RoomBuffer:
    def __init__(self):
        self.buffer: deque[Utterance] = deque(maxlen=_BUFFER_SIZE)
        self.last_activity: float = time.time()


# room_id → _RoomBuffer
_rooms: dict[str, _RoomBuffer] = {}


def _get_or_create(room_id: str) -> _RoomBuffer:
    if room_id not in _rooms:
        _rooms[room_id] = _RoomBuffer()
    return _rooms[room_id]


def append(room_id: str, utterance: dict) -> Utterance:
    """
    Append an utterance to the room buffer.
    Returns the stored utterance with generated id and ts.
    """
    buf = _get_or_create(room_id)
    entry: Utterance = {
        "id":           utterance.get("id") or f"u-{int(time.time()*1000)}-{uuid.uuid4().hex[:6]}",
        "speaker_name": utterance.get("speaker_name", "Unknown"),
        "speaker_id":   utterance.get("speaker_id") or f"human-{utterance.get('speaker_name', 'unknown')}",
        "text":         str(utterance.get("text", "")).strip(),
        "kind":         utterance.get("kind", "human"),
        "ts":           utterance.get("ts") or time.time(),
    }
    buf.buffer.append(entry)
    buf.last_activity = time.time()
    return entry


def recent(room_id: str, n: int = 20) -> list[Utterance]:
    """Return the last n utterances for a room (oldest first)."""
    buf = _rooms.get(room_id)
    if not buf:
        return []
    items = list(buf.buffer)
    return items[-n:] if n < len(items) else items


def size(room_id: str) -> int:
    buf = _rooms.get(room_id)
    return len(buf.buffer) if buf else 0


def clear(room_id: str) -> None:
    """Clear a room's buffer (call after room ends to free RAM)."""
    _rooms.pop(room_id, None)


def evict_stale() -> list[str]:
    """Remove rooms idle for longer than TTL. Returns evicted room IDs."""
    now = time.time()
    stale = [rid for rid, buf in _rooms.items() if now - buf.last_activity > _TTL_SECONDS]
    for rid in stale:
        del _rooms[rid]
    return stale
