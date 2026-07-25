"""
UZA Build — AI drawing-intelligence adapter (the AI front door).

Turns an uploaded drawing (PDF / image) or a pasted room schedule into a
structured *Drawing Intelligence Report*: detected rooms with geometry and
confidence, plus detected/missing/conflicts/assumptions — exactly the artefact
the spec's section 4.2 requires.

Two modes, behind ONE interface (spec requirement: "build production-grade
adapters and realistic fallback/demo implementations"):

  * LIVE  — calls Claude (claude-opus-4-8, adaptive thinking, vision) when an
            ANTHROPIC_API_KEY (or UZA_ANTHROPIC_API_KEY) is set AND the
            `anthropic` SDK is installed.
  * DEMO  — a deterministic, rules-based extractor that parses a pasted schedule
            or returns a clearly-labelled representative sample.

Every result carries `mode`, `model`, `confidence` and `source` so the platform
never presents an estimate as a verified fact.
"""
from __future__ import annotations

import base64
import json
import math
import os
import re

MODEL = os.environ.get("UZA_AI_MODEL", "claude-opus-4-8")

_MEDIA = {
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
}

SYSTEM = (
    "You are a senior BIM/CAD analyst and quantity surveyor working inside UZA "
    "Build, a construction finishing-materials platform. You extract rooms and "
    "geometry from architectural drawings and schedules. You NEVER fabricate "
    "precise dimensions: when a value is not readable, you estimate it and lower "
    "the confidence. Every room gets a confidence in [0,1]."
)

SCHEMA_HINT = (
    'Return ONLY a JSON object, no prose, of exactly this shape:\n'
    '{\n'
    '  "rooms": [{"name": str, "floor": str, "area_m2": number, '
    '"perimeter_m": number, "height_m": number, "opening_area_m2": number, '
    '"confidence": number}],\n'
    '  "detected": [str],   // information you could read/derive\n'
    '  "missing": [str],    // information not present that a QS would need\n'
    '  "conflicts": [str],  // contradictions or ambiguities to flag for review\n'
    '  "assumptions": [str] // assumptions you made to produce estimates\n'
    '}'
)


def live_available() -> bool:
    return bool(_api_key())


def _api_key() -> str | None:
    return os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("UZA_ANTHROPIC_API_KEY")


def analyze(filename: str = "", data: bytes | None = None, text: str = "") -> dict:
    """Return a Drawing Intelligence Report (see module docstring)."""
    if live_available():
        try:
            return _analyze_live(filename, data, text)
        except Exception as e:  # graceful degradation — spec 5. "graceful degradation"
            report = _analyze_demo(filename, text)
            report["mode"] = "demo-fallback"
            report["note"] = f"Live AI unavailable ({e.__class__.__name__}); used rules-based extraction."
            return report
    return _analyze_demo(filename, text)


