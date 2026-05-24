# ─────────────────────────────────────────────────────────────────
# V-Board — Meeting Room container
# Standalone FastAPI server for the V-Board meeting-room adapter.
# Port 8790 — bound to 127.0.0.1 by default (nginx terminates TLS).
#
# Build (from v-board repo root):
#   docker compose build meeting-room
#   # or standalone:
#   docker build -f packages/meeting-room/Dockerfile packages/meeting-room/
#
# Run standalone:
#   docker run -d --name vboard-meeting-room \
#     --env-file packages/meeting-room/.env \
#     -p 127.0.0.1:8790:8790 \
#     vboard-meeting-room
# ─────────────────────────────────────────────────────────────────

FROM python:3.11-slim

# ── System deps ───────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Non-root user ─────────────────────────────────────────────────
RUN useradd -u 1000 -m -s /bin/sh vboard
WORKDIR /app

# ── Python deps (cached layer) ────────────────────────────────────
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# ── Source ────────────────────────────────────────────────────────
# Copy the adapters/ tree so internal imports resolve:
#   adapters.meeting_room.council.* etc.
COPY adapters/ ./adapters/

# ── Runtime ───────────────────────────────────────────────────────
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV VBOARD_DATA_ROOT=/workspace
ENV MEETING_ROOM_REQUIRE_TOKEN=true

USER vboard
EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8790/health', timeout=3).read()" || exit 1

CMD ["uvicorn", "adapters.meeting_room.server:app", \
     "--host", "0.0.0.0", "--port", "8790", \
     "--workers", "1", "--log-level", "info"]
