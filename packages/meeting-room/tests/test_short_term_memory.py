"""
Unit tests — short_term_memory.py
No API keys required.
"""

import time
import pytest
from adapters.meeting_room import short_term_memory as stm


@pytest.fixture(autouse=True)
def clean_room():
    """Fresh state before every test."""
    stm.clear("test-room")
    yield
    stm.clear("test-room")


# ── append ────────────────────────────────────────────────────────────────────

def test_append_returns_utterance():
    u = stm.append("test-room", {"text": "Hello world", "speaker_name": "Alice"})
    assert u["text"] == "Hello world"
    assert u["speaker_name"] == "Alice"
    assert u["kind"] == "human"          # default
    assert u["id"].startswith("u-")
    assert isinstance(u["ts"], float)


def test_append_ai_kind():
    u = stm.append("test-room", {"text": "I advise caution", "speaker_name": "CFO", "kind": "ai"})
    assert u["kind"] == "ai"


def test_append_increments_size():
    assert stm.size("test-room") == 0
    stm.append("test-room", {"text": "one", "speaker_name": "A"})
    stm.append("test-room", {"text": "two", "speaker_name": "B"})
    assert stm.size("test-room") == 2


def test_append_strips_whitespace():
    u = stm.append("test-room", {"text": "  spaces  \n", "speaker_name": "A"})
    assert u["text"] == "spaces"


# ── recent ────────────────────────────────────────────────────────────────────

def test_recent_empty_room():
    assert stm.recent("no-such-room", 20) == []


def test_recent_returns_oldest_first():
    for i in range(5):
        stm.append("test-room", {"text": f"msg {i}", "speaker_name": "A"})
    window = stm.recent("test-room", 5)
    assert [u["text"] for u in window] == ["msg 0", "msg 1", "msg 2", "msg 3", "msg 4"]


def test_recent_respects_n():
    for i in range(10):
        stm.append("test-room", {"text": f"msg {i}", "speaker_name": "A"})
    window = stm.recent("test-room", 3)
    assert len(window) == 3
    assert window[-1]["text"] == "msg 9"   # newest last


def test_recent_n_larger_than_buffer():
    stm.append("test-room", {"text": "only one", "speaker_name": "A"})
    window = stm.recent("test-room", 100)
    assert len(window) == 1


# ── ring buffer (max 200) ─────────────────────────────────────────────────────

def test_ring_buffer_evicts_oldest():
    for i in range(210):
        stm.append("test-room", {"text": f"msg {i}", "speaker_name": "A"})
    assert stm.size("test-room") == 200
    window = stm.recent("test-room", 200)
    # oldest 10 messages evicted — first remaining is msg 10
    assert window[0]["text"] == "msg 10"
    assert window[-1]["text"] == "msg 209"


# ── clear ─────────────────────────────────────────────────────────────────────

def test_clear_removes_room():
    stm.append("test-room", {"text": "hello", "speaker_name": "A"})
    stm.clear("test-room")
    assert stm.size("test-room") == 0
    assert stm.recent("test-room") == []


def test_clear_nonexistent_room_is_safe():
    stm.clear("ghost-room")   # must not raise


# ── evict_stale ───────────────────────────────────────────────────────────────

def test_evict_stale_removes_old_rooms(monkeypatch):
    stm.clear("stale-room")
    stm.append("stale-room", {"text": "old", "speaker_name": "A"})

    # Force last_activity to ancient past
    stm._rooms["stale-room"].last_activity = time.time() - 5 * 3600  # 5h ago

    evicted = stm.evict_stale()
    assert "stale-room" in evicted
    assert stm.size("stale-room") == 0


def test_evict_stale_keeps_fresh_rooms():
    stm.append("test-room", {"text": "fresh", "speaker_name": "A"})
    evicted = stm.evict_stale()
    assert "test-room" not in evicted
    assert stm.size("test-room") == 1