# --------------------------------------------------------------------------- #
# LIVE — Claude
# --------------------------------------------------------------------------- #
def _analyze_live(filename: str, data: bytes | None, text: str) -> dict:
    import anthropic  # lazy: optional dependency

    client = anthropic.Anthropic(api_key=_api_key())
    content: list[dict] = []

    ext = os.path.splitext(filename)[1].lower()
    media = _MEDIA.get(ext)
    if data and media == "application/pdf":
        content.append({"type": "document", "source": {
            "type": "base64", "media_type": media,
            "data": base64.standard_b64encode(data).decode()}})
    elif data and media and media.startswith("image/"):
        content.append({"type": "image", "source": {
            "type": "base64", "media_type": media,
            "data": base64.standard_b64encode(data).decode()}})

    ask = "Analyse the attached drawing" if data else "Analyse this room schedule / brief"
    if text:
        ask += f":\n\n{text}"
    content.append({"type": "text", "text":
                    f"{ask}\n\nExtract every room and its finishing geometry.\n{SCHEMA_HINT}"})

    resp = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=SYSTEM,
        messages=[{"role": "user", "content": content}],
    )
    raw = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    report = _coerce(_parse_json(raw))
    report["mode"] = "live"
    report["model"] = MODEL
    report["source"] = "drawing-extracted"
    report["confidence"] = _overall(report["rooms"])
    return report


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(json)?", "", raw).rstrip("`").strip()
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            return json.loads(m.group(0))
        raise ValueError("Model did not return parseable JSON")


# --------------------------------------------------------------------------- #
# DEMO — deterministic, rules-based
# --------------------------------------------------------------------------- #
_LINE = re.compile(
    r"^\s*(?:[-*\d.]+\s+)?(?P<name>[A-Za-z][A-Za-z0-9 /&'-]+?)[\s:=-]+"
    r"(?P<area>\d+(?:\.\d+)?)\s*(?:m2|m²|sqm|sq\.?\s?m)?\s*$",
    re.I)

_SAMPLE = [
    ("Living / Dining", "Ground", 30.0), ("Kitchen", "Ground", 11.0),
    ("Master Bedroom", "Ground", 17.0), ("Bathroom", "Ground", 5.0),
    ("Bedroom 2", "Ground", 13.0),
]


def _room_from(name: str, floor: str, area: float, conf: float) -> dict:
    # square-room approximation for perimeter; standard ceiling; 15% openings
    perimeter = round(4 * math.sqrt(max(area, 0.1)) * 1.05, 1)
    height = 2.9
    opening = round(0.15 * perimeter * height, 1)
    return {"name": name.strip().title(), "floor": floor, "area_m2": round(area, 1),
            "perimeter_m": perimeter, "height_m": height,
            "opening_area_m2": opening, "confidence": conf}


def _analyze_demo(filename: str, text: str) -> dict:
    rooms, parsed = [], 0
    for line in (text or "").splitlines():
        m = _LINE.match(line)
        if m:
            rooms.append(_room_from(m.group("name"), "Ground", float(m.group("area")), 0.62))
            parsed += 1

    if not rooms:
        rooms = [_room_from(n, f, a, 0.55) for n, f, a in _SAMPLE]
        detected = ["Demonstration extraction — no readable schedule supplied."]
        missing = ["Actual drawings/dimensions. This is representative sample data."]
    else:
        detected = [f"Parsed {parsed} room name(s) with areas from the pasted schedule."]
        missing = ["Perimeters, ceiling heights and door/window openings were not "
                   "provided — estimated from area assuming square rooms."]

    return {
        "rooms": rooms,
        "detected": detected,
        "missing": missing,
        "conflicts": [],
        "assumptions": ["Square-room perimeter approximation (4·√area · 1.05)",
                        "2.9 m floor-to-ceiling height", "15% wall openings deduction"],
        "mode": "demo",
        "model": "uza-rules-based-extractor",
        "source": "estimated",
        "confidence": _overall(rooms),
    }


# --------------------------------------------------------------------------- #
# shared
# --------------------------------------------------------------------------- #
def _coerce(d: dict) -> dict:
    rooms = []
    for r in d.get("rooms", []):
        try:
            rooms.append({
                "name": str(r.get("name", "Room")).strip()[:60] or "Room",
                "floor": str(r.get("floor", "Ground"))[:20] or "Ground",
                "area_m2": round(float(r.get("area_m2", 0)), 2),
                "perimeter_m": round(float(r.get("perimeter_m") or 4 * math.sqrt(max(float(r.get("area_m2", 1)), 0.1))), 2),
                "height_m": round(float(r.get("height_m") or 2.9), 2),
                "opening_area_m2": round(float(r.get("opening_area_m2") or 0), 2),
                "confidence": max(0.0, min(1.0, float(r.get("confidence", 0.7)))),
            })
        except (TypeError, ValueError):
            continue
    return {
        "rooms": rooms,
        "detected": [str(x) for x in d.get("detected", [])][:20],
        "missing": [str(x) for x in d.get("missing", [])][:20],
        "conflicts": [str(x) for x in d.get("conflicts", [])][:20],
        "assumptions": [str(x) for x in d.get("assumptions", [])][:20],
    }


def _overall(rooms: list[dict]) -> float:
    if not rooms:
        return 0.0
    return round(sum(r["confidence"] for r in rooms) / len(rooms), 2)
