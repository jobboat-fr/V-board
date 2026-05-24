"""
Shared in-memory rooms registry.

Both the native hermes tool (tools/meeting_room_tool.py) and the optional
HTTP server (adapters/meeting_room/server.py) import this dict so they
see the same active-rooms state when running in the same process.
"""

# room_id → { advisor_id, advisor_name, topic, active_advisors, status,
#              livekit, transcript_size }
active_rooms: dict[str, dict] = {}
