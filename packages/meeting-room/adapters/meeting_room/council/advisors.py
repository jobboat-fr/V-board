"""
Advisor role definitions for the meeting room council.

Each advisor has:
  - id:          short identifier (used in API calls, voice selection, status badges)
  - name:        display name
  - specialty:   human-readable domain description
  - color:       hex color for UI rendering
  - voice_id:    ElevenLabs voice ID
  - triggers:    keywords that signal this advisor is relevant

These are the four default roles shipped with the OSS contribution.
You can add more advisors by extending ADVISORS below.
"""

from typing import TypedDict
import os


class AdvisorConfig(TypedDict):
    id: str
    name: str
    specialty: str
    color: str
    voice_id: str
    triggers: list[str]


ADVISORS: dict[str, AdvisorConfig] = {
    "cfo": {
        "id":        "cfo",
        "name":      "CFO",
        "specialty": "Finance, ROI & Budget",
        "color":     "#e8b544",   # gold
        "voice_id":  os.getenv("MEETING_VOICE_CFO", "JBFqnCBsd6RMkjVDRZzb"),  # Rachel
        "triggers":  [
            "budget", "cost", "coût", "revenue", "revenu", "invoice", "facture",
            "roi", "margin", "marge", "cash flow", "trésorerie", "burn rate",
            "pricing", "devis", "quote", "bank", "qonto", "dépense", "spend",
        ],
    },
    "cto": {
        "id":        "cto",
        "name":      "CTO",
        "specialty": "Technology, Architecture & Security",
        "color":     "#06b6d4",   # cyan
        "voice_id":  os.getenv("MEETING_VOICE_CTO", "pNInz6obpgDQGcFmaJgB"),  # Adam
        "triggers":  [
            "deploy", "deployment", "infra", "infrastructure", "server", "api",
            "security", "sécurité", "uptime", "incident", "bug", "performance",
            "architecture", "database", "stack", "tech debt", "scalability",
            "cloud", "docker", "kubernetes", "ci/cd",
        ],
    },
    "coo": {
        "id":        "coo",
        "name":      "COO",
        "specialty": "Operations, Execution & Process",
        "color":     "#f97316",   # orange
        "voice_id":  os.getenv("MEETING_VOICE_COO", "AZnzlk1XvdvUeBnXmlld"),  # Domi
        "triggers":  [
            "process", "workflow", "deadline", "timeline", "delivery", "livraison",
            "team", "équipe", "bottleneck", "blocker", "resource", "ressource",
            "capacity", "sprint", "milestone", "okr", "kpi", "execution",
            "planning", "roadmap", "priorit",
        ],
    },
    "crm": {
        "id":        "crm",
        "name":      "CRM",
        "specialty": "Customer Relations & Pipeline",
        "color":     "#22c55e",   # emerald
        "voice_id":  os.getenv("MEETING_VOICE_CRM", "MF3mGyEYCl7XYWbV9V6O"),  # Elli
        "triggers":  [
            "client", "customer", "lead", "prospect", "pipeline", "deal", "close",
            "follow-up", "relance", "churn", "retention", "upsell", "cross-sell",
            "nps", "satisfaction", "onboarding", "support", "crm", "sales",
            "outreach", "cold email", "warm lead", "hot lead",
        ],
    },
    "legal": {
        "id":        "legal",
        "name":      "Legal",
        "specialty": "Compliance, Risk & Contracts",
        "color":     "#8b5cf6",   # violet
        "voice_id":  os.getenv("MEETING_VOICE_LEGAL", "TxGEqnHWrfWFTfGW9XjX"),  # Josh
        "triggers":  [
            "contract", "contrat", "clause", "liability", "responsabilité",
            "compliance", "conformité", "rgpd", "gdpr", "legal", "juridique",
            "terms", "conditions", "nda", "agreement", "ip", "intellectual property",
            "regulation", "audit", "risk", "risque", "warranty", "garantie",
        ],
    },
    "product": {
        "id":        "product",
        "name":      "Product",
        "specialty": "UX, Features & Roadmap",
        "color":     "#ec4899",   # pink
        "voice_id":  os.getenv("MEETING_VOICE_PRODUCT", "EXAVITQu4vr4xnSDxMaL"),  # Bella
        "triggers":  [
            "feature", "fonctionnalité", "ux", "user experience", "design",
            "roadmap", "backlog", "sprint", "user story", "persona",
            "prototype", "wireframe", "a/b test", "mvp", "launch",
            "feedback", "onboarding", "retention", "engagement",
        ],
    },
}


def get_advisor(advisor_id: str) -> AdvisorConfig | None:
    return ADVISORS.get(advisor_id)


def list_advisors() -> list[AdvisorConfig]:
    return list(ADVISORS.values())


def advisors_for_text(text: str, limit: int = 3) -> list[str]:
    """Return advisor IDs most relevant to the given text (by trigger keyword count)."""
    text_lower = text.lower()
    scores = {}
    for aid, cfg in ADVISORS.items():
        score = sum(1 for kw in cfg["triggers"] if kw in text_lower)
        if score > 0:
            scores[aid] = score
    return sorted(scores, key=scores.get, reverse=True)[:limit]
