#!/usr/bin/env python3
"""
agent runtime Token Governor for VBOARD.

Builds compact, structured context files from docs/accounting folders so the
LLM can reason from summaries instead of rereading whole archives.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(os.environ.get("VBOARD_WORKSPACE", os.environ.get("AGENT_RUNTIME_WORKSPACE", "/workspace")))
DOCS = ROOT / "docs"
ACCOUNTING = ROOT / "accounting"
OUT = ROOT / "ops" / "context"
OUT.mkdir(parents=True, exist_ok=True)

MAX_TEXT = 12000


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_read(path: Path, limit: int = MAX_TEXT) -> str:
    suffix = path.suffix.lower()
    try:
        if suffix in {".txt", ".md", ".csv", ".json", ".log", ".env"}:
            return path.read_text(errors="replace")[:limit]
        if suffix == ".docx":
            return read_docx(path)[:limit]
        if suffix == ".xlsx":
            return read_xlsx(path)[:limit]
        if suffix == ".pdf":
            return read_pdf(path)[:limit]
        if suffix == ".zip":
            return list_zip(path)[:limit]
    except Exception as exc:
        return f"[read_error] {type(exc).__name__}: {exc}"
    return ""


def read_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml")
    root = ET.fromstring(xml)
    return " ".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))


def read_xlsx(path: Path) -> str:
    chunks: list[str] = []
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if name.startswith("xl/sharedStrings") or name.startswith("xl/worksheets/sheet"):
                try:
                    root = ET.fromstring(z.read(name))
                    chunks.extend((node.text or "") for node in root.iter() if node.text)
                except Exception:
                    continue
    return " ".join(chunks)


def read_pdf(path: Path) -> str:
    for cmd in (["pdftotext", str(path), "-"], ["strings", str(path)]):
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout
        except Exception:
            pass
    return ""


def list_zip(path: Path) -> str:
    with zipfile.ZipFile(path) as z:
        return "\n".join(z.namelist()[:400])


def category_for(path: Path, text: str) -> str:
    hay = f"{path.as_posix()} {text[:3000]}".lower()
    checks = [
        ("bank_statement", r"relev[ée]|statement|bank|revolut|banque|iban|solde"),
        ("invoice_receipt", r"facture|invoice|receipt|re[cç]u|tva|vat|paid|payment"),
        ("tax_social", r"imp[oô]t|urssaf|dsn|cfe|is\b|tva|fiscal|social"),
        ("payroll", r"paie|payslip|bulletin|salaire|payroll"),
        ("legal_company", r"statuts|kbis|siren|siret|greffe|capital social|sas|afeje"),
        ("contract", r"contrat|contract|signature|agreement|terms"),
        ("strategy_internal", r"whitepaper|framework|azzing|strategy|business plan"),
    ]
    for cat, pattern in checks:
        if re.search(pattern, hay):
            return cat
    return "unknown"


def sensitivity_for(category: str) -> str:
    if category in {"bank_statement", "tax_social", "payroll"}:
        return "highly_confidential"
    if category in {"invoice_receipt", "legal_company", "contract", "strategy_internal"}:
        return "confidential"
    return "internal"


def extract_amounts(text: str) -> list[float]:
    values = []
    for m in re.finditer(r"(?<!\w)(-?\d{1,6}(?:[ .]\d{3})*(?:[,.]\d{2}))\s?(?:€|eur|euro|usd|\$)?", text.lower()):
        raw = m.group(1).replace(" ", "").replace(".", "").replace(",", ".")
        try:
            val = float(raw)
            if 0.5 <= abs(val) <= 1_000_000:
                values.append(round(val, 2))
        except ValueError:
            pass
    return values[:10]


def extract_date(text: str, path: Path) -> str | None:
    hay = f"{path.name} {text[:2000]}"
    m = re.search(r"(20\d{2})[-_/ ]?([01]\d)[-_/ ]?([0-3]\d)", hay)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.search(r"([0-3]\d)[-/ ]([01]\d)[-/ ](20\d{2})", hay)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def vendor_guess(path: Path, text: str) -> str:
    name = re.sub(r"[_\-]+", " ", path.stem)
    name = re.sub(r"\b(20\d{2}|facture|invoice|receipt|recu|statement|releve)\b", "", name, flags=re.I)
    return " ".join(name.split())[:80] or (text.strip().splitlines()[0][:80] if text.strip() else "unknown")


def iter_files() -> list[Path]:
    roots = [p for p in (DOCS, ACCOUNTING) if p.exists()]
    files: list[Path] = []
    for root in roots:
        for p in root.rglob("*"):
            if p.is_file() and not any(part.startswith(".") for part in p.parts):
                files.append(p)
    return sorted(files)


def build_index() -> tuple[list[dict], list[dict]]:
    docs: list[dict] = []
    invoices: list[dict] = []
    for path in iter_files():
        text = safe_read(path)
        category = category_for(path, text)
        rel = str(path.relative_to(ROOT))
        item = {
            "path": rel,
            "name": path.name,
            "size": path.stat().st_size,
            "sha256": sha256(path),
            "category": category,
            "sensitivity": sensitivity_for(category),
            "date": extract_date(text, path),
            "vendor_guess": vendor_guess(path, text),
            "amounts": extract_amounts(text),
            "snippet": " ".join(text.split())[:500],
        }
        docs.append(item)
        if category == "invoice_receipt":
            invoices.append(item)
    return docs, invoices


def parse_transactions() -> list[dict]:
    transactions: list[dict] = []
    for path in ACCOUNTING.rglob("*") if ACCOUNTING.exists() else []:
        if not path.is_file() or path.suffix.lower() not in {".csv", ".txt", ".md"}:
            continue
        text = safe_read(path, 300000)
        if path.suffix.lower() == ".csv":
            transactions.extend(parse_csv_transactions(path, text))
        else:
            transactions.extend(parse_text_transactions(path, text))
    return transactions[:2000]


def parse_csv_transactions(path: Path, text: str) -> list[dict]:
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except Exception:
        dialect = csv.excel
    rows = list(csv.DictReader(text.splitlines(), dialect=dialect))
    out = []
    for row in rows:
        keys = {k.lower(): k for k in row.keys() if k}
        date_key = first_key(keys, ["date", "operation", "booked"])
        amount_key = first_key(keys, ["amount", "montant", "debit", "credit"])
        label_key = first_key(keys, ["label", "libelle", "description", "details", "name"])
        if not amount_key:
            continue
        amount = to_float(row.get(amount_key, ""))
        if amount is None:
            continue
        out.append({
            "source": str(path.relative_to(ROOT)),
            "date": row.get(date_key, "") if date_key else "",
            "amount": amount,
            "label": row.get(label_key, "")[:160] if label_key else "",
        })
    return out


def parse_text_transactions(path: Path, text: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        if not re.search(r"\d{1,2}[/-]\d{1,2}[/-]20\d{2}", line):
            continue
        amounts = extract_amounts(line)
        if amounts:
            out.append({
                "source": str(path.relative_to(ROOT)),
                "date": extract_date(line, path) or "",
                "amount": amounts[-1],
                "label": line[:160],
            })
    return out


def first_key(keys: dict[str, str], needles: list[str]) -> str | None:
    for needle in needles:
        for low, original in keys.items():
            if needle in low:
                return original
    return None


def to_float(value: str) -> float | None:
    if value is None:
        return None
    raw = str(value).replace(" ", "").replace("\u202f", "").replace(",", ".")
    raw = re.sub(r"[^0-9.\-]", "", raw)
    try:
        return round(float(raw), 2)
    except ValueError:
        return None


def match_invoices(transactions: list[dict], invoices: list[dict]) -> tuple[list[dict], list[dict]]:
    matches = []
    missing = []
    for tx in transactions:
        candidates = []
        for inv in invoices:
            score = 0
            if any(abs(abs(tx["amount"]) - abs(a)) <= 0.05 for a in inv["amounts"]):
                score += 60
            label = str(tx.get("label", "")).lower()
            vendor = str(inv.get("vendor_guess", "")).lower()
            if vendor and any(tok in label for tok in vendor.split() if len(tok) > 3):
                score += 25
            if inv.get("date") and tx.get("date") and inv["date"][:7] in str(tx["date"]):
                score += 15
            if score:
                candidates.append((score, inv))
        if candidates:
            score, inv = max(candidates, key=lambda x: x[0])
            matches.append({"transaction": tx, "invoice": inv["path"], "score": score, "confidence": "high" if score >= 75 else "medium"})
        elif tx.get("amount", 0) < 0 or tx.get("amount", 0) > 0:
            missing.append(tx)
    return matches, missing[:100]


def write_outputs(docs: list[dict], invoices: list[dict], transactions: list[dict], matches: list[dict], missing: list[dict]) -> None:
    (OUT / "document_index.json").write_text(json.dumps(docs, ensure_ascii=False, indent=2))
    (OUT / "invoice_candidates.json").write_text(json.dumps(invoices, ensure_ascii=False, indent=2))
    (OUT / "bank_transactions.json").write_text(json.dumps(transactions, ensure_ascii=False, indent=2))
    (OUT / "invoice_matches.json").write_text(json.dumps(matches, ensure_ascii=False, indent=2))
    (OUT / "missing_invoices.json").write_text(json.dumps(missing, ensure_ascii=False, indent=2))
    categories = {}
    for d in docs:
        categories[d["category"]] = categories.get(d["category"], 0) + 1
    lines = [
        "# VBOARD Compact Daily Context",
        f"Generated: {now_iso()}",
        "",
        "## Inventory",
        f"- Documents indexed: {len(docs)}",
        f"- Invoice/receipt candidates: {len(invoices)}",
        f"- Bank transactions parsed: {len(transactions)}",
        f"- Matched invoice transactions: {len(matches)}",
        f"- Transactions still missing proof: {len(missing)}",
        f"- Categories: {categories}",
        "",
        "## Highest Priority Missing Proof",
    ]
    for tx in missing[:20]:
        lines.append(f"- [EST] {tx.get('date','?')} | {tx.get('amount','?')} | {tx.get('label','')[:120]} | source={tx.get('source')}")
    lines += [
        "",
        "## Instructions For LLM",
        "- Use this compact context first. Do not reread raw documents unless owner asks or evidence is missing.",
        "- For legal/accounting conclusions, cite [EMP] from index/matches or mark [EST].",
        "- Send short WhatsApp summaries; save full reports to files.",
        "",
        "## Context Files",
        f"- {OUT / 'document_index.json'}",
        f"- {OUT / 'invoice_candidates.json'}",
        f"- {OUT / 'bank_transactions.json'}",
        f"- {OUT / 'invoice_matches.json'}",
        f"- {OUT / 'missing_invoices.json'}",
    ]
    (OUT / "daily_context.md").write_text("\n".join(lines))


def main() -> None:
    docs, invoices = build_index()
    transactions = parse_transactions()
    matches, missing = match_invoices(transactions, invoices)
    write_outputs(docs, invoices, transactions, matches, missing)
    print(json.dumps({
        "ok": True,
        "documents": len(docs),
        "invoice_candidates": len(invoices),
        "transactions": len(transactions),
        "matches": len(matches),
        "missing_invoice_proofs": len(missing),
        "daily_context": str(OUT / "daily_context.md"),
    }, indent=2))


if __name__ == "__main__":
    main()
