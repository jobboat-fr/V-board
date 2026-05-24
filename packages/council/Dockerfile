# ── council — AI analysis / hard-work engine ─────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy source and scripts
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY .env.example .env.example

# Workspace mount point (read-only in council)
RUN mkdir -p /workspace && chown -R node:node /workspace

USER node

EXPOSE 8787

ENV NODE_ENV=production \
    AZZCO_COUNCIL_HOST=0.0.0.0 \
    AZZCO_COUNCIL_PORT=8787

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8787/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
