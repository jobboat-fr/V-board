#!/usr/bin/env python3
"""Static security guardrails for the V-Board meeting-room package.

Run from the v-board repo root:
    python packages/meeting-room/scripts/check_meeting_room_security.py

Or from packages/meeting-room/:
    python scripts/check_meeting_room_security.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Support running from repo root or from packages/meeting-room/
_here = Path(__file__).resolve().parent
if (_here.parent.parent.parent / "docker-compose.yml").exists():
    # Running from packages/meeting-room/scripts/
    PKG_ROOT = _here.parent
else:
    # Fallback: assume CWD is packages/meeting-room/
    PKG_ROOT = Path.cwd()


def read(relative: str) -> str:
    return (PKG_ROOT / relative).read_text(encoding="utf-8")


def uncommented_lines(text: str) -> list[str]:
    return [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def main() -> int:
    server    = read("adapters/meeting_room/server.py")
    security  = read("adapters/meeting_room/security.py")
    evidence  = read("adapters/meeting_room/evidence_store.py")
    tavus     = read("adapters/meeting_room/tavus.py")
    dockerfile = read("Dockerfile")
    compose   = read("docker-compose.yml")

    required = {
        "server enforces production token":
            "MEETING_ROOM_REQUIRE_TOKEN" in server and "hmac.compare_digest" in server,

        "server disables docs in production":
            "docs_url=None if is_production_mode()" in server,

        "server caps request body size":
            "MAX_REQUEST_BYTES" in server and "REQUEST_TOO_LARGE" in server,

        "security validates base64 strictly":
            'base64.b64decode(encoded, validate=True)' in security,

        "security rejects path escapes":
            "assert_under_root" in security,

        "evidence uses path containment":
            "security.assert_under_root" in evidence,

        "tavus redacts provider errors":
            "redact_secret" in tavus and "_clean_error" in tavus,

        "tavus requires https base url":
            "Tavus base URL must use https" in tavus,

        "container runs non-root":
            "USER hermes" in dockerfile,

        "container requires auth by default":
            "MEETING_ROOM_REQUIRE_TOKEN=true" in dockerfile,

        "compose binds localhost only":
            '"127.0.0.1:8790:8790"' in compose,

        "compose is read-only":
            "read_only: true" in compose,

        "compose drops linux capabilities":
            "cap_drop:" in compose and "- ALL" in compose,

        "compose prevents privilege escalation":
            "no-new-privileges:true" in compose,
    }

    failures = [name for name, passed in required.items() if not passed]

    for line in uncommented_lines(compose):
        if "0.0.0.0:8790" in line or (":8790:8790" in line and "127.0.0.1" not in line):
            failures.append("compose must not publish meeting-room on a public interface")
            break

    if failures:
        print("Meeting-room security guardrails FAILED:")
        for failure in failures:
            print(f"  FAIL  {failure}")
        return 1

    print(f"Meeting-room security guardrails passed ({len(required)} checks).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
