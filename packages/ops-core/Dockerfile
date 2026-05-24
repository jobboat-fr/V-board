FROM node:24-alpine

WORKDIR /app
COPY package.json package.json
COPY src src
COPY docs docs
COPY .env.example .env.example

ENV NODE_ENV=production
ENV AZZCO_API_HOST=0.0.0.0
ENV AZZCO_API_PORT=8788
ENV AZZCO_DATA_ROOT=/var/lib/azzco-ops-core

VOLUME ["/var/lib/azzco-ops-core"]

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/cli.js", "api"]
