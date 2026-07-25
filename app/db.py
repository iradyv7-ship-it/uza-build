"""
UZA Build — data access layer.

Deliberately dependency-free: stdlib sqlite3 with a thin helper layer.
This keeps the working model runnable on any machine with Python, while the
schema is normalised enough to migrate onto PostgreSQL (the spec's target)
without redesign.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Iterable

DB_PATH = os.environ.get(
    "UZA_DB_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "uza_build.db"),
)


def dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = dict_factory
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def query(sql: str, params: Iterable[Any] = ()) -> list[dict]:
    with connect() as c:
        return list(c.execute(sql, tuple(params)).fetchall())


def one(sql: str, params: Iterable[Any] = ()) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    with connect() as c:
        cur = c.execute(sql, tuple(params))
        return cur.lastrowid


def executemany(sql: str, seq: Iterable[Iterable[Any]]) -> None:
    with connect() as c:
        c.executemany(sql, [tuple(p) for p in seq])


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #
SCHEMA = """
CREATE TABLE IF NOT EXISTS organizations (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'internal'   -- internal | manufacturer | client
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    org_id        INTEGER REFERENCES organizations(id),
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL,                     -- see ROLES in auth.py
    title         TEXT
);

CREATE TABLE IF NOT EXISTS projects (
    id            INTEGER PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    client        TEXT,
    location      TEXT,
    type          TEXT,
    currency      TEXT NOT NULL DEFAULT 'USD',
    budget        REAL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'design',     -- design | procurement | production | installation | handover
    language      TEXT DEFAULT 'en',
    baseline_locked INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    name          TEXT NOT NULL,
    floor         TEXT DEFAULT 'Ground',
    area_m2       REAL NOT NULL DEFAULT 0,
    perimeter_m   REAL NOT NULL DEFAULT 0,
    height_m      REAL NOT NULL DEFAULT 2.7,
    opening_area_m2 REAL NOT NULL DEFAULT 0,          -- doors + windows deducted from wall area
    source        TEXT DEFAULT 'drawing-extracted',   -- provenance of geometry
    confidence    REAL DEFAULT 0.82
);

-- Materials library ------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS manufacturers (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    country       TEXT,
    categories    TEXT,                               -- comma list
    rating        REAL DEFAULT 4.0,
    compliance    REAL DEFAULT 0.9,                   -- 0..1 certification coverage
    lead_time_days INTEGER DEFAULT 45,
    org_id        INTEGER REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL,                       -- floor | wall | ceiling | paint | door | window | kitchen | wardrobe | sanitaryware | lighting ...
    unit          TEXT NOT NULL DEFAULT 'm2',          -- m2 | m | no | set
    unit_price    REAL NOT NULL DEFAULT 0,             -- price per `pack_unit`
    pack_unit     TEXT DEFAULT 'm2',
    coverage      REAL DEFAULT 1.0,                    -- units delivered per pack (e.g. m2 per box)
    pack_size     REAL DEFAULT 1.0,                    -- min sellable increment in `unit`
    moq           REAL DEFAULT 0,
    waste_pct     REAL DEFAULT 0.10,
    lead_time_days INTEGER DEFAULT 30,
    color         TEXT,
    swatch        TEXT DEFAULT '#cccccc',              -- hex used by the visualiser
    finish        TEXT,
    standards     TEXT,
    warranty      TEXT,
    manufacturer_id INTEGER REFERENCES manufacturers(id),
    source        TEXT DEFAULT 'uza-catalogue',        -- uza-catalogue | uza-bulk | local | custom
    status        TEXT DEFAULT 'approved'              -- approved | proposed | rejected | discontinued
);

CREATE TABLE IF NOT EXISTS product_variants (
    id            INTEGER PRIMARY KEY,
    product_id    INTEGER NOT NULL REFERENCES products(id),
    kind          TEXT NOT NULL DEFAULT 'size',          -- size | color
    label         TEXT NOT NULL,                         -- e.g. 800×800, Walnut
    swatch        TEXT,                                  -- colour variants override the visual
    price_factor  REAL NOT NULL DEFAULT 1.0              -- multiplies the indicative budget rate
);

-- Design ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS selections (
    id            INTEGER PRIMARY KEY,
    room_id       INTEGER NOT NULL REFERENCES rooms(id),
    category      TEXT NOT NULL,
    product_id    INTEGER NOT NULL REFERENCES products(id),
    status        TEXT NOT NULL DEFAULT 'concept',      -- concept | coordinated | approved
    source        TEXT DEFAULT 'client-selected',
    confidence    REAL DEFAULT 0.9,
    selected_by   INTEGER REFERENCES users(id),
    variant_id    INTEGER REFERENCES product_variants(id),
    updated_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(room_id, category)
);

