# UZA Build — Design-to-Delivery Operating System (working model)

An AI-powered finishing-materials **design → BOQ → procurement → delivery** platform.
This is a genuinely runnable working model of the core loop that "truly changes the
construction finishing-materials sourcing experience": **a design decision instantly
becomes an accurate, pack-rounded, priced, manufacturer-ready procurement package —
with every quantity tagged by source and confidence, and nothing marked *verified*
without a QS sign-off.**

Built from the two UZA Build specification documents (Final Blueprint + Master Prompt).

---

## Run it (Windows, one command)

You only need **Python 3.10+** (already installed on this machine).

```powershell
# from the uza-build folder
./run.ps1
```
or double-click **`run.bat`**. First run creates a local `.venv`, installs 3
packages, seeds a demo database, and starts the server. Then open:

```
http://127.0.0.1:8000
```

Manual alternative:
```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload
```

To reset the demo data, delete `uza_build.db` and restart.

---

## Demo accounts (password `uza1234`)

| Role | Email | What to try |
|---|---|---|
| Client | `client@uza.build` | Design studio, approvals, client portal (client price only) |
| Interior Designer | `designer@uza.build` | Swap finishes, compare options |
| Quantity Surveyor | `qs@uza.build` | **Verify** BOQ lines (only the QS can) |
| Procurement Officer | `procurement@uza.build` | Issue RFQs, compare bids, award, generate POs |
| Project Director | `director@uza.build` | Approvals, oversight, internal cost visibility |
| Super Admin | `admin@uza.build` | Everything |

Switch roles instantly from the login screen's role chips.

---

## AI drawing intake (the AI front door)

*Drawing intake (AI)* turns an uploaded drawing or a pasted room schedule into a
**Drawing Intelligence Report** — extracted rooms with geometry + confidence, plus
detected info, missing info, conflicts and assumptions. A professional reviews it,
then one click imports the rooms (tagged by source + confidence).

- **Live mode** — with Claude (`claude-opus-4-8`, adaptive thinking, vision). Enable:
  `pip install anthropic` and set `ANTHROPIC_API_KEY`, then restart. It reads real
  PDFs/images via the vision API.
- **Demo mode** (default, no key) — a deterministic rules-based extractor. Paste a
  schedule (one `Room Name  Area` per line, e.g. `Living / Dining 32`) and it parses
  rooms, estimating perimeter/height/openings and labelling everything *estimated*.

The adapter is honest about which mode it's in (badge on the page) and degrades
gracefully if the live call fails — exactly the spec's §5 requirement.

## The golden path (5-minute demo)

0. **Drawing intake (AI)** — paste a room schedule → *Run AI assessment* → review the
   report → *Import rooms*. (In demo mode this is rules-based; with a key it's Claude.)
1. **Login as Client** → *Design studio*. Pick a room, click a finish, choose a new
   option. The 3D concept, room total, BOQ delta and a **change-impact card** update live.
2. **Materials library** — browse the catalogue; note UZA Catalogue vs **UZA Bulk** vs local sources.
3. **BOQ workspace** — quantities auto-generate (net → +waste → pack-rounding → rate →
   +install +margin). Every line shows its **source badge**. Export CSV.
4. **Login as QS** → BOQ workspace → **Verify** lines. Watch them flip from *Estimated*
   to *QS-verified*. (Try verifying as the Client — the button isn't offered; the API refuses.)
5. **Login as Procurement** → *Procurement & RFQs* → issue an RFQ for a category. UZA
   invites matching manufacturers and collects bids. Open **Compare bids**: ranked by a
   weighted score (landed cost 45% · lead 20% · compliance 25% · warranty 10%) — the
   cheapest isn't always recommended. **Award** → a PO + logistics milestones are created.
6. **Orders & logistics** — track the PO from deposit → production → shipped → delivered.
7. **Audit & AI log** — every action and every AI result (with confidence + source) is recorded.

---

## Architecture

| Layer | This model | Spec target (migration path) |
|---|---|---|
| Frontend | Vanilla-JS SPA, custom design system (no build step) | Next.js + React + TS + Tailwind |
| Backend | FastAPI (`app/main.py`) | FastAPI (same) |
| Data | stdlib **SQLite** (`app/db.py`), normalized schema | PostgreSQL + pgvector |
| Auth | PBKDF2 + signed tokens, RBAC (`app/auth.py`) | + MFA, org isolation |
| QS engine | `app/boq.py` — quantities, waste, pack rounding, landed cost, bid scoring | (same, extended) |
| AI | `app/ai.py` — Claude (`claude-opus-4-8`, vision) drawing intelligence + demo fallback | + RAG, product matching, spec drafting |
| 3D | SVG perspective room, live material swap | Three.js / R3F + glTF |

The SQLite schema is deliberately normalized so it maps onto the spec's PostgreSQL
target without redesign. AI drawing-extraction and photorealistic 3D are represented
as **clearly-labelled adapters/mock modes** (per the spec's honesty requirement).

```
uza-build/
├── app/
│   ├── main.py      # FastAPI routes + static host
│   ├── db.py        # schema + data-access layer
│   ├── boq.py       # QS / costing / bid-scoring engine
│   ├── auth.py      # RBAC + password + tokens
│   ├── ai.py        # AI drawing-intelligence adapter (Claude live + demo fallback)
│   └── seed.py      # Kigali apartment demo data
├── web/             # index.html · styles.css · app.js (SPA)
├── requirements.txt · run.ps1 · run.bat
```

---

## What's real vs. mocked (honest status)

**Fully implemented:** RBAC login, project workspace, rooms, materials library, live
design studio with material swaps, quantity/BOQ engine with pack-rounding & margin,
QS verification guardrail, source/confidence tagging, RFQ generation, weighted bid
comparison, award → PO → logistics milestones, client approvals with impact statements,
audit log, AI-run governance records, CSV export, permission-protected internal cost.

**Real AI adapter (live *or* labelled demo):** the drawing-intake **Drawing
Intelligence Report** is produced by a real adapter — Claude (`claude-opus-4-8`,
vision + adaptive thinking) when `ANTHROPIC_API_KEY` is set and `anthropic` is
installed, otherwise a deterministic rules-based extractor. The mode is shown in the UI.

**Rules-based / demo approximations:** manufacturer quotations are generated from
manufacturer attributes (real API would collect them via the portal); the "3D" is an
SVG concept, not a geometric model.

**Requires external credentials / future work:** real CAD/IFC drawing extraction, a
generative/photoreal 3D service, the live UZA Bulk API (adapter + mock included), email/
SMS notifications, S3 object storage, PostgreSQL deployment. See the spec's Section 12
backlog — the surrounding workflow here is real and production-oriented.
```

---

## Go live (Render.com)

The repo ships with `render.yaml` — a one-click Render blueprint (free tier),
a `/healthz` endpoint and env-based secrets (`UZA_SECRET`, optional
`ANTHROPIC_API_KEY`, optional `UZA_DB_PATH` for a persistent disk).
See **LAUNCH_GUIDE.md** for the click-by-click walkthrough.
