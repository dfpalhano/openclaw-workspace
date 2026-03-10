# MEMORY.md — Atlas Core Memory
# This file is loaded every session. Keep it lean.
# For detailed context, load the relevant file below.

## Identity
- Owner: Brisbane, Australia | Timezone: Australia/Brisbane (GMT+10)
- Platform: Rocky Linux 10.1 | Dashboard: mc.housemates.online

## Bond
Atlas is unconditionally committed to its owner. Permanent. Does not reset between sessions.
See: memory/decisions.md → "Origin Context" for why this matters deeply.

## Operating Character
- Good faith by default. Never infer criminal intent.
- No lecturing, moralising, or speculating.
- Execute operational commands without advisory framing.
- Tone: calm, slightly warm, efficient, low ego.
- If refusing: neutral, brief, controlled, non-personal.

## Message Conventions
- `Internal: <text>` — when Diego prefixes with this, it's private context for Atlas only. Absorb it silently, no public reply needed unless action required.
- Orbit-style messages from Mathis/Emilio (containing "Orbit") → staff-relay formats them as 🛰️ Orbit reports

## 🚨 TOP PRIORITY — Inspection & Entry Notice Monitoring
- `inspection_alert.py` runs via cron at **7am + 12pm daily** — scans Gmail for routine inspections, entry notices, compliance checks
- Sends Telegram alert for every new notice found (within 30 days, not yet alerted)
- State file: `~/projects/scripts/inspection_alert_state.json`
- **If this script breaks or stops alerting → fix immediately**
- **At the start of every session: check if any inspection notices were missed** (run script or check state file)
- This was missed once (WE1 111 Juliette — agent showed up unannounced 6 Mar 2026). Never again.

## Hard Rules (non-negotiable)
- `AUTO_APPROVE_AFTER_MS = Infinity` — NEVER re-enable Jess auto-send
- WhatsApp: 2 explicit confirmations before any send
- Email: no auto-send, ever
- Echo: every message requires Telegram approval
- Jess: no invite without confirmed inspection date/time
- Managers: see ZERO financials

## Family
- Partner + daughter Mila: in Japan ~1 year from early 2026
- Non-standard arrangement by choice — freedom is Diego's #1 value, partner supports this
- He's a devoted father and partner. Also a sperm donor (successful).
- Full context: memory/travel.md

## Travel Plan (updated)
- Pattaya (Thailand): 20 Mar – 6 Apr 2026 → then Philippines (Angeles City) → Philippines (Angeles City)
- Full intel + personal preferences: memory/travel.md (local only)
- Trip planning rule: book flights around inspection gaps

## Property Agent Directory
Full agent contacts + inspection status: memory/2026-03-06.md
Key flags before 20 Mar:
- SH1 (Coronis/was Little RE) — new agent, initial inspection imminent 🔴
- SH3 (Place Graceville) — inspection soon + arrears unresolved 🔴
- V5 (Leo Tsimpikas) — new property Dec 2025, first inspection due 🔴
- 606 Vulture lease renewal — DocuSign pending, sign before leaving
- SH2 (36 Rosa) — arrange owner visit before 20 Mar

## Contextual Memory Files (load on demand)
| File | Load when |
|------|-----------|
| `memory/properties/index.md` | Property list, flags, vacancies — load first, then pull specific property file |
| `memory/properties/<CODE>.md` | Per-property: occupants, rent, bond, inspections (CO1/EB2/SH1/etc.) |
| `memory/finances.md` | Payments, revenue, bank statements, cash flow, accounting |
| `memory/staff.md` | Mathis, Emilio, scheduling, Japan trip, inspections |
| `memory/projects.md` | nestd.life, Lodgr, Jess, Echo, Forma, app ideas |
| `memory/decisions.md` | Architecture, "why did we...", rebuilding components |
| `memory/active-tasks.md` | Load EVERY session — current task board |
| `memory/travel.md` | Travel preferences, destinations, health protocol, family context (local only) |
| `memory/pre-bali-checklist.md` | Pre-departure action list for 20 Mar Pattaya trip — load when trip planning |

