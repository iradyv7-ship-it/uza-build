"""
UZA Build — API + static host (FastAPI).

Run:  uvicorn app.main:app --reload
The SPA in /web is served at "/".  All data endpoints live under /api.
"""
from __future__ import annotations

import csv
import io
import os
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import ai, auth, boq, db, seed, vision

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")

app = FastAPI(title="UZA Build", version="0.1.0")


# --------------------------------------------------------------------------- #
# Boot: seed on first run
# --------------------------------------------------------------------------- #
@app.on_event("startup")
def _boot():
    if not os.path.exists(db.DB_PATH):
        seed.seed(reset=True)


@app.get("/healthz")
def healthz():
    """Deployment health check (used by Render / uptime monitors)."""
    return {"ok": True, "app": "uza-build"}


def current_user(request: Request) -> Optional[dict]:
    token = request.headers.get("authorization", "").replace("Bearer ", "").strip()
    if not token:
        token = request.cookies.get("uza_token", "")
    return auth.user_from_token(token)


def require(request: Request) -> dict:
    u = current_user(request)
    if not u:
        raise HTTPException(401, "Authentication required")
    return u


def public_user(u: dict) -> dict:
    return {
        "id": u["id"], "name": u["name"], "email": u["email"],
        "role": u["role"], "title": u["title"],
        "role_label": auth.ROLES.get(u["role"], {}).get("label", u["role"]),
        "caps": sorted(auth.ROLES.get(u["role"], {}).get("caps", set())),
        "internal_cost": auth.can_see_internal_cost(u),
    }


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
@app.post("/api/login")
async def login(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    user = db.one("SELECT * FROM users WHERE lower(email)=?", (email,))
    if not user or not auth.verify_password(password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = auth.make_token(user["id"])
    resp = JSONResponse({"token": token, "user": public_user(user)})
    resp.set_cookie("uza_token", token, httponly=True, samesite="lax",
                    secure=bool(os.environ.get("RENDER") or os.environ.get("UZA_HTTPS")))
    return resp


@app.get("/api/me")
def me(request: Request):
    return public_user(require(request))


@app.get("/api/roles")
def roles():
    return [
        {"role": r, "label": v["label"],
         "email": db.one("SELECT email FROM users WHERE role=? LIMIT 1", (r,))}
        for r, v in auth.ROLES.items()
        if db.one("SELECT 1 FROM users WHERE role=? LIMIT 1", (r,))
    ]


# --------------------------------------------------------------------------- #
# Projects / rooms
# --------------------------------------------------------------------------- #
@app.get("/api/projects")
def projects(request: Request):
    require(request)
    return db.query("SELECT * FROM projects ORDER BY id")


@app.get("/api/projects/{pid}")
def project(pid: int, request: Request):
    require(request)
    p = db.one("SELECT * FROM projects WHERE id=?", (pid,))
    if not p:
        raise HTTPException(404, "Project not found")
    p["rooms"] = db.query("SELECT * FROM rooms WHERE project_id=? ORDER BY id", (pid,))
    p["stats"] = _project_stats(pid)
    return p


def _project_stats(pid: int) -> dict:
    rooms = db.query("SELECT * FROM rooms WHERE project_id=?", (pid,))
    lines = _live_boq(pid)
    total = round(sum(l["amount"] for l in lines), 2)
    verified = [l for l in lines if l["source"] == "qs-verified"]
    return {
        "rooms": len(rooms),
        "selections": db.one(
            "SELECT COUNT(*) c FROM selections s JOIN rooms r ON r.id=s.room_id WHERE r.project_id=?",
            (pid,))["c"],
        "boq_lines": len(lines),
        "boq_total": total,
        "verified_pct": round(100 * len(verified) / len(lines)) if lines else 0,
        "budget_used_pct": None,
    }


def _variant(vid):
    return db.one("SELECT * FROM product_variants WHERE id=?", (vid,)) if vid else None


def _apply_variant(prod: dict, var: dict | None) -> dict:
    """Resolve a variant into the product before pricing/visualising it."""
    if not var:
        return prod
    p = dict(prod)
    p["unit_price"] = round((prod["unit_price"] or 0) * (var["price_factor"] or 1.0), 2)
    p["name"] = f"{prod['name']} · {var['label']}"
    if var.get("swatch"):
        p["swatch"] = var["swatch"]
        p["color"] = var["label"]
    return p


# --------------------------------------------------------------------------- #
# Document register — versioned project documents + review workflow
# --------------------------------------------------------------------------- #
DOCS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "docs")
DOC_KINDS = ("drawing", "specification", "boq", "contract", "site-report", "other")
DOC_REVIEW_ROLES = ("qs", "engineer", "director", "super_admin")


@app.get("/api/projects/{pid}/documents")
def list_documents(pid: int, request: Request):
    require(request)
    return db.query(
        """SELECT d.*, u.name AS uploaded_by_name FROM documents d
           LEFT JOIN users u ON u.id=d.uploaded_by
           WHERE d.project_id=? ORDER BY d.id DESC""", (pid,))


@app.post("/api/projects/{pid}/documents")
async def upload_document(pid: int, request: Request,
                          file: UploadFile = File(...),
                          title: str = Form(...), kind: str = Form("drawing"),
                          note: str = Form("")):
    user = require(request)
    if user["role"] == "manufacturer":
        raise HTTPException(403, "Suppliers submit documents through their own portal")
    if kind not in DOC_KINDS:
        raise HTTPException(400, "Unknown document kind")
    title = title.strip()[:200] or file.filename
    data = await file.read()
    if len(data) > 40 * 1024 * 1024:
        raise HTTPException(400, "File too large (40 MB max)")
    # versioning: same title+kind supersedes the previous revision
    prev = db.one(
        "SELECT * FROM documents WHERE project_id=? AND title=? AND kind=? AND status!='superseded' ORDER BY version DESC LIMIT 1",
        (pid, title, kind))
    version = (prev["version"] + 1) if prev else 1
    if prev:
        db.execute("UPDATE documents SET status='superseded' WHERE id=?", (prev["id"],))
    os.makedirs(DOCS_DIR, exist_ok=True)
    safe = "".join(ch for ch in (file.filename or "file") if ch.isalnum() or ch in "._-")[:120]
    did = db.execute(
        """INSERT INTO documents(project_id,title,kind,filename,stored_as,size_bytes,version,note,uploaded_by)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (pid, title, kind, file.filename, "", len(data), version, note.strip()[:500], user["id"]))
    stored = f"doc_{did}_{safe}"
    with open(os.path.join(DOCS_DIR, stored), "wb") as f:
        f.write(data)
    db.execute("UPDATE documents SET stored_as=? WHERE id=?", (stored, did))
    db.audit(pid, user["id"], "document.submitted",
             f"{title} (v{version}, {kind}) — awaiting review" + (f" · supersedes v{prev['version']}" if prev else ""))
    return {"id": did, "version": version}


@app.get("/api/documents/{did}/download")
def download_document(did: int, request: Request):
    require(request)
    doc = db.one("SELECT * FROM documents WHERE id=?", (did,))
    if not doc or not doc["stored_as"]:
        raise HTTPException(404, "Document not found")
    path = os.path.join(DOCS_DIR, doc["stored_as"])
    if not os.path.exists(path):
        raise HTTPException(404, "Stored file missing")
    return FileResponse(path, filename=doc["filename"] or doc["stored_as"])


@app.post("/api/documents/{did}/status")
async def set_document_status(did: int, request: Request):
    user = require(request)
    if user["role"] not in DOC_REVIEW_ROLES:
        raise HTTPException(403, "Only QS, Engineer or Director can review documents")
    body = await request.json()
    status = body.get("status")
    if status not in ("under-review", "approved", "revision-requested"):
        raise HTTPException(400, "Invalid status")
    doc = db.one("SELECT * FROM documents WHERE id=?", (did,))
    if not doc:
        raise HTTPException(404, "Document not found")
    db.execute("UPDATE documents SET status=? WHERE id=?", (status, did))
    db.audit(doc["project_id"], user["id"], f"document.{status}",
             f"{doc['title']} v{doc['version']} — {status.replace('-', ' ')} by {user['name']}")
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Client vision engine — brief -> solution schemes
# --------------------------------------------------------------------------- #
def _can_brief(user: dict) -> bool:
    return user["role"] not in ("manufacturer", "installer")


@app.get("/api/projects/{pid}/brief")
def get_brief(pid: int, request: Request):
    require(request)
    brief = db.one("SELECT * FROM briefs WHERE project_id=? ORDER BY id DESC LIMIT 1", (pid,))
    return {
        "brief": brief,
        "styles": [{"key": k, **v} for k, v in vision.STYLES.items()],
        "bands": vision.BANDS,
        "priorities": [{"key": k, "label": v} for k, v in vision.PRIORITIES.items()],
    }


@app.post("/api/projects/{pid}/brief")
async def save_brief(pid: int, request: Request):
    user = require(request)
    if not _can_brief(user):
        raise HTTPException(403, "Suppliers and installers cannot set the client brief")
    body = await request.json()
    style = body.get("style")
    band = body.get("budget_band", "standard")
    if style not in vision.STYLES or band not in vision.BANDS:
        raise HTTPException(400, "Unknown style or budget band")
    prios = ",".join(p for p in (body.get("priorities") or []) if p in vision.PRIORITIES)
    bid = db.execute(
        "INSERT INTO briefs(project_id,style,budget_band,priorities,notes,created_by) VALUES(?,?,?,?,?,?)",
        (pid, style, band, prios, (body.get("notes") or "").strip()[:2000], user["id"]))
    db.audit(pid, user["id"], "brief.saved",
             f"{vision.STYLES[style]['label']} · {band} · {prios or 'no priorities'}")
    return {"id": bid}


@app.get("/api/projects/{pid}/schemes")
def get_schemes(pid: int, request: Request):
    require(request)
    brief = db.one("SELECT * FROM briefs WHERE project_id=? ORDER BY id DESC LIMIT 1", (pid,))
    if not brief:
        raise HTTPException(400, "Save a client brief first")
    return {"brief": brief, "schemes": vision.propose_schemes(pid, brief)}


@app.post("/api/projects/{pid}/schemes/apply")
async def apply_scheme(pid: int, request: Request):
    user = require(request)
    if not _can_brief(user):
        raise HTTPException(403, "Suppliers and installers cannot apply schemes")
    body = await request.json()
    picks = body.get("picks") or {}
    if not picks:
        raise HTTPException(400, "No picks in scheme")
    changed = 0
    for room in db.query("SELECT id FROM rooms WHERE project_id=?", (pid,)):
        for sel in db.query("SELECT * FROM selections WHERE room_id=?", (room["id"],)):
            new_pid = picks.get(sel["category"])
            if new_pid and new_pid != sel["product_id"]:
                db.execute(
                    "UPDATE selections SET product_id=?, variant_id=NULL, source='vision-scheme', "
                    "selected_by=?, updated_at=datetime('now') WHERE id=?",
                    (int(new_pid), user["id"], sel["id"]))
                changed += 1
    db.audit(pid, user["id"], "scheme.applied",
             f"{body.get('label', 'Scheme')} — {changed} selections updated across the project")
    return {"ok": True, "changed": changed, "stats": _project_stats(pid)}


# --------------------------------------------------------------------------- #
# Materials library
# --------------------------------------------------------------------------- #
@app.get("/api/products")
def products(request: Request, category: Optional[str] = None, source: Optional[str] = None,
             q: Optional[str] = None):
    require(request)
    sql = "SELECT p.*, m.name AS manufacturer FROM products p LEFT JOIN manufacturers m ON m.id=p.manufacturer_id WHERE p.status='approved'"
    params = []
    if category:
        sql += " AND p.category=?"; params.append(category)
    if source:
        sql += " AND p.source=?"; params.append(source)
    if q:
        sql += " AND (p.name LIKE ? OR p.code LIKE ?)"; params += [f"%{q}%", f"%{q}%"]
    sql += " ORDER BY p.category, p.unit_price"
    rows = db.query(sql, params)
    if rows:
        ids = ",".join(str(r["id"]) for r in rows)
        vs = db.query(f"SELECT * FROM product_variants WHERE product_id IN ({ids}) ORDER BY kind DESC, id")
        by_pid = {}
        for v in vs:
            by_pid.setdefault(v["product_id"], []).append(v)
        for r in rows:
            r["variants"] = by_pid.get(r["id"], [])
    return rows


@app.get("/api/manufacturers")
def manufacturers(request: Request):
    require(request)
    return db.query("SELECT * FROM manufacturers ORDER BY name")


@app.post("/api/manufacturers")
async def add_manufacturer(request: Request):
    """Procurement registers a new supplier/manufacturer for sourcing."""
    user = require(request)
    if not auth.has_cap(user, "rfq.manage"):
        raise HTTPException(403, "Only Procurement can register suppliers")
    body = await request.json()
    name = (body.get("name") or "").strip()
    categories = (body.get("categories") or "").strip().lower()
    if not name or not categories:
        raise HTTPException(400, "Supplier name and categories are required")
    mid = db.execute(
        """INSERT INTO manufacturers(name,country,categories,rating,compliance,lead_time_days)
           VALUES(?,?,?,?,?,?)""",
        (name, body.get("country", ""), categories,
         float(body.get("rating") or 4.0), float(body.get("compliance") or 0.85),
         int(body.get("lead_time_days") or 30)))
    db.audit(None, user["id"], "supplier.registered", f"{name} · {categories}")
    return {"id": mid}


# --------------------------------------------------------------------------- #
# Design studio: selections + live cost/BOQ delta
# --------------------------------------------------------------------------- #
@app.get("/api/rooms/{room_id}/selections")
def room_selections(room_id: int, request: Request):
    require(request)
    rows = db.query(
        """SELECT s.*, p.name AS product_name, p.code AS product_code, p.swatch, p.color,
                  p.finish, p.unit_price, p.source AS product_source, m.name AS manufacturer
           FROM selections s JOIN products p ON p.id=s.product_id
           LEFT JOIN manufacturers m ON m.id=p.manufacturer_id
           WHERE s.room_id=? ORDER BY s.category""", (room_id,))
    room = db.one("SELECT * FROM rooms WHERE id=?", (room_id,))
    lines = []
    for s in rows:
        var = _variant(s.get("variant_id"))
        prod = _apply_variant(db.one("SELECT * FROM products WHERE id=?", (s["product_id"],)), var)
        if var:
            s["variant_label"] = var["label"]
            s["product_name"] = prod["name"]
            s["swatch"] = prod["swatch"]
            s["unit_price"] = prod["unit_price"]
        lines.append(boq.compute_line(room, prod, source="estimated", confidence=s["confidence"]).as_dict())
    return {"room": room, "selections": rows, "boq": lines,
            "room_total": round(sum(l["amount"] for l in lines), 2)}


@app.put("/api/rooms/{room_id}/selections/{category}")
async def set_selection(room_id: int, category: str, request: Request):
    user = require(request)
    body = await request.json()
    product_id = body["product_id"]
    variant_id = body.get("variant_id") or None
    room = db.one("SELECT * FROM rooms WHERE id=?", (room_id,))
    prod = db.one("SELECT * FROM products WHERE id=?", (product_id,))
    if not room or not prod:
        raise HTTPException(404, "Room or product not found")
    var = _variant(variant_id)
    if var and var["product_id"] != product_id:
        raise HTTPException(400, "Variant does not belong to this product")
    prod = _apply_variant(prod, var)

    # capture the "before" for an impact statement
    before = db.one("SELECT * FROM selections WHERE room_id=? AND category=?", (room_id, category))
    before_line = None
    if before:
        bp = _apply_variant(db.one("SELECT * FROM products WHERE id=?", (before["product_id"],)),
                            _variant(before.get("variant_id")))
        before_line = boq.compute_line(room, bp).as_dict()

    db.execute(
        """INSERT INTO selections(room_id,category,product_id,variant_id,status,source,confidence,selected_by,updated_at)
           VALUES(?,?,?,?,?,?,?,?,datetime('now'))
           ON CONFLICT(room_id,category) DO UPDATE SET
             product_id=excluded.product_id, variant_id=excluded.variant_id, status='concept', source=excluded.source,
             confidence=excluded.confidence, selected_by=excluded.selected_by, updated_at=datetime('now')""",
        (room_id, category, product_id, variant_id, "concept", "client-selected", 0.9, user["id"]))

    after_line = boq.compute_line(room, prod).as_dict()
    delta = round(after_line["amount"] - (before_line["amount"] if before_line else 0), 2)

    db.audit(room["project_id"], user["id"], "selection.changed",
             f'{room["name"]} · {category} → {prod["code"]} (Δ ${delta})')

    return {
        "after": after_line, "before": before_line, "delta": delta,
        "impact": {
            "cost_delta": delta,
            "lead_time_days": prod["lead_time_days"],
            "affects": ["BOQ line", "specification", "room concept", "estimated cost"],
            "requires": "client approval" if delta > 0 else "designer confirmation",
        },
    }


# --------------------------------------------------------------------------- #
# BOQ
# --------------------------------------------------------------------------- #
def _live_boq(pid: int) -> list[dict]:
    """Recompute the BOQ live from current selections (single source of truth)."""
    rooms = {r["id"]: r for r in db.query("SELECT * FROM rooms WHERE project_id=?", (pid,))}
    sels = db.query(
        """SELECT s.* FROM selections s JOIN rooms r ON r.id=s.room_id WHERE r.project_id=?""", (pid,))
    verified = {(v["room_id"], v["category"]): v for v in db.query(
        """SELECT bl.room_id, bl.category, bl.verified_by FROM boq_lines bl
           JOIN boq_versions bv ON bv.id=bl.version_id
           WHERE bv.project_id=? AND bl.source='qs-verified'""", (pid,))}
    lines = []
    for s in sels:
        room = rooms[s["room_id"]]
        prod = _apply_variant(db.one("SELECT * FROM products WHERE id=?", (s["product_id"],)),
                              _variant(s.get("variant_id")))
        src = "qs-verified" if (s["room_id"], s["category"]) in verified else \
              ("drawing-extracted" if room["source"] == "drawing-extracted" else "estimated")
        line = boq.compute_line(room, prod, source=src, confidence=s["confidence"]).as_dict()
        lines.append(line)
    lines.sort(key=lambda l: (l["room_name"], l["category"]))
    return lines


@app.get("/api/projects/{pid}/boq")
def project_boq(pid: int, request: Request):
    user = require(request)
    lines = _live_boq(pid)
    show_internal = auth.can_see_internal_cost(user)
    total = round(sum(l["amount"] for l in lines), 2)
    by_cat = {}
    for l in lines:
        by_cat.setdefault(l["category"], 0)
        by_cat[l["category"]] += l["amount"]
    return {
        "lines": lines,
        "total": total,
        "by_category": {k: round(v, 2) for k, v in sorted(by_cat.items())},
        "show_internal_cost": show_internal,
        "verified_pct": round(100 * sum(1 for l in lines if l["source"] == "qs-verified") / len(lines)) if lines else 0,
    }


@app.post("/api/projects/{pid}/boq/verify")
async def verify_boq(pid: int, request: Request):
    """QS-only: mark a room+category line as professionally verified."""
    user = require(request)
    if not auth.has_cap(user, "boq.verify"):
        raise HTTPException(403, "Only a Quantity Surveyor can verify quantities")
    body = await request.json()
    room_id, category = body["room_id"], body["category"]
    room = db.one("SELECT * FROM rooms WHERE id=?", (room_id,))
    sel = db.one("SELECT * FROM selections WHERE room_id=? AND category=?", (room_id, category))
    if not sel:
        raise HTTPException(404, "Selection not found")
    prod = db.one("SELECT * FROM products WHERE id=?", (sel["product_id"],))
    line = boq.compute_line(room, prod, source="qs-verified", confidence=1.0).as_dict()

    ver = db.one("SELECT * FROM boq_versions WHERE project_id=? ORDER BY id DESC LIMIT 1", (pid,))
    if not ver:
        vid = db.execute(
            "INSERT INTO boq_versions(project_id,rev,note,created_by,status) VALUES(?,?,?,?,?)",
            (pid, "R0", "Working BOQ", user["id"], "draft"))
    else:
        vid = ver["id"]
    db.execute(
        """INSERT INTO boq_lines(version_id,room_id,category,product_id,description,unit,net_qty,
             waste_pct,ordered_qty,rate,amount,source,confidence,verified_by)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (vid, room_id, category, prod["id"], line["description"], line["unit"], line["net_qty"],
         line["waste_pct"], line["ordered_qty"], line["rate"], line["amount"], "qs-verified", 1.0, user["id"]))
    db.audit(pid, user["id"], "boq.verified", f'{room["name"]} · {category} verified by QS')
    return {"ok": True, "line": line}


@app.get("/api/projects/{pid}/boq.csv")
def boq_csv(pid: int, request: Request):
    require(request)
    lines = _live_boq(pid)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Room", "Category", "Description", "Unit", "Net Qty", "Waste %",
                "Ordered Qty", "Rate", "Amount", "Source", "Confidence"])
    for l in lines:
        w.writerow([l["room_name"], l["category"], l["description"], l["unit"], l["net_qty"],
                    f'{l["waste_pct"]*100:.0f}%', l["ordered_qty"], l["rate"], l["amount"],
                    l["source"], f'{l["confidence"]*100:.0f}%'])
    w.writerow([]); w.writerow(["", "", "", "", "", "", "", "TOTAL", round(sum(l["amount"] for l in lines), 2)])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=UZA-{pid}-BOQ.csv"})


