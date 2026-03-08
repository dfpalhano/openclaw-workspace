# memory/active-tasks.md — Current Task Board
# Load EVERY session. Update as tasks complete or spawn.
# Last updated: 2026-03-08 21:31 AEST

---

## 🔴 In Flight (agents working now)
- [ ] **Smith** — Fix nginx duplicate `listen [::]:80` in housemates.conf (spawned 21:27)
- [ ] **Codex** — Fix MC `/r/:key` registration form hang (spawned ~20:57) — may be stale
- [ ] **Codex** — Fix Jess cool-off blocking all approvals (spawned ~21:02) — may be stale

## 🔴 Urgent / Blocked
- [ ] `mc.housemates.online` — nginx IPv6 fix in progress (Smith)
- [ ] `forms.housemates.online/r/61416775321` — blocked by same nginx issue + MC form hang
- [ ] Jess cool-off — still blocking approval queue (0 queued, 116 Gemini drafts generated)
- [ ] MC `/r/:key` form — hangs after headers sent (template bug)
- [ ] Restart atlas-monitor with new token: `sudo systemctl restart atlas-monitor.service`
- [ ] Reload Jess extension in Brave after Load More fix: `brave://extensions`

## 🟡 This Week
- [ ] Test end-to-end Jess reply send (approve one in @jessapprovals_bot)
- [ ] Verify relay conversation count jumps from 20 → all after extension reload
- [ ] 606 Vulture lease renewal — DocuSign pending, sign before 20 Mar
- [ ] SH2 (36 Rosa) — arrange owner visit before 20 Mar
- [ ] Andrea Faso bond (SH1) — due (left 1 Mar)
- [ ] Chloé + Hugo Pain bond (V5) — bank details pending
- [ ] Egon + Benjamin bond (EB2) — chase bank details ($430 combined)
- [ ] Room prices for SH2, SB1, WE1, GS1, WL3, WL4, EB1, V5, BRIS1

## 🟡 This Month (pre-departure 20 Mar)
- [ ] Post Flatmates ads: CO1 R4, EB3 R1, EB3 R3, SH1 R1, SH3 R5, EB2 R1, EB2 R7
- [ ] Verify WA group IDs for all 15 houses
- [ ] Schedule group removals: Arnold(SH1 8 Mar done?), Max(SH3 9 Mar), Asia(EB2 15 Mar)
- [ ] Jordan + Kane SP9 — confirm weekly rent
- [ ] Emilio visa expiry — ask when current visa expires
- [ ] WL4 bank statement — extract from image files 41–44

## 🟢 Backlog
- [ ] Build Echo bot (WA auto-draft, `...` activation, Telegram approval)
- [ ] Build bank statement import Option 5 (P&L, reconciliation, tax, cash flow)
- [ ] Manager subdomain: managers.inspectionsxraytesting.com.au
- [ ] Deploy nestd.life landing page to Vercel
- [ ] Register nestd.life on GoDaddy (~$15/yr)
- [ ] Register NESTD trademark via IP Australia (~$250)
- [ ] Define Smith/Thor agent routing logic properly (partial — PROTOCOLS.md written)

---

## ✅ Completed Today (2026-03-08)
- [x] Jess v3 built and live (no Playwright, Chrome extension + relay)
- [x] Gemini 2.5 Flash set as primary LLM for Jess
- [x] Monitor bot moved to @updatemonibot (new token in monitor.js)
- [x] Watchdog fixed — no longer kills Brave/Chrome
- [x] Extension Load More implemented (scrapes all conversations)
- [x] Property memory restructured → memory/properties/ (one file per property)
- [x] PROTOCOLS.md created (DIN, team roster, agent routing, hard rules)
- [x] AGENTS.md updated to load PROTOCOLS.md every session
- [x] nginx housemates.conf — IPv6 listeners added (Smith, pending confirmation)
