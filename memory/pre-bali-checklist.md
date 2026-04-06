---
hyperspell_id: sYStDMFEFroHkg
---
# Pre-Bali Checklist — Depart 20 March 2026
# Update this file as items are completed

## 🔴 URGENT — Do this week

### Property
- [x] **Sign 606 Vulture lease renewal** — SIGNED — Tim Altass resending DocuSign, check email and sign
- [ ] **Resolve 41 Park (SH3) invoice arrears** — Place Graceville, you replied but it's unresolved. Call or email placegraceville@email.propertyme.com
- [x] **Arrange SH2 (36 Rosa) owner visit** — DONE — she's pushing to come and have a look, do it before 20 Mar. Self-managed, contact owner directly.

### Emails to send (awaiting your approval to send)
- [ ] SH1 (40 Rosa) → Coronis (operations@little.com.au) — confirm next inspection date
- [ ] SH3 (41 Park) → Place Graceville — confirm next inspection + resolve arrears
- [ ] V5 (147 Warry) → Leo Tsimpikas — confirm next inspection
- [ ] WL3 (28 Taylor) → Q Realty — confirm next inspection
- [ ] GS1 (3 Hardgrave) → JJ Property — confirm next inspection
- [ ] SP9 (50 Peninsular) → Ray White Southport (rwsp@email.propertyme.com) — confirm next inspection
- [ ] EB3 (69 Gresham) → OPC/Willian (opc@email.propertyme.com) — confirm next inspection
- [ ] BRIS1 (79 Albert) → Ray White IBA / Kim Toma (admin2.iba@raywhite.com) — confirm next inspection

## 🟡 BOOK ONCE INSPECTIONS CONFIRMED

### Flights
- [ ] BNE → Bali (depart 20 Mar 2026)
- [ ] Build return windows around inspection dates (Atlas will map them once agents reply)
- [ ] Bali → Thailand (depart ~6 Apr or after any inspection return)
- [ ] Thailand → Philippines (TBD)
- [ ] Philippines → BNE (TBD — 2 months total)

## 🟢 BEFORE YOU LEAVE

### Health
- [ ] Full STI panel pre-trip
- [ ] Confirm PrEP supply for 2 months
- [ ] Get doxycycline script ready for post-return treatment
- [ ] Travel doctor consult if needed (MSHC Brisbane city)

### Finance & Business
- [ ] Check all direct debits are set up and will auto-pay while away
- [ ] Confirm bank cards work internationally (Wise etc.)
- [ ] Brief Mathis + Emilio — contact protocol while you're away
- [ ] Confirm Atlas has everything needed to monitor remotely

### Tech
- [ ] Ensure server auto-heals on reboot (already set up ✅)
- [x] Tailscale + NoMachine + Termius working for remote access ✅ (confirmed 7 Mar)
- [ ] Telegram notifications active for urgent alerts ✅

## 🖥️ SERVER & TECH — Stress Test Before Leaving

### Services resilience
- [ ] All key services confirmed on systemd with auto-restart (wa-ops-bot, jess-v3, jess-relay, mission-control, whatsapp-bridge, monitor-bot)
- [ ] Simulate full server reboot — verify everything comes back clean automatically
- [ ] Tailscale reconnects automatically after reboot ✅ (confirm)
- [ ] NoMachine auto-starts after reboot (confirm)
- [ ] Test SSH key auth from laptop via Termius → server

### Monitoring gaps to close
- [ ] Add uptime check for MC dashboard (port 8899) to monitor bot alerts
- [ ] Add WA bridge (port 8890) health check — alert if down
- [ ] Confirm Telegram alerts fire correctly for all degraded services

### Data safety
- [ ] Set up daily git auto-commit for data files (wa-threads, registrations, jess-pending)
- [ ] Confirm bond return receipts backed up
- [ ] Payments.ods → re-import script ready to run any time: `cd ~/.openclaw/workspace && python3 scripts/import-payments.py`

### Ops before leaving
- [ ] Resolve GS1 missing payments ($31,650 / 83 entries) — biggest outstanding
- [ ] Resolve SB1 missing payments ($24,260 / 69 entries)
- [ ] Re-enable Jess quiet hours (currently hardcoded false)
- [ ] Arnold SH1 group removal — due 2026-03-11
- [ ] Brief Mathis + Emilio — "ops" Linux user, power button only, escalate to Atlas via Telegram
- [ ] Strip OPENAI_API_KEY from environment (Forge confirmed working)
- [ ] Create Forge TG bot token via @BotFather

### Remote working setup (from overseas)
- [ ] Antigravity on laptop configured with Global Rule (~/.gemini/GEMINI.md)
- [ ] Test Tailscale tunnel + SFTP mount from laptop → server
- [ ] Confirm can open/edit server projects from Antigravity on laptop remotely

## 📋 ATLAS WILL MONITOR WHILE YOU'RE AWAY
- Daily email labelling (4am cron) ✅
- Inspection alert script (7am + 12pm cron) ✅
- Weekly payments refresh + alert if anyone misses
- Flag any inspection notices from agents
- Flag any bill due dates
- Alert immediately for anything urgent from agents
- Monitor bot: /s, /rwa, /rj, /ra commands available to Mathis/Emilio