-- BOQ --------------------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS boq_versions (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    rev           TEXT NOT NULL,
    note          TEXT,
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT DEFAULT (datetime('now')),
    status        TEXT DEFAULT 'draft'                  -- draft | issued | verified
);

CREATE TABLE IF NOT EXISTS boq_lines (
    id            INTEGER PRIMARY KEY,
    version_id    INTEGER NOT NULL REFERENCES boq_versions(id),
    room_id       INTEGER REFERENCES rooms(id),
    category      TEXT,
    product_id    INTEGER REFERENCES products(id),
    description   TEXT,
    unit          TEXT,
    net_qty       REAL,
    waste_pct     REAL,
    ordered_qty   REAL,                                 -- pack-rounded
    rate          REAL,
    amount        REAL,
    source        TEXT,                                 -- drawing-extracted | estimated | supplier-calculated | qs-verified
    confidence    REAL,
    verified_by   INTEGER REFERENCES users(id)
);

-- Procurement ------------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS rfqs (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    package_code  TEXT NOT NULL,
    category      TEXT,
    scope         TEXT,
    required_by   TEXT,
    status        TEXT DEFAULT 'open',                  -- open | evaluating | awarded | closed
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotations (
    id            INTEGER PRIMARY KEY,
    rfq_id        INTEGER NOT NULL REFERENCES rfqs(id),
    manufacturer_id INTEGER NOT NULL REFERENCES manufacturers(id),
    unit_price    REAL,
    freight       REAL DEFAULT 0,
    duty_pct      REAL DEFAULT 0,
    lead_time_days INTEGER,
    warranty      TEXT,
    compliance    REAL,
    landed_cost   REAL,                                 -- computed
    status        TEXT DEFAULT 'submitted',             -- submitted | under-review | awarded | rejected
    note          TEXT
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    rfq_id        INTEGER REFERENCES rfqs(id),
    quotation_id  INTEGER REFERENCES quotations(id),
    manufacturer_id INTEGER REFERENCES manufacturers(id),
    po_code       TEXT NOT NULL,
    amount        REAL,
    status        TEXT DEFAULT 'issued',                -- issued | in-production | shipped | delivered
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS milestones (
    id            INTEGER PRIMARY KEY,
    po_id         INTEGER NOT NULL REFERENCES purchase_orders(id),
    name          TEXT NOT NULL,
    pct           INTEGER DEFAULT 0,
    done          INTEGER DEFAULT 0,
    eta           TEXT
);

-- Collaboration ----------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS approvals (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER REFERENCES projects(id),
    subject_type  TEXT,                                 -- selection | boq | option | po
    subject_id    INTEGER,
    decision      TEXT,                                 -- approved | approved-with-comments | rejected | revision-requested
    comment       TEXT,
    impact        TEXT,                                 -- json impact statement
    user_id       INTEGER REFERENCES users(id),
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER REFERENCES projects(id),
    subject_type  TEXT,
    subject_id    INTEGER,
    body          TEXT,
    user_id       INTEGER REFERENCES users(id),
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER,
    user_id       INTEGER,
    action        TEXT NOT NULL,
    detail        TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
);

-- Document register ------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS documents (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    title         TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'drawing',      -- drawing | specification | boq | contract | site-report | other
    filename      TEXT,
    stored_as     TEXT,
    size_bytes    INTEGER DEFAULT 0,
    version       INTEGER NOT NULL DEFAULT 1,
    status        TEXT NOT NULL DEFAULT 'submitted',    -- submitted | under-review | approved | revision-requested | superseded
    note          TEXT DEFAULT '',
    uploaded_by   INTEGER REFERENCES users(id),
    created_at    TEXT DEFAULT (datetime('now'))
);

-- Client vision brief ------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS briefs (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER NOT NULL REFERENCES projects(id),
    style         TEXT NOT NULL,                        -- warm-minimal | modern-luxe | natural-organic | bright-classic
    budget_band   TEXT NOT NULL DEFAULT 'standard',     -- economy | standard | premium
    priorities    TEXT DEFAULT '',                      -- comma list: durability,low_maintenance,speed,local
    notes         TEXT DEFAULT '',
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_runs (
    id            INTEGER PRIMARY KEY,
    project_id    INTEGER,
    kind          TEXT,                                 -- drawing-intel | product-match | spec-draft | brief
    prompt        TEXT,
    model         TEXT,
    output        TEXT,
    confidence    REAL,
    source        TEXT,
    approved_by   INTEGER,
    created_at    TEXT DEFAULT (datetime('now'))
);
"""


def init_db(drop: bool = False) -> None:
    if drop and os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    with connect() as c:
        c.executescript(SCHEMA)


def audit(project_id, user_id, action, detail=""):
    execute(
        "INSERT INTO audit_log(project_id,user_id,action,detail) VALUES(?,?,?,?)",
        (project_id, user_id, action, detail),
    )
