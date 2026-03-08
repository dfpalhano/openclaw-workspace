# memory/decisions.md — Architecture Decisions Log
# Append-only. Never delete entries. Add new decisions at the bottom.

---

## 2026-03-08 — Jess v3 Architecture
**Decision:** Replace Playwright browser automation with Chrome extension + relay server
**Why:** Flatmates.com.au uses Kasada anti-bot — blocks headless browsers and CDP regardless of stealth. Extension runs as normal page JS, undetectable.
**Architecture:** Chrome extension (manifest v3) → relay server (port 3847) → Jess v3 (pure HTTP client)
**Status:** Live ✅

---

## 2026-03-08 — Agent Orchestration Model
**Decision:** Atlas is orchestrator only. All implementation → delegate to team agents.
**Rule:** DIN (Do It Now) appended by Diego = Atlas executes directly. Without DIN = delegate.
**Why:** Owner loses time when Atlas is buried in implementation. Must always be responsive.
**Status:** Locked in PROTOCOLS.md ✅

---

## 2026-03-08 — Permission Chain
**Decision:** Diego → Atlas → Team agents → Their sub-agents
**Rule:** No agent self-authorises beyond what was granted. Atlas must ask Diego if scope is unclear.
**Revocation:** Diego can revoke any agent's permission at any time.
**Status:** Locked in PROTOCOLS.md ✅

---

## 2026-03-08 — Property Memory Structure
**Decision:** Per-property memory files at `memory/properties/<CODE>.md`
**Why:** Loading all 15 properties every session wastes tokens. Load on demand.
**Structure:** `index.md` (50-line overview) + one file per property
**Status:** Live ✅

---

## 2026-03-08 — Registration Archive
**Decision:** Confirmed + rejected registrations auto-archived to `data/registrations-archive/YYYY-MM/<id>.json`
**Why:** Live file stays clean (pending only). Archive is traceable by date and status.
**Rule:** Never delete archived records — they are the paper trail.
**Status:** Live ✅

---

## 2026-03-08/09 — Canonical Data Model & PaymentID System
**Decision:** Full data architecture redesign (Ledger + Atlas recommendation, Diego approved)

### Primary key: `waId`
- Use `614XXXXXXXX@c.us` as system-wide primary key for all occupant + financial records
- Already stable, unique, used for photo folders

### PaymentID (privacy-first bank reference)
- Formula: each digit of phone number +1 mod 10
- Example: `61416775321` → `72527886432`
- Bank reference: `<PaymentID> <HouseCode>` — e.g. `72527886432 CO1`
- Reversible by MC automatically
- Privacy: Australian government cannot link bank description to phone number without knowing the rule
- Shown to occupant at end of registration form
- Stored as `paymentId` in occupant record

### Canonical occupant record
- Collapse `tenants.json` + `residents.json` → `occupants.json`
- Keep originals as `.bak` until migration confirmed clean
- Fields: id, waId, waNumber, paymentId, name, houseCode, room, phone, email, nationality, moveInDate, moveOutDate, weeklyRent, status, bondAmount, bondStatus, idType, selfieFile, registrationId, source, addedAt, updatedAt

### Bank reconciliation
- `POST /mc/bank/reconcile` — decodes PaymentID from transaction description
- Fallback: last 4 digits of PaymentID + houseCode
- Unmatched → `bank-unmatched.json`

### SQLite threshold
- Migrate when: 1,500+ occupants OR 10,000+ transactions
- Schema ready to run (designed by Ledger)
- Tables: occupants, bank_transactions, payments, bonds, houses
- DB: `data/mission-control.db`

**Status:** Smith building PaymentID + reconciler. Ledger building SQLite schema. ✅

---

## 2026-03-09 — Echo v1 Scope
**Decision:** Echo v1 = template-only WA dispatcher. No AI replies.
**Why:** AI drafts can go wrong. Templates are safe, predictable, auditable. Build trust first.
**Templates:** welcome (new occupant), move-out checklist, group welcome, add/remove from group, broadcast
**Rule:** Nothing sends without Diego's explicit ✅ in Telegram
**Built by:** Thor (Diego-authorised)
**Status:** Thor building ✅

---

## 2026-03-09 — Orbit v1 Scope
**Decision:** Orbit = standalone WA message classifier service
**Why:** Separate service means WA bridge crash doesn't take Orbit down. Independent restart.
**Architecture:** `orbit.service` → taps WA bridge → classifies messages → POSTs to MC `/mc/messages`
**Tags:** maintenance, move-out, payment, registration, general
**Alerts:** move-out and maintenance → Telegram alert to Diego
**Manager portal:** `mc.housemates.online/manager` — Mathis + Emilio, zero financials
**Status:** Built by Smith ✅ (needs sudo service install)
