---
hyperspell_id: 64uLsNE4xD3KGw
---
# memory/finances.md — Finance & Banking
# Load when: payments, revenue tab, cash flow, bank statements, bonds, accounting

## Dashboard Finance Tab
- Revenue sub-pill password: `Mila2023!` (SHA-256: `318950856e...`)
- Main login password: `Concrete1234!` (SHA-256: `6fe72fd49a...`) — password-only, no username
- Managers see ZERO financials — manager subdomain shows partial view only

## Bank Statements
- Dir: `data/bank-statements/`
- Filename = house code (e.g. CO1.csv)
- 13 files received and parsed
- WL4 bank statement: still in image files 41–44 (not yet extracted)
- CSV import rules: every row = separate entry, NO deduplication
- Double payments same day = valid — keep both rows

## Payment History
- Excel source of truth: `data/Payments.xlsx` → `data/excel-payments.json`
- Route `/mc/tenant/payments` was returning 404 — unfixed as of 3 Mar
- Payslips: fortnightly, saved to `~/payslips_2026/` (13 generated Dec 2025–Jun 2026)
- XLSX → PDF: xlsx2html + weasyprint (python3)

## Tax & Business Structure
- Business operates cash basis
- Real income kept private; $80k/year figure for accountant discussion documents
- Summary: `data/tax-structure-summary.md`
- Security: never store employer names, ABNs, salary figures, super fund details

## Bank Feed Integration
- Basiq dropped (free tier blocks live connections)
- Salt Edge chosen (free tier, 50 connections — sufficient for 15 houses)
- Status: BLOCKED — awaiting Salt Edge approval response

## Bank Statement Import (Option 5 — planned)
- P&L, reconciliation, tax report, cash flow import, dashboard integration
- Not yet built — blocked until data structure confirmed