# --------------------------------------------------------------------------- #
# Procurement: RFQ, quotations, bid comparison, PO
# --------------------------------------------------------------------------- #
@app.post("/api/projects/{pid}/rfqs")
async def create_rfq(pid: int, request: Request):
    user = require(request)
    if not auth.has_cap(user, "rfq.manage"):
        raise HTTPException(403, "Only Procurement can issue RFQs")
    body = await request.json()
    category = body["category"]
    lines = [l for l in _live_boq(pid) if l["category"] == category]
    if not lines:
        raise HTTPException(400, f"No BOQ lines exist for '{category}' — select finishes first")
    # never issue an RFQ into a void: require at least one capable manufacturer
    if not db.query("SELECT 1 FROM manufacturers WHERE categories LIKE ? LIMIT 1", (f"%{category}%",)):
        raise HTTPException(
            400, f"No registered manufacturer covers '{category}' yet. "
                 "Add one in the manufacturer register before issuing this RFQ.")
    qty = round(sum(l["ordered_qty"] for l in lines), 2)
    pkg = f"PKG-{category.upper()[:4]}-{pid}"
    rfq_id = db.execute(
        """INSERT INTO rfqs(project_id,package_code,category,scope,required_by,status)
           VALUES(?,?,?,?,?,?)""",
        (pid, pkg, category, f"{qty} {lines[0]['unit'] if lines else 'no'} across {len(lines)} rooms",
         body.get("required_by", "2026-10-01"), "open"))

    # auto-invite matching manufacturers and generate representative quotations (demo)
    mans = db.query("SELECT * FROM manufacturers WHERE categories LIKE ?", (f"%{category}%",))
    base_rate = (sum(l["rate"] for l in lines) / len(lines)) if lines else 20
    for i, m in enumerate(mans):
        unit_price = round(base_rate * (0.9 + 0.12 * i), 2)
        # freight scales with the rate so it stays sensible in any currency
        freight = round(qty * base_rate * 0.02 * (1 + 0.6 * i), 2)
        duty = 0.0 if m["country"] == "Rwanda" else 0.18
        landed = boq.landed_cost(unit_price, freight, duty, qty)
        db.execute(
            """INSERT INTO quotations(rfq_id,manufacturer_id,unit_price,freight,duty_pct,
                 lead_time_days,warranty,compliance,landed_cost,status)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (rfq_id, m["id"], unit_price, freight, duty, m["lead_time_days"],
             f'{5 + i*3} yr', m["compliance"], landed, "submitted"))
    db.audit(pid, user["id"], "rfq.created", f"{pkg} · {category} · {len(mans)} manufacturers invited")
    return {"rfq_id": rfq_id, "package_code": pkg, "invited": len(mans)}


@app.get("/api/projects/{pid}/rfqs")
def list_rfqs(pid: int, request: Request):
    require(request)
    return db.query("SELECT * FROM rfqs WHERE project_id=? ORDER BY id DESC", (pid,))


@app.get("/api/rfqs/{rfq_id}/bids")
def rfq_bids(rfq_id: int, request: Request):
    require(request)
    quotes = db.query(
        """SELECT q.*, m.name AS manufacturer, m.country, m.rating
           FROM quotations q JOIN manufacturers m ON m.id=q.manufacturer_id
           WHERE q.rfq_id=? ORDER BY q.landed_cost""", (rfq_id,))
    if not quotes:
        return {"rfq": db.one("SELECT * FROM rfqs WHERE id=?", (rfq_id,)), "bids": []}
    cheapest = min(q["landed_cost"] for q in quotes)
    fastest = min(q["lead_time_days"] for q in quotes)
    for q in quotes:
        q["score"] = boq.bid_score(q, cheapest, fastest)
    quotes.sort(key=lambda q: -q["score"])
    if quotes:
        quotes[0]["recommended"] = True
    return {"rfq": db.one("SELECT * FROM rfqs WHERE id=?", (rfq_id,)), "bids": quotes}


@app.post("/api/rfqs/{rfq_id}/award")
async def award(rfq_id: int, request: Request):
    user = require(request)
    if not auth.has_cap(user, "bid.award"):
        raise HTTPException(403, "Only Procurement can award bids")
    body = await request.json()
    q = db.one("SELECT * FROM quotations WHERE id=?", (body["quotation_id"],))
    rfq = db.one("SELECT * FROM rfqs WHERE id=?", (rfq_id,))
    db.execute("UPDATE quotations SET status='awarded' WHERE id=?", (q["id"],))
    db.execute("UPDATE quotations SET status='rejected' WHERE rfq_id=? AND id<>?", (rfq_id, q["id"]))
    db.execute("UPDATE rfqs SET status='awarded' WHERE id=?", (rfq_id,))
    po_code = f"PO-{rfq['package_code']}"
    po_id = db.execute(
        """INSERT INTO purchase_orders(project_id,rfq_id,quotation_id,manufacturer_id,po_code,amount,status)
           VALUES(?,?,?,?,?,?,?)""",
        (rfq["project_id"], rfq_id, q["id"], q["manufacturer_id"], po_code, q["landed_cost"], "issued"))
    for name, pct, eta in [("Deposit received", 0, "2026-08-05"), ("Shop drawings approved", 15, "2026-08-20"),
                           ("In production", 40, "2026-09-10"), ("QC & packing", 80, "2026-09-25"),
                           ("Shipped", 90, "2026-10-01"), ("Delivered to site", 100, "2026-10-12")]:
        db.execute("INSERT INTO milestones(po_id,name,pct,eta) VALUES(?,?,?,?)", (po_id, name, pct, eta))
    db.audit(rfq["project_id"], user["id"], "bid.awarded",
             f"{rfq['package_code']} awarded → {q['manufacturer_id']} (${q['landed_cost']})")
    return {"po_id": po_id, "po_code": po_code}


@app.get("/api/projects/{pid}/orders")
def orders(pid: int, request: Request):
    require(request)
    pos = db.query(
        """SELECT po.*, m.name AS manufacturer FROM purchase_orders po
           LEFT JOIN manufacturers m ON m.id=po.manufacturer_id
           WHERE po.project_id=? ORDER BY po.id DESC""", (pid,))
    for po in pos:
        po["milestones"] = db.query("SELECT * FROM milestones WHERE po_id=? ORDER BY pct", (po["id"],))
    return pos


# --------------------------------------------------------------------------- #
# Collaboration
# --------------------------------------------------------------------------- #
@app.post("/api/projects/{pid}/approvals")
async def approve(pid: int, request: Request):
    user = require(request)
    body = await request.json()
    aid = db.execute(
        """INSERT INTO approvals(project_id,subject_type,subject_id,decision,comment,impact,user_id)
           VALUES(?,?,?,?,?,?,?)""",
        (pid, body.get("subject_type", "option"), body.get("subject_id", 0),
         body["decision"], body.get("comment", ""), body.get("impact", ""), user["id"]))
    db.audit(pid, user["id"], "approval." + body["decision"], body.get("comment", ""))
    return {"id": aid}


@app.get("/api/projects/{pid}/comments")
def list_comments(pid: int, request: Request):
    require(request)
    return db.query(
        """SELECT c.*, u.name AS user_name, u.role FROM comments c
           LEFT JOIN users u ON u.id=c.user_id
           WHERE c.project_id=? ORDER BY c.id DESC LIMIT 100""", (pid,))


@app.post("/api/projects/{pid}/comments")
async def add_comment(pid: int, request: Request):
    user = require(request)
    body = await request.json()
    text = (body.get("body") or "").strip()
    if not text:
        raise HTTPException(400, "Comment text required")
    cid = db.execute(
        """INSERT INTO comments(project_id,subject_type,subject_id,body,user_id)
           VALUES(?,?,?,?,?)""",
        (pid, body.get("subject_type", "project"), body.get("subject_id", 0), text, user["id"]))
    db.audit(pid, user["id"], "comment.added", text[:80])
    return {"id": cid}


@app.get("/api/projects/{pid}/approvals")
def list_approvals(pid: int, request: Request):
    require(request)
    return db.query(
        """SELECT a.*, u.name AS user_name, u.role FROM approvals a
           LEFT JOIN users u ON u.id=a.user_id WHERE a.project_id=? ORDER BY a.id DESC""", (pid,))


@app.get("/api/projects/{pid}/audit")
def audit_log(pid: int, request: Request):
    require(request)
    return db.query(
        """SELECT a.*, u.name AS user_name, u.role FROM audit_log a
           LEFT JOIN users u ON u.id=a.user_id WHERE a.project_id=? ORDER BY a.id DESC LIMIT 100""", (pid,))


@app.get("/api/projects/{pid}/ai")
def ai_runs(pid: int, request: Request):
    require(request)
    return db.query("SELECT * FROM ai_runs WHERE project_id=? ORDER BY id DESC", (pid,))


# --------------------------------------------------------------------------- #
# AI drawing intelligence (spec §4.2) — analyze then professional import
# --------------------------------------------------------------------------- #
@app.get("/api/ai/status")
def ai_status(request: Request):
    require(request)
    return {"live": ai.live_available(), "model": ai.MODEL}


@app.post("/api/projects/{pid}/drawings/analyze")
async def analyze_drawing(pid: int, request: Request,
                          file: Optional[UploadFile] = File(None),
                          text: Optional[str] = Form(None)):
    user = require(request)
    proj = db.one("SELECT * FROM projects WHERE id=?", (pid,))
    if not proj:
        raise HTTPException(404, "Project not found")
    data = await file.read() if file else None
    fname = file.filename if file else ""
    if not data and not (text and text.strip()):
        raise HTTPException(400, "Upload a drawing or paste a room schedule")

    report = ai.analyze(filename=fname, data=data, text=text or "")
    summary = (f"{report['mode']} · {len(report['rooms'])} rooms, "
               f"{len(report['conflicts'])} conflicts flagged")
    db.execute(
        """INSERT INTO ai_runs(project_id,kind,prompt,model,output,confidence,source)
           VALUES(?,?,?,?,?,?,?)""",
        (pid, "drawing-intel", f"analyze:{fname or 'pasted schedule'}",
         report["model"], summary, report["confidence"], report["source"]))
    db.audit(pid, user["id"], "drawing.analyzed", summary)
    report["fields_required_before_import"] = ["professional review of flagged conflicts"]
    return report


@app.post("/api/projects/{pid}/drawings/import")
async def import_rooms(pid: int, request: Request):
    """Professional-review action: commit reviewed rooms as drawing-extracted."""
    user = require(request)
    body = await request.json()
    rooms = body.get("rooms", [])
    if not rooms:
        raise HTTPException(400, "No rooms to import")
    created = 0
    for r in rooms:
        db.execute(
            """INSERT INTO rooms(project_id,name,floor,area_m2,perimeter_m,height_m,
                 opening_area_m2,source,confidence)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (pid, r.get("name", "Room"), r.get("floor", "Ground"),
             float(r.get("area_m2", 0)), float(r.get("perimeter_m", 0)),
             float(r.get("height_m", 2.9)), float(r.get("opening_area_m2", 0)),
             body.get("source", "drawing-extracted"), float(r.get("confidence", 0.8))))
        created += 1
    db.audit(pid, user["id"], "drawing.imported",
             f"{created} rooms imported after professional review")
    return {"created": created}


