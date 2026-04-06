---
hyperspell_id: C_E6I591WAfcAA
---
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
| SH1   | —                              | Coronis (new) | SH1.md       | 🔴 new agent, inspection imminent | 🟡 Andrea Faso departed 2026-03-10 — room vacant, seeking replacement |
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

## WA Groups (confirmed — locked 2026-03-10)
- WORK General: `120363424849467954@g.us`
- WORK Checklist Houses: `120363405280591139@g.us`

### House Groups (confirmed by owner 2026-03-10)
| Code | Group Name | JID |
|------|-----------|-----|
| CO1  | Entertainers Paradise Coorparoo 🏡 | `120363300299462258@g.us` |
| EB3  | 🌴East Brisbane Resort family🌴 | `120363403136537362@g.us` |
| EB2  | 🌳🌠EB Paradiso🇦🇺🏡 606 Vulture | `120363270182260588@g.us` |
| EB1  | 🌴Eastside Sanctuary 🌳 EastBris Fam | `120363179855324665@g.us` |
| SH2  | Mathilde Val 36 Rosa St Spring Hill | `120363406338761444@g.us` |
| WE1  | 🚗🏡♥️ Juliette Junction ❤️🌿🌆 Greenslopes | `120363150005097135@g.us` |
| WL3  | Woolloongabba Family General WL3 | `120363371022106088@g.us` |
| GS1  | Sasha Killian GS1 group 🇫🇷 | `120363404002997676@g.us` |
| SB1  | South Brisbane Family | `120363332344223581@g.us` |
| SP9  | (unconfirmed) | — |
| SH1  | Spring Hill Casa | `120363166595799274@g.us` |
| SH3  | Little room SH3 | `120363405251540377@g.us` |
| V5   | (unconfirmed) | — |
| WL4  | Charlène & Emma 43 Redfern St Woolloongabba | `120363424354100059@g.us` |
| BRIS1| (unconfirmed) | — |

⚠️ Unconfirmed JIDs (SP9, V5, BRIS1) — do NOT script sends until owner confirms.
