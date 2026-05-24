"""
Unit tests — council/advisors.py
No API keys required.
"""

import pytest
from adapters.meeting_room.council.advisors import (
    ADVISORS, get_advisor, list_advisors, advisors_for_text,
)


# ── Registry completeness ─────────────────────────────────────────────────────

def test_all_default_advisors_present():
    for aid in ("cfo", "cto", "coo", "crm"):
        assert aid in ADVISORS, f"Missing advisor: {aid}"


def test_advisor_has_required_fields():
    required = ("id", "name", "specialty", "color", "voice_id", "triggers")
    for aid, cfg in ADVISORS.items():
        for field in required:
            assert field in cfg, f"Advisor {aid} missing field: {field}"


def test_advisor_colors_are_hex():
    for aid, cfg in ADVISORS.items():
        color = cfg["color"]
        assert color.startswith("#"), f"Advisor {aid} color {color!r} not hex"
        assert len(color) == 7, f"Advisor {aid} color {color!r} wrong length"


def test_advisor_voice_ids_nonempty():
    for aid, cfg in ADVISORS.items():
        assert cfg["voice_id"], f"Advisor {aid} has empty voice_id"


def test_advisor_triggers_nonempty():
    for aid, cfg in ADVISORS.items():
        assert len(cfg["triggers"]) > 0, f"Advisor {aid} has no triggers"


# ── get_advisor ───────────────────────────────────────────────────────────────

def test_get_advisor_returns_config():
    cfo = get_advisor("cfo")
    assert cfo is not None
    assert cfo["id"] == "cfo"
    assert cfo["name"] == "CFO"


def test_get_advisor_unknown_returns_none():
    assert get_advisor("unknown-role") is None


# ── list_advisors ─────────────────────────────────────────────────────────────

def test_list_advisors_returns_all():
    all_advisors = list_advisors()
    assert len(all_advisors) == len(ADVISORS)


# ── advisors_for_text ─────────────────────────────────────────────────────────

def test_advisors_for_text_finance():
    hits = advisors_for_text("the budget is too high, we're burning cash")
    assert "cfo" in hits


def test_advisors_for_text_tech():
    hits = advisors_for_text("the server is down and we need to deploy a fix urgently")
    assert "cto" in hits


def test_advisors_for_text_ops():
    hits = advisors_for_text("the delivery timeline slipped, sprint planning is broken")
    assert "coo" in hits


def test_advisors_for_text_crm():
    hits = advisors_for_text("the hot lead wants a pricing proposal by tomorrow")
    assert "crm" in hits


def test_advisors_for_text_ranked_by_relevance():
    # "budget" + "cash" = 2 cfo triggers; only 1 cto trigger
    hits = advisors_for_text("the budget is tight, cash flow is negative, deploy anyway")
    # CFO should rank higher than CTO
    if "cfo" in hits and "cto" in hits:
        assert hits.index("cfo") < hits.index("cto")


def test_advisors_for_text_no_match_returns_empty():
    hits = advisors_for_text("the sky is blue today")
    assert hits == []


def test_advisors_for_text_limit():
    hits = advisors_for_text(
        "budget invoice deploy server pipeline lead client deal",
        limit=2
    )
    assert len(hits) <= 2


def test_advisors_for_text_case_insensitive():
    hits = advisors_for_text("BUDGET IS TOO HIGH")
    assert "cfo" in hits