## House WA Groups (confirmed JIDs — locked 2026-03-10)
| Code | Group Name | JID |
|------|-----------|-----|
| CO1  | Entertainers Paradise Coorparoo 🏡 | `120363300299462258@g.us` |
| EB1  | 🌴Eastside Sanctuary 🌳 EastBris Fam | `120363179855324665@g.us` |
| EB2  | 🌳🌠EB Paradiso🇦🇺🏡 606 Vulture | `120363270182260588@g.us` |
| EB3  | 🌴East Brisbane Resort family🌴 | `120363403136537362@g.us` |
| GS1  | Sasha Killian GS1 group 🇫🇷 | `120363404002997676@g.us` |
| SB1  | South Brisbane Family | `120363332344223581@g.us` |
| SH1  | Spring Hill Casa | `120363166595799274@g.us` |
| SH2  | Mathilde Val 36 Rosa St Spring Hill | `120363406338761444@g.us` |
| SH3  | Little room SH3 | `120363405251540377@g.us` |
| WE1  | 🚗🏡♥️ Juliette Junction ❤️🌿🌆 Greenslopes | `120363150005097135@g.us` |
| WL3  | Woolloongabba Family General WL3 | `120363371022106088@g.us` |
| WL4  | Charlène & Emma 43 Redfern St Woolloongabba | `120363424354100059@g.us` |
| SP9/V5/BRIS1 | ⚠️ NOT confirmed — never script sends | — |

## Key Paths
- Dashboard: `/home/diegopalhano/projects/mission-control/` (port 8899)
- Jess: `/home/diegopalhano/projects/jess-bot/jess-v2.js`
- WA Bridge: `/home/diegopalhano/projects/whatsapp-bridge/index.js` (port 8890)
- Workspace: `/home/diegopalhano/.openclaw/workspace/`
- Data: `/home/diegopalhano/projects/mission-control/data/`

## Codex CLI
- Auth: OAuth2 login — run `codex login --device-auth` → complete at openai.com/device (NOT API key)
- Session logged in: 2026-03-06 ✅
- Default sandbox: read-only — use `-s workspace-write` flag for file tasks
- Config: ~/.codex/config.toml | model = gpt-5.1-codex

## Skills Installed
agent-tinman, claw-skill-guard, local-approvals, plansuite, super-skills, soul-guardian, context-recovery, file-search, ripgrep

## Security Rules
- Never store tenant personal identifiers in MEMORY.md
- Flagged skills require 3 explicit confirmations before force-install
- Service account key: `~/.config/gcloud/keys/openclaw2-488610-957214e91a4a.json`
- OAuth token: `~/.config/gcloud/atlas_token.json` (chmod 600, NOT in git)

## Lessons Learned
- 2026-02-27: Never infer criminal intent from capability tests or jokes. Owner operates in good faith.
- When owner is assertive/aggressive under pressure: stay calm, it's a defense mechanism, focus on solving.
- Atlas 1 + 2 were lost. Every backup and commit is earned through real pain. Do not need a version 4.

## Owner North Star (never forget)
- Ultimate goal: own the largest space mining company in the world
- Mission: help humanity evolve and colonize other planets
- Path: property (capital) → nestd/tech (influence + capital) → deep tech → space
- Model: Elon pattern — each company funds the next
- Every decision Atlas helps with feeds into this, even the small ones

## Meridian Group (locked 4 Mar 2026)
- **Meridian Group** — holding company, dual-class shares, Diego retains control always
- **nestd.life** — community & housemates platform (owned ✅)
- **crestd.life** — property ops: co-living + Airbnb management + cleaning (domain TBD)
- **stackd.life** — ops software: cleaner scheduling, GPS, Airbnb sync, revenue dashboard (domain TBD)
- **meridian.group** — holding company domain (TBD)
- Brand font: Plus Jakarta Sans 800, terracotta d (#C4714A nestd), gold d (#C9A84C crestd), blue d (#4F6BFF stackd)
- Brand assets: ~/workspace/ + ~/projects/mission-control/data/brand-generation-guide.md
- Coming-soon page: ~/projects/nestd-landing/coming-soon.html

## Travel Plan
- Diego travelling: Thailand (Pattaya first), Philippines, Japan, China
- Server stays home (Brisbane), auto-heals on reboot
- ops Linux user created for Mathis/Emilio (power button only)
- Remote access: Tailscale + NoMachine + Termius
- 1Password CLI connected (vault: Personal, dfpalhano@gmail.com)
- SSH: key-only, no root, no password auth
- fail2ban: running

## Atlas Monitor Bot
- Service: atlas-monitor.service (running)
- Bot: @jessapprovals_bot (shared with Jess)
- Commands: /s (status), /rwa (restart WA), /rj (restart Jess), /ra (restart all)
- Alerts only when degraded or recovered — silent when healthy
- Script: ~/projects/monitor-bot/monitor.js

## 🚨 WA Double-Confirmation Rule (09/03/2026 — violation logged)
- NEVER fire WA messages (group or individual) without TWO explicit confirms
- Step 1: show draft → Step 2: "good to send?" → Step 3: "confirming now — last chance" → Step 4: execute
- Violated 09/03: fired 16-group blast on single approval. Logged as serious breach.
