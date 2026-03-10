# Vox Operations Guide
_Last updated: 2026-03-10 | Source of truth for day-to-day Vox usage_

---

## What Vox Is
Vox is the WhatsApp conversation agent. It handles inbound WA messages from tenants, prospects, and staff — routing them through flows, alerting Diego, and optionally auto-replying when enabled.

- **Port 8891** — inbound webhook (bridge pushes here)
- **Port 8892** — management API
- **Service:** user unit `/home/diegopalhano/projects/wa-ops-bot/` (NOT system unit — that one crashes)
- **Restart:** `kill -TERM <PID>` → systemd auto-restarts

---

## Thread Lifecycle (CRITICAL)

```
New message in → No thread?
  ├── Known occupant (active-tenants.json) → watchOnly + ping Diego
  ├── Has reg key (not yet moved in) → auto-flow (registration_recovery etc)
  └── Truly unknown → watchOnly + Rule 17 alert

Thread exists → active
  ├── autoFlow + approvedAutoFlow:true → Vox replies automatically
  ├── watchOnly:true → Vox pings Diego but NEVER replies
  └── escalated/stopAutomation → no auto-reply, Diego handles manually

Thread resolved → CLOSE IT
  - status: "closed"
  - No lingering watchOnly
  - Clean watch list = better follow-up
```

**Thread lifecycle rule:** Close threads when the purpose is solved. Do not leave stale threads open.

---

## Hard Rules

| Rule | Detail |
|------|--------|
| **Draft first** | EVERY WA message gets shown as draft to Diego before sending. No exceptions. |
| **Active tenants** | If in `active-tenants.json` → watchOnly + ping Diego. Never auto-flow. |
| **Auto-reply gate** | `approvedAutoFlow: true` required AND `watchOnly: false` for Vox to respond |
| **NEVER SILENT** | Every inbound (even watchOnly) must ping Diego on Telegram via @vox_wa_messages_bot |
| **Escalation lock** | Once escalated → `status: escalated`, no auto-replies, owner handles |
| **Bond returns** | Always "approximately a week as per house rules and occupancy licence" |
| **Kimi temperature** | Must be exactly `1` — no other value |
| **LID detection** | ≥14 digits → `@lid` suffix; standard AU numbers → `@c.us` |

---

## Flows Available

| Flow | Use When |
|------|----------|
| `registration_recovery` | Known contact with pending reg key hasn't submitted form |
| `replacement_screening` | Someone wants to take over a departing tenant's room |
| `new_tenant_intake` | New person moving in (from Flatmates, referral, etc.) |
| `staff_scheduling` | Coordinating inspections/tasks with Mathis or Emilio |
| `issue_resolution` | Active tenant reporting a problem |
| `temporary_resident_onboarding` | Short-stay guest (weeks, not months) |

---

## Telegram Bots

| Bot | Token | Use |
|-----|-------|-----|
| `@vox_wa_messages_bot` | `8755441223:AAF6uGEl9hys6sMqIOdPWyVPXSGWf8IuFoY` | ALL Vox alerts → Diego |
| `@updatemonibot` | `8788866437:AAElp1-FUBUdMb18sD5Ks9HUBmcLGBf0Bsc` | System status + `/vox rr` |
| `@jess_flatmatesbot` | `8660019141:AAEa8Oaext8nL7-Rbk505lrlbdxlbn5EmX0` | Jess alerts + completion pings |

---

## `/vox rr <phone>` Command (monitor bot)
- Shows last inbound message from that contact
- Generates Kimi draft reply
- Send/Skip inline buttons
- Diego-only (chat ID `1267601160` enforced)

---

## Replying to Vox Alerts
- **"Sure" / "ok" / "yes" / "approve"** → sends Kimi's draft as-is
- **"skip"** → dismisses, no send
- **Any other text (as reply)** → Kimi refines draft using your instruction
- **"send: <your text>"** → sends your verbatim text directly

---

## Common Issues & Fixes

| Problem | Cause | Fix |
|---------|-------|-----|
| "Already handled" on reply | No tg-pending entry for that message | Cleared — NEVER SILENT now always creates pending entry |
| Vox replying to active tenants | Auto-thread was too aggressive | Fixed (commit `b19ecaa`) — active-tenants.json = watchOnly only |
| Stuck "Refining draft (round 1)..." | Null draft + Kimi call hung | Clear `tg-pending.json` null entries, restart Vox |
| Wrong `@c.us` for LID contact | LID not detected | LIDs are ≥14 digits — use `@lid` suffix |
| Multiple Vox instances | systemd restart + old process not dead | `lsof -i :8891` → kill the one listening, let systemd restart |

---

## Key Files

```
/home/diegopalhano/projects/wa-ops-bot/
├── index.js                    ← Main entry + routing logic
├── data/
│   ├── wa-threads.json         ← Thread state (phone → thread object)
│   ├── tg-pending.json         ← Pending Telegram approval entries
│   └── staff-whitelist.json    ← Additional staff numbers
├── flows/
│   ├── registration_recovery.js
│   ├── replacement_screening.js
│   ├── new_tenant_intake.js
│   ├── staff_scheduling.js
│   ├── issue_resolution.js
│   └── temporary_resident_onboarding.js
├── lib/
│   ├── tg-poller.js            ← Telegram polling + Kimi draft generation
│   ├── escalate.js             ← Escalation + owner notifications
│   ├── state.js                ← Thread state management
│   └── send.js                 ← WA send (handles LID detection)
└── logs/
    └── audit-YYYY-MM-DD.jsonl  ← Full inbound/outbound audit log
```

---

## Whitelist Sources (6 total)
Vox checks all of these to determine if a contact is "known":
1. `staff-whitelist.json`
2. `active-tenants.json` ← if found here → watchOnly only
3. `tenants.json`
4. `residents.json`
5. `tenant-crossref.json`
6. `registration-keys.json` (anyone with an assigned key)
