# Contributing to V-Board

## Before You Open a PR

1. Run the full test suite locally:
   ```bash
   cd packages/ops-core && npm test && npm run doctor
   cd packages/council && npm run check
   ```

2. The CI will fail if any of these are violated:
   - `council_may_send` is ever `true` in source code
   - A hardcoded phone number (`+336`, `+337`) appears in any `.js`, `.sh`, `.py`, or `.md`
   - A private server IP (`187.127.`, `57.130.58.`, etc.) appears in any code file
   - A committed secret is detected in `.env` files

3. All new routing decisions must pass the 9-fixture doctor grid.
   Add a new fixture if you add a new category.

## Secret Management

- Secrets go in `.env` (never committed) — see `.env.example` in each package
- Server env files live in `/etc/azzco-council.env` and `/etc/azzco-ops-core.env`
- API keys go in `.secrets/api_keys.json` (never committed, `chmod 600`)

## The `council_may_send: false` Invariant

This is non-negotiable. council never sends email, WhatsApp, Telegram, or writes CRM. It prepares and returns a recommendation only. This is enforced in:
- `packages/ops-core/src/core/routePolicy.js` — `policy.council_may_send` always false
- `packages/ops-core/tests/run.js` — `testCouncilMaySendInvariant()` test
- `.github/workflows/ci.yml` — `security-scan` job blocks merge if violated

Do not modify this invariant. If you have a use case that seems to require council to send, open an issue first.

## Code Style

- Node.js ≥ 20, CommonJS (`"use strict"`)
- No external dependencies in ops-core (only `winston`)
- Error handling: fail loudly in tests, fail gracefully in production (return `{ ok: false, error: "..." }`)
- Evidence tagging: use `[EMP]` for observed facts, `[EST]` for inference in all report output

## Opening an Issue

Include:
- Which package (`ops-core`, `council`, `runner`)
- What you expected vs what happened
- The route classification output if relevant (`npm run doctor`)