# --------------------------------------------------------------------------- #
# Manufacturer package (spec §11) — assembled document payload
# --------------------------------------------------------------------------- #
@app.get("/api/projects/{pid}/package/{category}")
def manufacturer_package(pid: int, category: str, request: Request):
    require(request)
    proj = db.one("SELECT * FROM projects WHERE id=?", (pid,))
    lines = [l for l in _live_boq(pid) if l["category"] == category]
    products = {}
    for l in lines:
        p = db.one("SELECT p.*, m.name AS manufacturer FROM products p LEFT JOIN manufacturers m ON m.id=p.manufacturer_id WHERE p.id=?", (l["product_id"],))
        products[p["id"]] = p
    return {
        "project": proj,
        "package_code": f"PKG-{category.upper()[:4]}-{pid}",
        "category": category,
        "revision": "R0",
        "status": "issued-for-quotation",
        "schedule": lines,
        "total_qty": round(sum(l["ordered_qty"] for l in lines), 2),
        "products": list(products.values()),
        "requirements": {
            "shop_drawings": True, "samples": True,
            "standards": sorted({p.get("standards") for p in products.values() if p.get("standards")}),
            "packaging": "Palletised, QR-labelled per room/floor",
            "qc_checklist": ["Dimensional check", "Finish/colour match to approved sample",
                             "Standards certificate", "Packaging integrity"],
        },
    }


