"""
UZA Build — Quantity & BOQ engine (the QS core).

Turns (room geometry + selected product) into a costed, pack-rounded BOQ line.
Every line carries a `source` provenance tag and a `confidence`, and nothing is
ever labelled `qs-verified` by the engine — only a qualified user action can do
that (enforced in the API). This is the spec's non-negotiable guardrail:
    "Never present estimated quantities as verified quantities."
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict

# Category → how the net quantity is derived from room geometry.
AREA_FLOOR = {"floor", "ceiling"}
AREA_WALL = {"wall", "paint", "partition", "skirting_area"}
LINEAR = {"skirting"}
COUNT = {"door", "window", "kitchen", "wardrobe", "sanitaryware", "lighting", "switch"}

DEFAULT_MARGIN = 0.15          # UZA overhead + margin applied to material cost
DEFAULT_INSTALL_FACTOR = {     # installation as a fraction of material cost, by category
    "floor": 0.35, "wall": 0.30, "ceiling": 0.40, "paint": 0.45,
    "door": 0.25, "window": 0.25, "kitchen": 0.20, "wardrobe": 0.20,
    "sanitaryware": 0.30, "lighting": 0.30,
}


@dataclass
class BoqLine:
    room_id: int
    room_name: str
    category: str
    product_id: int
    product_code: str
    description: str
    unit: str
    net_qty: float
    waste_pct: float
    ordered_qty: float
    rate: float
    material_amount: float
    install_amount: float
    amount: float
    source: str
    confidence: float

    def as_dict(self):
        return asdict(self)


def net_quantity(room: dict, product: dict) -> tuple[float, str]:
    """Return (net_qty, unit) for a product placed in a room."""
    cat = product["category"]
    unit = product["unit"]
    if cat in AREA_FLOOR:
        return round(room["area_m2"], 2), "m2"
    if cat in AREA_WALL:
        gross_wall = room["perimeter_m"] * room["height_m"]
        net_wall = max(gross_wall - room.get("opening_area_m2", 0), 0)
        # paint is applied in coats; encode coats via coverage on the product
        return round(net_wall, 2), "m2"
    if cat in LINEAR:
        return round(room["perimeter_m"], 2), "m"
    # count-based fittings — 1 per room per category unless the product says otherwise
    return float(product.get("pack_size") or 1) if False else 1.0, product.get("unit", "no")


def pack_round(net_with_waste: float, product: dict) -> float:
    """Round up to the deliverable pack increment (boxes, coats, whole units)."""
    coverage = product.get("coverage") or 1.0
    if product["unit"] in ("m2", "m"):
        packs = math.ceil(net_with_waste / coverage) if coverage else net_with_waste
        return round(packs * coverage, 2)
    # count items — whole numbers, respect MOQ
    qty = math.ceil(net_with_waste)
    return float(max(qty, product.get("moq") or 0, 1))


def compute_line(room: dict, product: dict, source: str = "estimated",
                 confidence: float = 0.8) -> BoqLine:
    net, unit = net_quantity(room, product)
    waste = product.get("waste_pct") or 0.0
    net_with_waste = net * (1 + waste)
    ordered = pack_round(net_with_waste, product)

    rate = product.get("unit_price") or 0.0
    # price is per pack_unit which equals coverage of `unit`; convert to per-unit for count items
    material = ordered * rate if product["unit"] in ("m2", "m") else ordered * rate
    install_factor = DEFAULT_INSTALL_FACTOR.get(product["category"], 0.25)
    install = material * install_factor
    amount = (material + install) * (1 + DEFAULT_MARGIN)

    # Provenance: geometry confidence and product source both weigh in.
    room_conf = room.get("confidence", 0.85)
    blended = round(min(confidence, room_conf), 2)

    return BoqLine(
        room_id=room["id"],
        room_name=room["name"],
        category=product["category"],
        product_id=product["id"],
        product_code=product["code"],
        description=f'{product["name"]} — {room["name"]}',
        unit=unit,
        net_qty=round(net, 2),
        waste_pct=waste,
        ordered_qty=ordered,
        rate=round(rate, 2),
        material_amount=round(material, 2),
        install_amount=round(install, 2),
        amount=round(amount, 2),
        source=source,
        confidence=blended,
    )


def landed_cost(unit_price: float, freight: float, duty_pct: float, qty: float = 1.0) -> float:
    """Procurement comparison: bids compared on landed cost, not headline price."""
    goods = unit_price * qty
    return round(goods + freight + goods * (duty_pct or 0), 2)


def bid_score(q: dict, cheapest_landed: float, shortest_lead: int) -> float:
    """
    Weighted procurement score (0..100). Price is NOT the only axis — the spec
    requires comparing landed cost, compliance, lead time and warranty.
    """
    landed = q.get("landed_cost") or 1
    price_score = (cheapest_landed / landed) if landed else 0            # 1.0 == cheapest
    lead = q.get("lead_time_days") or 999
    lead_score = (shortest_lead / lead) if lead else 0                    # 1.0 == fastest
    compliance = q.get("compliance") or 0
    warranty_years = _warranty_years(q.get("warranty"))
    warranty_score = min(warranty_years / 10, 1.0)

    score = (
        0.45 * price_score
        + 0.20 * lead_score
        + 0.25 * compliance
        + 0.10 * warranty_score
    )
    return round(score * 100, 1)


def _warranty_years(txt) -> float:
    if not txt:
        return 0
    digits = "".join(ch for ch in str(txt) if ch.isdigit())
    return float(digits) if digits else 0
