# memory/active-tasks.md — Current Task Board
# Load every session. Keep updated.

## 🔴 Urgent / This Week
- [ ] WA bridge — get pairing code, reconnect (protocolTimeout 600s, Playwright Chrome)
- [ ] Work through ~15 remaining Jess approvals in MC
- [ ] Set inspection dates on vacancy cards (triggers invites)
- [ ] Verify WA group IDs for all 15 houses (before any scripted sends)
- [ ] Andrea Faso bond (SH1) — due this week (left 1 Mar)
- [ ] Schedule group removals: Rina(CO1 5 Mar), Gaston+Judy(EB3 7-8 Mar), Arnold(SH1 8 Mar), Max(SH3 9 Mar)

## 🟡 This Month
- [ ] Room prices for SH2, SB1, WE1, GS1, WL3, WL4, EB1, V5, BRIS1 (still placeholder)
- [ ] Egon + Benjamin bond (EB2) — chase bank details ($430 combined)
- [ ] Chloé + Hugo Pain bond (V5) — reminder 9 March
- [ ] Add WA IDs to bond-tracker.json for departing tenants
- [ ] Fix /mc/tenant/payments (server.js line 1439 — returns 404)
- [ ] Post Flatmates ads: CO1 R4, EB3 R1, EB3 R3, SH1 R1, SH3 R5, EB2 R1, EB2 R7
- [ ] Deploy nestd.life landing page to Vercel, point domain
- [ ] Register nestd.life on GoDaddy (~$15/yr)
- [ ] Register NESTD trademark via IP Australia (~$250)
- [ ] Emilio visa expiry — ask when current visa expires
- [ ] WL4 bank statement — extract from image files 41–44
- [ ] Jordan + Kane SP9 rate — confirm weekly rent

## 🟢 Backlog
- [ ] Build Echo bot (WA auto-draft, `...` activation, Telegram approval)
- [ ] Build bank statement import Option 5 (P&L, reconciliation, tax, cash flow)
- [ ] Manager subdomain: managers.inspectionsxraytesting.com.au
- [ ] WA bridge permanent fix: bake session-clear + auto-pair into systemd ExecStartPre
- [ ] Parse remaining WA exports: GS1, WE1 Downstairs, WE1 Upstairs, WL3 x3, SP9
- [ ] Salt Edge bank feed integration (blocked — awaiting approval)
- [ ] Resident check-in form: checkin.myhousemates.com.au
- [ ] Staff coverage plan for Diego Japan trip (~July 2026)
- [ ] Emilio student visa pathway research

## ✅ Done Today (6 Mar — session 2)
- Jess auto-sync live listings on session start (syncLiveListings) — CO1/EB2/SP9/BRIS1 live
- Tasks tab: assignee dropdown (Mathis/Emilio/Both), status cycling (todo→in progress→done)
- Tasks tab: 📩 Ask if done? button → WA check-in → "done/yes" reply auto-archives
- Tasks tab: 📋 Manager contact link per house (popover + mailto)
- 💸 Expenses tab built — seeded with Alinta EB3, house assignment, manual add
- 📚 Learning Hub in Managers section — 5 modules seeded
- Decisions tab rendering fixed (was reading localStorage instead of API)
- data/agent-contacts.json created (8 managed properties)
- sync-listings.js standalone script for Jess

## ✅ Recently Done (3 Mar)
- Jess v2 built and sending messages (9 sent today)
- Vacancy funnel cards (Interested/To Invite/Invited/Confirmed)
- Race condition fix in savePending()
- Anti-spam guard on Jess retries
- managers.json as single source of truth
- nestd.life landing page built (357432f)
- Keyd keyboard debounce fix
- WA bridge: currentPairingCode module scope fix, protocolTimeout 600s