# --------------------------------------------------------------------------- #
# Specification engine (spec §4.8) — per-category technical spec sheets
# --------------------------------------------------------------------------- #
SPEC_MANDATORY = ["standards", "finish", "warranty", "color"]   # gate before issue-for-production


@app.get("/api/projects/{pid}/specs/{category}")
def spec_sheet(pid: int, category: str, request: Request):
    require(request)
    proj = db.one("SELECT * FROM projects WHERE id=?", (pid,))
    if not proj:
        raise HTTPException(404, "Project not found")
    lines = [l for l in _live_boq(pid) if l["category"] == category]
    items = []
    for l in lines:
        p = db.one("""SELECT p.*, m.name AS manufacturer FROM products p
                      LEFT JOIN manufacturers m ON m.id=p.manufacturer_id WHERE p.id=?""",
                   (l["product_id"],))
        missing = [f for f in SPEC_MANDATORY if not (p.get(f) or "").strip() or p.get(f) == "-"]
        items.append({
            "room": l["room_name"], "qty": l["ordered_qty"], "unit": l["unit"],
            "product": p, "missing": missing, "complete": not missing,
            "source": l["source"], "confidence": l["confidence"],
        })
    all_complete = bool(items) and all(i["complete"] for i in items)
    return {
        "project": proj, "category": category, "revision": "R0",
        "status": "ready-for-production" if all_complete else "information-required",
        "issue_allowed": all_complete,
        "mandatory_fields": SPEC_MANDATORY,
        "items": items,
    }


