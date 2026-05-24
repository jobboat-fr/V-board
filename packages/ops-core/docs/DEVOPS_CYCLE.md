# DevOps Cycle

This is the cycle before any push/deploy.

## Local

```bash
npm test
npm run doctor
```

## Build

```bash
docker build -t vboard/ops-core:local .
```

## Deploy Shape

Recommended:

1. Push to GitHub.
2. CI runs syntax, tests, doctor.
3. Build Docker image.
4. Deploy to front desk/back office with separate env files.
5. Run smoke test:
   - `/health`
   - `/v1/route` cold case
   - `/v1/route` hot case
   - MCP `tools/list`

## Release Gates

Do not release if:

- routing tests fail
- file path traversal guard fails
- API auth is not configured in production
- back office bridge token is missing on back office-required flows
- hot mail returns auto-send
- back office is able to send external communications

## Production Monitors

Create recurring checks for:

- health endpoint
- route policy examples
- bridge connectivity
- work-order write/read
- cron failure count
- provider spend
