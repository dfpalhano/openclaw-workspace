---
hyperspell_id: YOdETNe4oMCXoQ
---
# memory/tenants.md — Tenant & Property Data
# Load when: bond tracker, inspections, WA messages, vacancy management, move-outs

## Houses (15 total)
CO1, EB1, EB2, EB3, GS1, SB1, SH1, SH2, SH3, SP9, V5, WE1, WL3, WL4, BRIS1

## SP9 Special Note
SP9 = 4/44 Watson Esplanade = 4/50 Peninsular Drive, Surfers Paradise — beside minimarket

## Current Vacancies (as of 3 Mar 2026)
| House | Room | Single | Couple | Available | Notes |
|-------|------|--------|--------|-----------|-------|
| SP9   | R3   | $310   | n/a    | NOW       | singles only |
| CO1   | R4   | $360   | $460   | 05/03     | Rina leaving |
| EB3   | R1   | $520   | $520   | 07/03     | Gaston+Judy leaving |
| EB3   | R3   | $360   | —      | NOW       | David left |
| SH1   | R1   | $330   | —      | 08/03     | Arnold leaving |
| SH3   | R5   | $360   | $430   | 09/03     | Max leaving (balcony) |
| EB2   | R1   | $400   | $450   | 14/03     | James+Ioana leaving |
| EB2   | R7   | $270   | n/a    | 15/03     | Asia leaving (small single) |
Prices still needed: SH2, SB1, WE1, GS1, WL3, WL4, EB1, V5, BRIS1

## People on Notice (move-outs)
- Rina — CO1 (leaves 05/03)
- Gaston + Judy — EB3 R1 (leaves 07/03, couple)
- Arnold — SH1 (leaves 08/03)
- Max — SH3 (leaves 09/03)
- James + Ioana — EB2 R1 (leaves 14/03)
- Asia — EB2 R7 (leaves 15/03)
WA IDs needed for all above (add waId field to bond-tracker.json when known)

## Bond Tracker
- File: `/home/diegopalhano/projects/mission-control/data/bond-tracker.json`
- Keys: `onNotice`, `pending`, `resolved`, `updatedAt`
- Bond = 2.5 weeks rent, fixed
- Bond payments: single bank account per room; couples pay together
- Chloé + Hugo Pain (V5) — awaiting bank details; reminder set 9 March
- Egon + Benjamin (EB2) — chase bank details ($430 combined)
- Andrea Faso (SH1) — due this week (left 1 Mar)

## Cash Payers
CO1, EB3, Raphaël (WL4) — data in `data/cash-payers.json`

## Inspections March 2026
- Wed 4 Mar: EB2 Routine
- Thu 5 Mar: EB1 Routine (553 Vulture St E, East Brisbane) — calendar event 01us1614bqp9bqu8t58ihbop30
- Wed 18 Mar: SB1 Routine

## Room Numbering Rules
- Clockwise from entry door, entry floor first then up
- Stairs = reference on floors with no street access
- Ensuite = private shower + toilet
- Private shower = shower only + shared toilet (SP9 only)
- SH1/SH2: Douglas St = ground floor entry (NOT first floor)
- SH3, EB1, EB2: first floor entry
Full rules: `data/room-numbering-rules.md`

## Group Removal Schedule
- Arnold (SH1): after 8 Mar
- Max (SH3): after 9 Mar
- Gaston+Judy (EB3): 7–8 Mar
- Rina (CO1): 5 Mar
- Asia (EB2): 15 Mar

## WA Group IDs (confirmed)
- WORK General: `120363424849467954@g.us`
- WORK Checklist Houses: `120363405280591139@g.us`
- House group IDs: NOT yet verified — do NOT script sends until confirmed

## Jess Enquirers
- File: `data/jess-enquirers.json` (38 enquirers)
- File: `data/jess-pending.json` (35 entries after dedup)
- Status progression: new → profile_requested → viewing_pending → invited → confirmed
- Priority: manually assigned (high/normal/low); age > 40 = auto low
- Low priority: skip on first contact, decline if they follow up

## Jordan + Kane SP9
- Weekly rent rate unconfirmed — assign to room + update active-tenants when known

## Data Files
- Active tenants: `data/active-tenants-excel.json` (139 tenants)
- Excel source of truth: `data/Payments.xlsx`
- Bank statements dir: `data/bank-statements/`
- WA exports: `data/wa-exports/` (38+ .txt files)
- Room maps: `data/room-maps.md`