# --------------------------------------------------------------------------- #
# Manufacturer portal (spec §4.9) — strict data isolation
# --------------------------------------------------------------------------- #
def _own_manufacturer(user: dict) -> dict:
    m = db.one("SELECT * FROM manufacturers WHERE org_id=?", (user["org_id"],)) if user.get("org_id") else None
    if not m:
        raise HTTPException(403, "No manufacturer record linked to your account")
    return m


@app.get("/api/portal/manufacturer")
def manufacturer_portal(request: Request):
    user = require(request)
    if user["role"] != "manufacturer" and not auth.has_cap(user, "*"):
        raise HTTPException(403, "Manufacturer portal is for manufacturer accounts")
    m = _own_manufacturer(user) if user["role"] == "manufacturer" else db.one("SELECT * FROM manufacturers ORDER BY id LIMIT 1")
    quotes = db.query(
        """SELECT q.*, r.package_code, r.category, r.scope, r.required_by, r.status AS rfq_status,
                  p.name AS project_name, p.code AS project_code, p.location
           FROM quotations q JOIN rfqs r ON r.id=q.rfq_id JOIN projects p ON p.id=r.project_id
           WHERE q.manufacturer_id=? ORDER BY q.id DESC""", (m["id"],))
    pos = db.query(
        """SELECT po.*, p.code AS project_code, p.location FROM purchase_orders po
           JOIN projects p ON p.id=po.project_id
           WHERE po.manufacturer_id=? ORDER BY po.id DESC""", (m["id"],))
    for po in pos:
        po["milestones"] = db.query("SELECT * FROM milestones WHERE po_id=? ORDER BY pct", (po["id"],))
    # ISOLATION: no other manufacturer's data, no internal costs, no other bids.
    return {"manufacturer": m, "quotations": quotes, "purchase_orders": pos}


