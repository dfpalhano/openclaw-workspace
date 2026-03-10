# Inspection Scheduling Flow
_Created: 2026-03-10 | Status: v1 — drafted from live session, needs refinement_

---

## Purpose
When Mathis (or Emilio) is available, coordinate same-day property inspections via Jess + Vox.

---

## Trigger
Vox sends Mathis: **"Are you working today?"**
→ If yes → offer inspections → scheduling flow begins.

---

## Flow

```
[Diego / Atlas]
     │
     ▼
[Vox → Mathis via WA]
"Are you working today?"
     │
     ├── NO → "Enjoy your day off 😊"  → END
     │
     └── YES
          │
          ▼
     [Atlas checks vacancy data]
     - Pull available rooms from memory/properties/index.md
     - Pull Flatmates lead count per house from jess-enquirers.json
     - Build room list with lead count
          │
          ▼
     [Vox → Mathis]
     "Here are the available rooms + lead counts.
      Which ones would you like to inspect today?"
          │
          ▼
     [Mathis replies with house list]
          │
          ▼
     [Atlas: Scheduling calculation]
     For each house requested:
       - Minimum 2 hours lead time from Jess Flatmates message send
       - Each inspection slot = ~20 minutes
       - Add travel time between houses (estimate 15-30 min depending on distance)
       - Build time-ordered inspection schedule
          │
          ▼
     [Atlas → Diego: shows schedule for approval]
     "Mathis wants: CO1, EB3, EB2
      Proposed schedule:
        4:30pm — CO1 R4 (Coorparoo)
        5:10pm — EB3 R1+R3 (East Brisbane, 20 min travel)
        5:50pm — EB2 R1+R7 (East Brisbane, 10 min)
      Jess sends Flatmates messages now (2hr lead time = ✅)"
          │
          ├── Diego APPROVES
          │     │
          │     ▼
          │   [Jess sends Flatmates message to leads for each house]
          │   Message includes: address, time slot, contact
          │   (NO house code, NO bot mention — Flatmates rules)
          │     │
          │     ▼
          │   [Jess monitors replies → reports in MC Jess inbox]
          │     │
          │     ▼
          │   [Vox → Mathis: confirmed schedule]
          │   "All set! Here's your schedule:
          │    4:30pm CO1 — [address]
          │    5:10pm EB3 — [address]
          │    etc."
          │
          └── Diego EDITS/REJECTS → modify schedule → re-confirm
```

---

## Rules

| Rule | Detail |
|------|--------|
| **Lead time** | Minimum **2 hours** from when Jess sends Flatmates message to inspection time |
| **Slot length** | ~**20 minutes** per house inspection |
| **Travel time** | Build into schedule — estimate 15–30 min between houses depending on distance |
| **Stack limit** | Practical max ~4-5 houses per day for one person |
| **Flatmates rules** | No house code, no bot mention, first contact = availability only (address sent on confirmation) |
| **Confirmation gate** | Diego approves the full schedule before Jess sends any messages |
| **SP9** | Emilio's territory — Mathis does Brisbane houses only unless instructed |

---

## Houses Mathis Can Inspect (Brisbane only)
| House | Address | Suburb |
|-------|---------|--------|
| CO1 | 37 Marian St | Coorparoo |
| EB1 | 553 Vulture St E | East Brisbane |
| EB2 | 606 Vulture St E | East Brisbane |
| EB3 | 69 Gresham St | East Brisbane |
| GS1 | 111 Juliette St | Greenslopes |
| SB1 | 15 Cameron St | South Brisbane |
| SH1 | 40 Rosa St | Spring Hill |
| SH2 | 36 Rosa St | Spring Hill |
| SH3 | 41 Park St | Spring Hill |
| V5 | 157 Warry St | Fortitude Valley |
| WE1 | 3 Hardgrave Rd | West End |
| WL3 | 28 Taylor St | Woolloongabba |
| WL4 | 43 Redfern St | Woolloongabba |

---

## Data Sources
- **Vacancy data:** `memory/properties/index.md` + `active-tenants.json`
- **Lead counts:** `jess-enquirers.json` (per houseCode, active statuses only)
- **Flatmates send:** inject into `jess-pending.json` → Jess Chrome extension fires
- **Reply monitoring:** Jess scrapes → appears in MC `/mc/jess` inbox
- **Staff scheduling:** Vox `staff_scheduling` flow on Mathis's thread

---

## TODO / Improvements
- [ ] Build travel time matrix between all Brisbane houses (distance/time lookup)
- [ ] Auto-calculate optimal inspection route (nearest-neighbour)
- [ ] Add Jess lead count directly to Vox's scheduling message (pull live from jess-enquirers.json)
- [ ] Track inspection outcomes in MC (showed up / no-show / interested / not interested)
- [ ] Emilio's equivalent flow for SP9 + Gold Coast properties
- [ ] Calendar integration — block inspection times so Diego can see
- [ ] If 0 leads for a house → suggest posting Flatmates ad first before scheduling inspection
