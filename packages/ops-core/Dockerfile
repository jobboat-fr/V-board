# ── ops-core — routing gate, MCP server, HTTP API ───────────────────────────
FROM node:20-alpine AS base
WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source + docs
COPY src/ ./src/
COPY docs/ ./docs/
COPY .env.example .env.example

# Data directory owned by node user
RUN mkdir -p /data/ops/logs && chown -R node:node /data

USER node

EXPOSE 8788

ENV NODE_ENV=production \
    VBOARD_API_HOST=0.0.0.0 \
    VBOARD_API_PORT=8788 \
    VBOARD_DATA_ROOT=/data \
    VBOARD_COUNCIL_URL=http://council:8787/route

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8788/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "src/cli.js", "api"]