@app.put("/api/quotations/{qid}")
async def revise_quotation(qid: int, request: Request):
    """A manufacturer may revise its own bid while the RFQ is still open."""
    user = require(request)
    q = db.one("SELECT * FROM quotations WHERE id=?", (qid,))
    if not q:
        raise HTTPException(404, "Quotation not found")
    if user["role"] == "manufacturer":
        m = _own_manufacturer(user)
        if q["manufacturer_id"] != m["id"]:
            raise HTTPException(403, "You can only revise your own quotation")
    elif not auth.has_cap(user, "*"):
        raise HTTPException(403, "Not permitted")
    rfq = db.one("SELECT * FROM rfqs WHERE id=?", (q["rfq_id"],))
    if rfq["status"] != "open":
        raise HTTPException(400, "RFQ is no longer open for revisions")
    body = await request.json()
    unit_price = float(body.get("unit_price") or q["unit_price"])
    lead = int(body.get("lead_time_days") or q["lead_time_days"])
    freight = float(body.get("freight") or q["freight"])
    landed = boq.landed_cost(unit_price, freight, q["duty_pct"] or 0)
    db.execute(
        "UPDATE quotations SET unit_price=?, lead_time_days=?, freight=?, landed_cost=?, status='submitted' WHERE id=?",
        (unit_price, lead, freight, landed, qid))
    db.audit(rfq["project_id"], user["id"], "quotation.revised",
             f'{rfq["package_code"]}: unit ${unit_price}, lead {lead}d')
    return {"ok": True, "landed_cost": landed}


