# Property Index — load this first, then pull the specific property file only if needed

## Active Properties (15 total)
| Code  | Address                        | Agent         | File         | Flags |
|-------|-------------------------------|---------------|--------------|-------|
| CO1   | 37 Marian St, Coorparoo        | —             | CO1.md       | Vacancy R4 |
| EB1   | 553 Vulture St E, East Brisbane| —             | EB1.md       | |
| EB2   | —                              | —             | EB2.md       | Vacancy R1, R7 |
| EB3   | —                              | —             | EB3.md       | Vacancy R1, R3 |
| GS1   | —                              | —             | GS1.md       | Prices needed |
| SB1   | —                              | —             | SB1.md       | Inspection 18 Mar |
| SH1   | —                              | Coronis (new) | SH1.md       | 🔴 new agent, inspection imminent |
| SH2   | 36 Rosa St                     | —             | SH2.md       | Owner visit before 20 Mar |
| SH3   | —                              | Place Graceville | SH3.md    | 🔴 inspection soon + arrears |
| SP9   | 4/44 Watson Esp (= 4/50 Peninsular Dr), Surfers | — | SP9.md | Vacancy R3 |
| V5    | —                              | Leo Tsimpikas | V5.md        | 🔴 first inspection due |
| WE1   | 111 Juliette                   | —             | WE1.md       | |
| WL3   | —                              | —             | WL3.md       | Prices needed |
| WL4   | —                              | —             | WL4.md       | Raphaël cash payer |
| BRIS1 | —                              | —             | BRIS1.md     | |

## Quick Rules
- Bond = 2.5 weeks rent, fixed
- Cash payers: CO1, EB3, Raphaël (WL4) → `data/cash-payers.json`
- Room numbering: clockwise from entry, ground floor first → `data/room-numbering-rules.md`
- Low priority enquirers (age >40): skip first contact, decline if they follow up
- Active tenants: `data/active-tenants-excel.json` (139 tenants)

## Jess Data Files
- `data/jess-enquirers.json` — enquirer profiles
- `data/jess-pending.json` — pending approval queue
- `data/bond-tracker.json` — bond status per tenant

## WA Groups (confirmed)
- WORK General: `120363424849467954@g.us`
- WORK Checklist Houses: `120363405280591139@g.us`
- House group IDs: NOT verified — do NOT script sends until confirmed
