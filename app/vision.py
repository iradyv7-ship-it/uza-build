"""
UZA Build — Client Vision Engine.

Turns a client's brief (style, budget band, priorities) into complete,
complementary finishing SOLUTION SCHEMES drawn from the solutions library.

Deliberately rules-based and fully explainable: every pick carries a
human-readable rationale, and nothing is priced here — scheme totals are
indicative budget estimates; real prices are locked per project via RFQ.
"""
from __future__ import annotations

from . import boq, db

STYLES = {
    "warm-minimal": {
        "label": "Warm minimal",
        "blurb": "Calm warm neutrals, matte surfaces, nothing shouting.",
        "chips": ["#d9c7a3", "#cdb7a1", "#b58b57", "#f7f6f2"],
    },
    "modern-luxe": {
        "label": "Modern luxe",
        "blurb": "Deep contrasts, polished stone looks, statement fittings.",
        "chips": ["#4a4f55", "#eceae4", "#222222", "#3b3f43"],
    },
    "natural-organic": {
        "label": "Natural & organic",
        "blurb": "Wood, sage and clay — textures that feel grown, not made.",
        "chips": ["#b58b57", "#9fae94", "#cdb7a1", "#a89a88"],
    },
    "bright-classic": {
        "label": "Bright classic",
        "blurb": "Crisp whites, gloss ceramic, timeless and easy to live with.",
        "chips": ["#f4f4f0", "#ffffff", "#fbfbf9", "#f0f2f2"],
    },
}
BANDS = ["economy", "standard", "premium"]
PRIORITIES = {
    "durability":      "Durability first",
    "low_maintenance": "Easy to maintain",
    "speed":           "Fast delivery",
    "local":           "Locally sourced",
}

WARM_NAMES = ("beige", "oak", "clay", "warm", "sand", "natural")
LUXE_NAMES = ("marble", "carrara", "charcoal", "black", "anthracite", "graphite")
ORGANIC_NAMES = ("oak", "sage", "clay", "natural", "wood")
BRIGHT_NAMES = ("white", "gloss")
EASY_CARE = ("porcelain", "pvc", "spc", "melamine", "ceramic", "aluminium")


def _rgb(hexcode: str):
    h = (hexcode or "#cccccc").lstrip("#")
    try:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except Exception:
        return 204, 204, 204


def _temp(swatch: str) -> str:
    r, g, b = _rgb(swatch)
    d = r - b
    return "warm" if d > 14 else ("cool" if d < -8 else "neutral")


def _lum(swatch: str) -> float:
    r, g, b = _rgb(swatch)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _style_score(style: str, p: dict) -> tuple[float, list[str]]:
    name = (p["name"] or "").lower()
    finish = (p["finish"] or "").lower()
    temp, lum = _temp(p["swatch"]), _lum(p["swatch"])
    s, why = 0.0, []
    if style == "warm-minimal":
        if temp in ("warm", "neutral") and lum > 95:
            s += 3; why.append("warm neutral tone")
        if any(f in finish for f in ("matte", "matt", "brushed", "veneer", "melamine")):
            s += 2; why.append("matte / soft finish")
        if any(n in name for n in WARM_NAMES):
            s += 1
    elif style == "modern-luxe":
        if lum < 95 or any(f in finish for f in ("polished", "gloss", "powder")):
            s += 3; why.append("deep tone / polished finish")
        if any(n in name for n in LUXE_NAMES):
            s += 2; why.append("statement material")
    elif style == "natural-organic":
        if any(n in name for n in ORGANIC_NAMES):
            s += 3; why.append("natural material feel")
        if temp == "warm" or any(f in finish for f in ("brushed", "matte", "matt")):
            s += 2; why.append("organic texture")
    elif style == "bright-classic":
        if lum > 200:
            s += 3; why.append("bright, light-filled tone")
        if any(n in name for n in BRIGHT_NAMES) or "gloss" in finish:
            s += 2; why.append("classic gloss ceramic")
    return s, why


def _band_score(band: str, p: dict, ranked: list[int]) -> tuple[float, list[str]]:
    """ranked: product ids of this category ordered cheapest -> priciest."""
    if len(ranked) <= 1:
        return 1.0, []
    pos = ranked.index(p["id"]) / (len(ranked) - 1)          # 0 cheap .. 1 premium
    target = {"economy": 0.0, "standard": 0.5, "premium": 1.0}[band]
    s = 2.0 * (1.0 - abs(pos - target))
    why = []
    if band == "economy" and pos <= 0.34:
        why.append("strong value")
    if band == "premium" and pos >= 0.66:
        why.append("premium grade")
    return s, why