# --------------------------------------------------------------------------- #
# Production & logistics (spec §4.12) — milestone completion drives PO status
# --------------------------------------------------------------------------- #
@app.post("/api/milestones/{mid}/done")
async def complete_milestone(mid: int, request: Request):
    user = require(request)
    ms = db.one("SELECT * FROM milestones WHERE id=?", (mid,))
    if not ms:
        raise HTTPException(404, "Milestone not found")
    po = db.one("SELECT * FROM purchase_orders WHERE id=?", (ms["po_id"],))
    allowed = (auth.has_cap(user, "production.update") or auth.has_cap(user, "install.update")
               or auth.has_cap(user, "rfq.manage") or auth.has_cap(user, "*"))
    if user["role"] == "manufacturer":
        m = _own_manufacturer(user)
        allowed = po["manufacturer_id"] == m["id"]
    if not allowed:
        raise HTTPException(403, "Not permitted to update production progress")
    # milestones must complete in sequence — no skipping ahead
    earlier_open = db.one(
        "SELECT 1 FROM milestones WHERE po_id=? AND pct<? AND done=0 LIMIT 1", (po["id"], ms["pct"]))
    if earlier_open:
        raise HTTPException(400, "Complete earlier milestones first (sequence is controlled)")
    db.execute("UPDATE milestones SET done=1 WHERE id=?", (mid,))
    # derive PO status from progress
    done_pcts = [m2["pct"] for m2 in db.query("SELECT * FROM milestones WHERE po_id=? AND done=1", (po["id"],))]
    top = max(done_pcts) if done_pcts else 0
    status = "delivered" if top >= 100 else "shipped" if top >= 90 else \
             "in-production" if top >= 40 else "issued"
    db.execute("UPDATE purchase_orders SET status=? WHERE id=?", (status, po["id"]))
    db.audit(po["project_id"], user["id"], "milestone.done", f'{po["po_code"]}: {ms["name"]} → {status}')
    return {"ok": True, "po_status": status}


