# Bank Import System — Full Spec & Status
# Last updated: 2026-03-18

## Overview
MC bank import processes per-house CSV/PDF statements + one central bills account.
All flows: upload → parse → review → confirm → data lands in correct MC tabs.

---

## Bank Map (from house-bank-accounts.json)
| BSB | Bank | Houses | Parser |
|-----|------|--------|--------|
| 063, 064 | CommBank | SH1, CO1 | commbank |
| 084 | NAB | SH2, WL3 | nab |
| 014, 013 | ANZ | EB1, WE1 | anz |
| 342 | HSBC | SB1 | hsbc |
| 923 | ING | GS1, EB2 | ing |
| 124 | BOQ | SP9, EB3 | boq |
| 484 | Suncorp | V5, SH3, WL4 | suncorp |
| 638 | Heritage Bank | BRIS1 | heritage (BOQ format) |
| 734 | Westpac bills | Personal/all houses | westpac_bills |

Source file: `/home/diegopalhano/projects/mission-control/data/house-bank-accounts.json`

---

## File Locations
- Parser module: `/home/diegopalhano/projects/mission-control/db/bank-parsers.js`
- Upload endpoint: `POST /mc/bank-import/upload`
- Match endpoint: `POST /mc/bank-import/match`
- Confirm endpoint: `POST /mc/bank-import/confirm`
- Skip endpoint: `POST /mc/bank-import/skip`
- Rules: `GET/POST /mc/bank-import/rules`, `PATCH/DELETE /mc/bank-import/rules/:id`
- Detect house: `POST /mc/bank-import/detect-house`
- Rules file: `data/bank-import-rules.json`
- Transactions: `data/bank-transactions.json`
- Manifest: `data/bank-imports/manifest.json`

---

## Upload Flow (per-house accounts)
1. Upload CSV or PDF → parser auto-detects bank from content + BSB lookup
2. House auto-tagged from filename (e.g. SH1.csv → SH1) or inferred from transactions
3. Per-file house dropdown shown — pre-filled with suggestion, user can override
4. Duplicate detection: same date+amount+description → skipped with count shown
5. Review table filtered by house pill (one house at a time)

---

## Review Table Features
- ✅ Confirm / ✏️ Edit / ❌ Skip per row
- "Remember this rule" checkbox → saves to bank-import-rules.json
- House filter pills (auto-activates for uploaded house)
- Category column: 💵 rent, 🔒 bond, 💸 expense, ↩️ bond_return
- Confirmed rent/bond → writes to payments.db
- Confirmed expense → writes to expenses.json (appears in Expenses tab)

---

## Westpac Bills Account (BSB 734-109)
- Diego's personal bills account — pays expenses across ALL 15 houses + personal
- Each transaction needs: House dropdown (15 houses + "Personal") + Category dropdown
- Categories: electricity, internet, water, gas, insurance, strata, maintenance, personal, transfer, other
- Personal → excluded from property P&L
- Upload: PDF format (Westpac Choice Transactions)
- 503 transactions in current PDF (Mar 2025 – Mar 2026)

---

## Email ↔ Bank Matching
- Gmail expense scanner creates records in expenses.json (from AGL/Alinta/TPG invoices)
- Westpac bills import creates records in bank-transactions.json (actual debits)
- Same expense appears in both → system suggests match (amount ±5%, date ±7 days, description fuzzy ≥60%)
- User clicks "Link" → merged into one record, no duplicate
- After 3 manual links → autoLink: true → future imports auto-link silently
- Canonical record: email expense; bank transaction = payment confirmation

---

## Learning Rules (bank-import-rules.json)
```json
{
  "matchOn": "description_contains",
  "value": "AGL SALES PTY LT 160012229",
  "houseCode": "SH1",
  "category": "electricity",
  "autoApprove": false,
  "approvalCount": 0,
  "minApprovals": 3,
  "emailKeyword": "AGL",
  "autoLink": false
}
```
- approvalCount >= minApprovals → autoApprove: true (auto-activates)
- autoLink: true → email/bank auto-linked silently after 3 manual links
- Rule management UI: 🔧 Import Rules section in Bank Import panel

---

## Where Data Lands
| Confirmed as | Destination | MC Tab |
|-------------|-------------|--------|
| rent | payments.db | 💰 Rent Roll |
| bond | payments.db | 💰 Rent Roll / Bond tracker |
| expense | expenses.json | 📊 Expenses |
| bond_return | bond-return-requests.json | Bond Returns |
| personal | nowhere (excluded) | — |

---

## Rent Payments Tab (💰 Rent Roll)
- Shows: bank import confirmed rent + paydb + cash entries + Excel imports
- ↻ Refresh button → pulls all sources
- + Add Cash Payment → quick modal for EB3/CO1 cash payers
- Cash fields: occupant, week starting, amount, date received, notes
- All rows editable (click → edit modal)
- Source badges: 💳 Bank / 💵 Cash / 📊 Excel / 🏦 PayDB

---

## Occupant Payment History (unified)
All three views use same data:
- 📊 View Full History modal — all sources merged, chronological, source badges
- 💳 Payment Ledger — week-by-week from move-in, status flags
- 🖨 Print / Download PDF — generated from unified ledger

Endpoint: GET /mc/occupant/:id/ledger (backbone)
Status flags: ✅ paid | ⚠️ late | ❌ unpaid | 🔁 double | 🔸 partial

---

## Git Commits (bank import system)
| Commit | What |
|--------|------|
| 9b931da | Multi-file CSV upload support |
| 0b3ef90 | House auto-tag + confidence scoring + categorisation + BOQ PDF |
| f518443 | House detection UI + per-file dropdown + category column |
| aef6b67 | Transaction approval + learning rules |
| 51cd4ca | Per-house filter pills |
| 2e89c55 | Bank-specific CSV parsers (ANZ, NAB, ING, Westpac/Suncorp, BOQ) |
| (Smith) | HSBC parser + CommBank/CO1 + getBankForHouse() |
| b853469 | Westpac bills PDF + multi-house allocation + auto-approve threshold |
| (Smith) | Rent Payments tab wire + cash entries + email↔bank matching |

---

## Cash Payers (no bank import)
- EB3: all occupants pay cash
- CO1: all occupants pay cash
- Use "+ Add Cash Payment" button in Rent Roll tab
