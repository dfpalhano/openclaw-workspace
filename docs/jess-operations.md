# Jess Operations Guide
_Last updated: 2026-03-10 | Flatmates automation agent_

---

## What Jess Is
Jess is the Flatmates.com.au automation agent. She scrapes conversations from Flatmates via a Chrome extension relay, manages lead queues, and sends viewing invites.

- **Service:** `jess-v3.service` (systemd user unit)
- **Script:** `/home/diegopalhano/projects/jess-bot/jess-v3.js`
- **Poll interval:** Every 2 minutes
- **Relay port:** `3847` (Chrome extension sends data here)
- **Relay callback:** `http://127.0.0.1:3848/relay-callback`

---

## Architecture

```
Chrome (Flatmates tab)
  └── Jess Bridge Extension
        └── POST → localhost:3847/relay-callback
              └── Jess v3 processes conversations
                    ├── jess-pending.json (outbound queue)
                    ├── jess-inbox.json (MC inbox)
                    └── jess-enquirers.json (lead profiles)
```

---

## Key Data Files

| File | Location | Purpose |
|------|----------|---------|
| `jess-inbox.json` | `MC/data/` | **Primary lead store** — 120 convos as of 2026-03-10 |
| `jess-enquirers.json` | `MC/data/` | Lead profiles (often sparse — jess-inbox is richer) |
| `jess-pending.json` | `jess-bot/data/` | Outbound queue — inject here to send Flatmates messages |
| `jess-rooms.json` | `jess-bot/data/` | All 15 house addresses + vacant rooms |
| `jess-filter.json` | `jess-bot/data/` | Scrape filter (currently: last_30_days, all houses) |
| `jess-inspections.json` | `MC/data/` | Scheduled inspection slots |
| `house-bank-accounts.json` | `MC/data/` | BSB + account per house |

---

## Lead Counts (as of 2026-03-10 18:00 AEST)
From `jess-inbox.json` — active last 24h:
| House | Active leads |
|-------|-------------|
| SP9 | 12 |
| SH1 | 10 |
| EB2 | 9 |
| CO1 | 4 |
| EB3 | 0 (reported FULL by Mathis) |

---

## Sending Viewing Invites

### Manual injection into jess-pending.json
```python
pending.append({
    'id': f'{houseCode}_{convId}',
    'houseCode': 'SH1',
    'name': 'FirstName LastName',
    'convUrl': 'https://flatmates.com.au/messages/201271085',
    'status': 'pending',
    'source': 'atlas_inspection_blast',
    'message': 'Hey [Name]! The room is still available 😊 ...',
    'addedAt': now_iso,
    'slot': '19:00',
    'slotLabel': 'tonight 7pm',
})
```

Jess picks up on next 2-minute cycle and sends via relay.

### Flatmates message rules (NON-NEGOTIABLE)
- NEVER mention house code
- NEVER reveal it's automated
- First contact = availability only (no address)
- Address included only in confirmed viewing invite

---

## Inspection Scheduling Flow

```
Mathis/Emilio available?
  └── YES
        ├── Pull active leads from jess-inbox.json per house (lastActive ≥ yesterday)
        ├── Show Diego: house list + lead counts
        ├── Diego approves schedule
        └── Inject into jess-pending.json → Jess sends Flatmates messages
              └── 2-HOUR MINIMUM LEAD TIME from send to inspection
```

**Timing rules:**
- ~20 min per house inspection
- +15–30 min travel between houses
- Emilio = SP9/Gold Coast; Mathis = Brisbane houses
- Diego must approve full schedule BEFORE Jess sends anything

---

## Completion Ping
After each poll cycle, Jess sends a Telegram message to Diego via `@jess_flatmatesbot` with:
```
🏠 Jess scrape done
Active leads (online ≥ yesterday):
SH1: 10 active leads
EB2: 9 active leads
CO1: 4 active leads
...
```

---

## Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| `MC jess/fetch returned 404` | MC running old code (no restart after commit) | `kill -HUP <MC_PID>` to restart MC |
| 0 leads for all houses | Filter too narrow OR extension not connected | Check `jess-filter.json`, reload Chrome extension |
| Lead has no gender/couple data | Profile page not scraped | Extension must be active + on Flatmates inbox |
| Extension not connected | Chrome not open / extension disabled | Reload at `chrome://extensions` → Jess Bridge → Reload |

---

## Chrome Extension Reload (when Jess stops scraping)
1. Open Chrome
2. Go to `chrome://extensions`
3. Find "Jess Bridge" → click Reload
4. Open a Flatmates.com.au inbox tab
5. Jess will pick up on next 2-min cycle

---

## MC Panel
Jess inbox available at: `http://localhost:8899/mc/jess`
- View all leads
- Generate AI reply drafts
- Approve/skip/send responses
- View lead status by house