# --------------------------------------------------------------------------- #
# Client care & comms — shareable status update (WhatsApp / email-ready)
# --------------------------------------------------------------------------- #
@app.get("/api/projects/{pid}/client-update")
def client_update(pid: int, request: Request):
    """Plain-text project status the team can paste into WhatsApp or email."""
    require(request)
    p = db.one("SELECT * FROM projects WHERE id=?", (pid,))
    if not p:
        raise HTTPException(404, "Project not found")
    lines = _live_boq(pid)
    total = round(sum(l["amount"] for l in lines), 2)
    verified = round(100 * sum(1 for l in lines if l["source"] == "qs-verified") / len(lines)) if lines else 0
    rooms = db.query("SELECT * FROM rooms WHERE project_id=?", (pid,))
    pos = db.query(
        """SELECT po.*, m.name AS manufacturer FROM purchase_orders po
           LEFT JOIN manufacturers m ON m.id=po.manufacturer_id WHERE po.project_id=?""", (pid,))
    order_lines = []
    for po in pos:
        ms = db.query("SELECT * FROM milestones WHERE po_id=? ORDER BY pct", (po["id"],))
        done = sum(1 for x in ms if x["done"])
        nxt = next((x for x in ms if not x["done"]), None)
        order_lines.append(
            f'• {po["po_code"]} ({po["manufacturer"] or "supplier"}): {po["status"]} '
            + (f'— next: {nxt["name"]} (ETA {nxt["eta"]})' if nxt else f'— complete ({done}/{len(ms)})'))
    sel_count = db.one(
        "SELECT COUNT(*) c FROM selections s JOIN rooms r ON r.id=s.room_id WHERE r.project_id=?", (pid,))["c"]
    def fmt(v):
        if p["currency"] == "RWF":
            return f"{v/1e6:.1f}M RWF" if v >= 1e6 else f"{v:,.0f} RWF"
        return f"${v:,.0f}"
    text = "\n".join(filter(None, [
        "*UZA BUILD — PROJECT UPDATE*",
        f'{p["name"]} ({p["code"]}) · {p["location"]}',
        f'Status: {p["status"].upper()}',
        "",
        f'Estimated value: {fmt(total)} (budget {fmt(p["budget"])})',
        f'Rooms designed: {len(rooms)} · Finishes selected: {sel_count}',
        f'Quantities QS-verified: {verified}%',
        "",
        "*Orders*" if order_lines else "Orders: none issued yet — design in progress.",
        *order_lines,
        "",
        "Review designs, approve finishes and follow progress any time in your UZA Build client portal.",
        "— The UZA team",
    ]))
    return {"text": text, "project": p["code"]}


# --------------------------------------------------------------------------- #
# Handover & digital building record (spec §4.13)
# --------------------------------------------------------------------------- #
@app.get("/api/projects/{pid}/handover")
def handover(pid: int, request: Request):
    require(request)
    proj = db.one("SELECT * FROM projects WHERE id=?", (pid,))
    rooms = db.query("SELECT * FROM rooms WHERE project_id=? ORDER BY id", (pid,))
    record = []
    for r in rooms:
        sels = db.query(
            """SELECT s.category, p.code, p.name, p.finish, p.color, p.standards, p.warranty,
                      p.lead_time_days, p.source AS product_source, m.name AS manufacturer, m.country
               FROM selections s JOIN products p ON p.id=s.product_id
               LEFT JOIN manufacturers m ON m.id=p.manufacturer_id
               WHERE s.room_id=? ORDER BY s.category""", (r["id"],))
        record.append({"room": r, "materials": sels})
    pos = db.query("SELECT po_code, status FROM purchase_orders WHERE project_id=?", (pid,))
    return {"project": proj, "record": record,
            "orders_summary": pos,
            "note": "Digital building record — future replacements searchable by room and product code."}


@app.get("/api/projects/{pid}/handover.csv")
def handover_csv(pid: int, request: Request):
    require(request)
    data = handover(pid, request)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Room", "Category", "Product code", "Product", "Finish", "Colour",
                "Standards", "Warranty", "Manufacturer", "Country"])
    for entry in data["record"]:
        for mtl in entry["materials"]:
            w.writerow([entry["room"]["name"], mtl["category"], mtl["code"], mtl["name"],
                        mtl["finish"], mtl["color"], mtl["standards"], mtl["warranty"],
                        mtl["manufacturer"] or "—", mtl["country"] or "—"])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=UZA-{pid}-handover-record.csv"})


# --------------------------------------------------------------------------- #
# Static SPA (mounted last so /api wins)
# --------------------------------------------------------------------------- #
@app.get("/")
def index():
    return FileResponse(os.path.join(WEB_DIR, "index.html"))


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
