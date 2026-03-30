# Tenant Onboarding Guide
_Last updated: 2026-03-10 | How a new tenant goes from lead → registered → moved in_

---

## Full Flow

```
Flatmates enquiry
  └── Jess sends availability check
        └── Lead interested → viewing invite (2hr min lead time)
              └── Viewing done → Vox new_tenant_intake flow
                    ├── Collect: move-in date, # people, work/study
                    └── Send registration form link
                          └── Form submitted
                                ├── Docs accepted → send holding message only (waiting for payment)
                                └── Payment confirmed → send welcome package + documents
                                      └── Move-in day → thread closed
```

---

## Registration Form
- **URL format:** `https://forms.housemates.online/r/<key>` — ALWAYS this format
- **NEVER use:** `mc.inspectionsxraytesting.com.au` — deprecated
- **Keys:** in `MC/data/registration-keys.json` → `assignedTo.whatsapp` field

---

## Payment Details (by house)
All in `MC/data/house-bank-accounts.json`:
```json
{
  "houses": {
    "EB1": { "bsb": "014002", "account": "231444039" },
    ...
  }
}
```
**Payment reference:** `<paymentId> <houseCode>` — from `registration-keys.json` → `paymentReference`

---

## Vox Flows by Scenario

| Scenario | Flow |
|----------|------|
| New person from Flatmates | `new_tenant_intake` |
| Replacing departing tenant | `replacement_screening` |
| Friend/family short stay (2-4 weeks) | `temporary_resident_onboarding` |
| Active tenant with question | watchOnly + ping Diego (never auto-flow) |
| Staff scheduling inspections | `staff_scheduling` |
| Registration form issues | `registration_recovery` |

---

## Known Data Issues to Watch For
- **LID contacts** (≥14 digit IDs from WA): must use `@lid` suffix, not `@c.us`
- **French numbers** often come in as LIDs (e.g. Noémie = `107941202002047@lid`)
- **`active-tenants.json`** = currently living there. Never auto-flow these.
- **`jess-enquirers.json`** often sparse — use `jess-inbox.json` for lead counts

---

## Current Vacancies (as of 2026-03-10)
| House | Address | Room | Notes |
|-------|---------|------|-------|
| CO1 | 37 Marian St, Coorparoo | Room 4 | 4 Flatmates leads |
| EB2 | 606 Vulture St, East Brisbane | Room 1, Room 7 | 9 leads, inspection Fri 13/03 |
| SH1 | 40 Rosa St, Spring Hill | Room 1 | 10 leads, inspection tonight |
| SH2 | 36 Rosa St, Spring Hill | Room 1 | Laura moving in, inspection Fri 13/03 |
| WL4 | 43 Redfern St, Woolloongabba | Ensuite | Noémie in intake, Kinan replacing Victor |
| EB1 | 553 Vulture St, East Brisbane | - | Swan confirmed, move-in 14 Mar |

---

## Replacement Process (existing tenant leaving)
1. Departing tenant confirms move-out date
2. List room on Flatmates if not already listed
3. Jess collects leads
4. Viewing scheduled (Mathis or Emilio)
5. Replacement chosen → `replacement_screening` Vox flow
6. Reg key assigned → form sent
7. Form submitted → docs may be accepted, but this does **not** trigger the welcome package
8. Payment confirmed → welcome package + documents sent
9. Move-in date locked in
10. Departing tenant: bond return processed (≈1 week)
11. Group: welcome new person

---

## Bond Returns
- Always: "approximately a week as per house rules and occupancy licence"
- Bond return tracker: `MC/data/bond-tracker.json`
- Bond return requests: `MC/data/bond-return-requests.json`
