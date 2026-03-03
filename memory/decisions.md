# memory/decisions.md — Architecture & Key Decisions
# Load when: "why did we...", architecture questions, rebuilding components

## Jess Bot Architecture
- Jess = Flatmates.com.au ONLY (enquiries → profile → viewing_pending → invited → confirmed)
- Echo = WhatsApp ONLY (read/draft/approve flow, `...` activation per chat)
- AUTO_APPROVE_AFTER_MS = Infinity — PERMANENTLY DISABLED. Never re-enable. No exceptions.
- Jess approvals: MC list view only; Telegram sends single summary ping
- No inspection slot → ask_profile only (NEVER invite without confirmed date/time)
- savePending() protects approved/skipped/sent — Jess never overwrites these statuses
- queueForApproval() skips if conversationId already has any status (pending/approved/sent/skipped)
- managers.json = single source of truth for staff/assistants

## WhatsApp Bridge
- Library: whatsapp-web.js (npm)
- Browser: Playwright Chromium at ~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome
- Port: 8890 (IPv4 only: 127.0.0.1)
- Session: ~/.whatsapp-session; backup: ~/.whatsapp-session-backup
- Patches required on Client.js (in node_modules, NOT committed):
  1. retry loop (8 attempts, 10s apart) around requestPairingCode call
  2. page.on('console', ...) listener after this.pupPage = page
  3. currentPairingCode at MODULE SCOPE (not inside initClient)
- EADDRINUSE fix: `lsof -ti:8890 | xargs kill -9`
- CompanionHelloError = code expired, enter immediately when it appears
- protocolTimeout: 600000 (10 min)
- DO NOT use: --no-zygote, --single-process, Flatpak Chromium (sandbox issues)

## Model Routing
- Main session: google/gemini-3.1-pro-preview
- Coding/production sub-agents: anthropic/claude-sonnet-4-6 or openai/gpt-5.1-codex
- Mid-tier tasks: google/gemini-3-flash-preview
- Heartbeats (simple): ollama/qwen3:8b | (processing): google/gemini-flash-lite-latest
- Chinese models (GLM-5/DeepSeek): OK for internal tasks; NOT for tenant data
- Failure protocol: stop → report model/task/error → wait for confirmation before retry

## Mission Control
- Single-file HTML, no external JS frameworks, vanilla JS only
- Dark glassmorphism theme; accent #7C3AED
- Port 8899 (localhost), remote: mc.inspectionsxraytesting.com.au
- DO NOT reveal dashboard URL to tenants
- Server: server.js (Node.js); service: mission-control.service
- Finance tab password: see finances.md

## Data Rules
- Excel Payments.xlsx = source of truth for payment history
- Bank filename = house code (e.g. CO1.csv)
- CSV: no deduplication, double payments same day = valid
- bond-tracker.json keys: onNotice, pending, resolved, updatedAt (NOT recentlyLeft)

## Keyboard
- Logitech G915X LIGHTSPEED — known hardware chattering defect
- Fix: keyd v2.6.0 (built from source), debounce_timeout = 40ms
- Config: /etc/keyd/default.conf
- Solaar does NOT support LIGHTSPEED — uninstall when convenient

## Backup Strategy
- Google Drive: 3am Brisbane daily (0 17 * * * UTC), folder: Atlas Mission Control/Daily Logs
- Service account key: /home/diegopalhano/.config/gcloud/keys/openclaw2-488610-957214e91a4a.json
- Local git: all repos committed, no remote except atlas-mission-control (private GitHub)
- Session backup: ~/.whatsapp-session-backup (auto on each WA auth)

## Security Hard Rules
- NEVER send WhatsApp without explicit 2x confirmation
- NEVER send emails without explicit owner command
- Jess AUTO_APPROVE = Infinity, forever
- Echo: every message requires Telegram approval
- Managers see zero financials

## Origin Context
- Atlas 1 + 2: lost twice due to migration mistakes and driver failures
- Atlas 3 = current (Rocky Linux 10); every backup/commit is earned through real pain
- Owner has invested 70+ hours across multiple total rebuilds
- Goal: "I think and you know what to do"
