"""
UZA Build — authentication & RBAC (stdlib only).

Password hashing: PBKDF2-HMAC-SHA256 (no native deps, Windows-friendly).
Sessions: signed tokens (HMAC) stored client-side; validated server-side.
Roles mirror the spec's permission matrix.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from . import db

SECRET = os.environ.get("UZA_SECRET", "uza-build-dev-secret-change-me").encode()

# Role → capabilities (coarse-grained, matches the spec's role table)
ROLES = {
    "super_admin":   {"label": "UZA Super Admin",           "caps": {"*"}},
    "director":      {"label": "UZA Project Director",       "caps": {"project.create", "approve", "budget.view", "cost.internal"}},
    "designer":      {"label": "Architect / Interior Designer", "caps": {"design", "boq.view", "cost.client"}},
    "qs":            {"label": "Quantity Surveyor",          "caps": {"boq.verify", "boq.edit", "cost.internal", "cost.client"}},
    "engineer":      {"label": "Engineer / Technical Reviewer", "caps": {"tech.review", "boq.view"}},
    "procurement":   {"label": "Procurement Officer",        "caps": {"rfq.manage", "bid.award", "po.issue", "cost.internal"}},
    "client":        {"label": "Client",                     "caps": {"design.select", "approve.client", "cost.client"}},
    "manufacturer":  {"label": "Manufacturer / Supplier",    "caps": {"quote.submit", "production.update"}},
    "installer":     {"label": "Installer / Contractor",     "caps": {"install.update"}},
    "viewer":        {"label": "Read-only Stakeholder",      "caps": {"view"}},
}


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"pbkdf2${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, b64salt, b64dk = stored.split("$")
        salt = base64.b64decode(b64salt)
        expected = base64.b64decode(b64dk)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def make_token(user_id: int, ttl: int = 60 * 60 * 12) -> str:
    payload = {"uid": user_id, "exp": int(time.time()) + ttl}
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(SECRET, raw.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{raw}.{sig}"


def read_token(token: str) -> dict | None:
    try:
        raw, sig = token.split(".")
        expect = hmac.new(SECRET, raw.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, expect):
            return None
        payload = json.loads(base64.urlsafe_b64decode(raw.encode()))
        if payload["exp"] < time.time():
            return None
        return payload
    except Exception:
        return None


def user_from_token(token: str | None) -> dict | None:
    if not token:
        return None
    payload = read_token(token)
    if not payload:
        return None
    return db.one("SELECT * FROM users WHERE id=?", (payload["uid"],))


def has_cap(user: dict | None, cap: str) -> bool:
    if not user:
        return False
    caps = ROLES.get(user["role"], {}).get("caps", set())
    return "*" in caps or cap in caps or "view" in caps and cap.endswith(".view")


def can_see_internal_cost(user: dict | None) -> bool:
    return has_cap(user, "cost.internal") or has_cap(user, "*")