def _priority_score(prios: list[str], p: dict) -> tuple[float, list[str]]:
    s, why = 0.0, []
    name = (p["name"] or "").lower()
    if "durability" in prios and p.get("standards"):
        s += 1.5; why.append(f"certified ({p['standards'].split(',')[0].strip()})")
    if "low_maintenance" in prios and any(m in name for m in EASY_CARE):
        s += 1.5; why.append("easy-care surface")
    if "speed" in prios and (p.get("lead_time_days") or 99) <= 25:
        s += 1.5; why.append(f"{p['lead_time_days']}-day lead")
    if "local" in prios and p.get("source") == "local":
        s += 1.5; why.append("locally sourced")
    return s, why


def propose_schemes(project_id: int, brief: dict) -> list[dict]:
    """Return 3 complete schemes: best match, smart value, elevated."""
    products = db.query(
        "SELECT p.*, m.name AS manufacturer FROM products p "
        "LEFT JOIN manufacturers m ON m.id=p.manufacturer_id WHERE p.status='approved'")
    rooms = db.query("SELECT * FROM rooms WHERE project_id=?", (project_id,))
    # categories actually used in this project (from existing selections)
    cats = [r["category"] for r in db.query(
        """SELECT DISTINCT s.category FROM selections s
           JOIN rooms r ON r.id=s.room_id WHERE r.project_id=?""", (project_id,))]
    by_cat: dict[str, list[dict]] = {}
    for p in products:
        if p["category"] in cats:
            by_cat.setdefault(p["category"], []).append(p)
    ranked = {c: [p["id"] for p in sorted(ps, key=lambda x: x["unit_price"])]
              for c, ps in by_cat.items()}
    prios = [x for x in (brief.get("priorities") or "").split(",") if x]

    def build(band: str, key: str, label: str, tagline: str) -> dict:
        picks, anchor_temp = {}, None
        # anchor on the floor: the largest visual surface sets the palette
        order = sorted(by_cat.keys(), key=lambda c: 0 if c == "floor" else 1)
        for cat in order:
            best, best_s, best_why = None, -1.0, []
            for p in by_cat[cat]:
                s1, w1 = _style_score(brief["style"], p)
                s2, w2 = _band_score(band, p, ranked[cat])
                s3, w3 = _priority_score(prios, p)
                s, why = s1 + s2 + s3, w1 + w2 + w3
                if anchor_temp and _temp(p["swatch"]) == anchor_temp:
                    s += 1.0; why = why + ["harmonises with the floor"]
                if s > best_s:
                    best, best_s, best_why = p, s, why
            if cat == "floor" and best:
                anchor_temp = _temp(best["swatch"])
            picks[cat] = {
                "product_id": best["id"], "code": best["code"], "name": best["name"],
                "swatch": best["swatch"], "finish": best["finish"], "unit": best["unit"],
                "unit_price": best["unit_price"], "manufacturer": best["manufacturer"],
                "lead_time_days": best["lead_time_days"], "source": best["source"],
                "score": round(best_s, 1),
                "rationale": ", ".join(dict.fromkeys(best_why)) or "best overall fit",
            }
        # indicative estimate: apply picks over the rooms that use each category
        total, max_lead = 0.0, 0
        for room in rooms:
            room_cats = [s["category"] for s in db.query(
                "SELECT category FROM selections WHERE room_id=?", (room["id"],))]
            for cat in room_cats:
                if cat in picks:
                    prod = next(p for p in by_cat[cat] if p["id"] == picks[cat]["product_id"])
                    line = boq.compute_line(room, prod, source="estimated", confidence=0.85)
                    total += line.amount
                    max_lead = max(max_lead, prod["lead_time_days"] or 0)
        return {"key": key, "label": label, "tagline": tagline, "band": band,
                "picks": picks, "estimate": round(total, 2), "lead_time_days": max_lead}

    band = brief.get("budget_band", "standard")
    down = BANDS[max(0, BANDS.index(band) - 1)]
    up = BANDS[min(2, BANDS.index(band) + 1)]
    schemes = [
        build(band, "best", "Best match",
              f"Truest to your {STYLES[brief['style']]['label']} brief."),
        build(down, "value", "Smart value",
              "The same design intent, engineered for budget."),
        build(up, "elevated", "Elevated",
              "Where spending a little more visibly shows."),
    ]
    # de-duplicate identical schemes (small library edge case)
    seen, out = set(), []
    for s in schemes:
        sig = tuple(sorted((c, v["product_id"]) for c, v in s["picks"].items()))
        if sig not in seen:
            seen.add(sig); out.append(s)
    return out
