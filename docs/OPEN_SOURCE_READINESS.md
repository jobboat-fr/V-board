# Open Source Readiness

V-Board should feel installable, inspectable, and safe in the first ten minutes.

## Current Baseline

- Root npm workspace install works.
- Ops-core tests pass.
- Council syntax and hardening checks pass.
- Meeting-room pytest suite passes without real provider keys.
- Meeting-room security guardrails pass.
- Provider names and private deployment names are removed from the public core.
- `dev/AUTHOR` is the only place reserved for the original author/company attribution.

## Next Release Gates

Before tagging `v0.1.0`:

- Add JSON schemas for route decisions, work orders, evidence records, provider configs, and meeting events.
- Add a Docker no-key demo profile with seeded fixtures.
- Add issue templates and PR template.
- Add changelog.
- Add a release workflow.
- Add adapter examples in an `examples/providers/` directory.
- Add dashboard screenshots or a local dashboard walkthrough.

## Quality Bar

A contributor should be able to run:

```bash
npm install
npm test --workspaces --if-present
npm run demo:meeting
```

A maintainer should be able to trust:

- no hardcoded private infrastructure
- no committed secrets
- no provider lock-in in core logic
- deterministic safety gates before model calls
- CI coverage for the main operational invariants