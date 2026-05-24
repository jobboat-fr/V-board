# ── runner — cron agent executor ─────────────────────────────────────────────
# Node 20 + Python 3 + supercronic (reliable cron replacement for containers)
FROM node:20-alpine AS base

# Install Python 3, curl, and supercronic
RUN apk add --no-cache python3 py3-pip curl bash && \
    curl -fsSL https://github.com/aptible/supercronic/releases/download/v0.2.29/supercronic-linux-amd64 \
      -o /usr/local/bin/supercronic && \
    chmod +x /usr/local/bin/supercronic

WORKDIR /workspace

# Copy runner scripts
COPY bin/ ./bin/
COPY token_governor.py ./
COPY run_delegated_job.sh ./

# Make shell and node scripts executable
RUN chmod +x run_delegated_job.sh bin/*.sh 2>/dev/null || true

# Default crontab — operators override via VBOARD_CRONTAB_FILE or mount a file
# Format: standard cron (minute hour dom month dow command)
# Example: runs morning brief at 07:30 and 17:30 UTC every day
COPY crontab.example /etc/vboard-crontab.example

# Workspace volume — shared with ops-core and council containers
VOLUME ["/workspace"]

ENV VBOARD_WORKSPACE=/workspace \
    VBOARD_COUNCIL_URL=http://council:8787/route \
    NODE_PATH=/workspace/bin

# Entry point: supercronic reads the crontab file from VBOARD_CRONTAB_FILE
# Operators mount their crontab at /etc/vboard-crontab or set VBOARD_CRONTAB_FILE
CMD ["sh", "-c", "supercronic ${VBOARD_CRONTAB_FILE:-/etc/vboard-crontab}"]
