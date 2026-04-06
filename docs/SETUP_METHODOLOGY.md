# Remote Access Setup Methodology
*Rocky Linux 10.x — maintained by Smith 🛠️*

---

## Overview

Three pillars of remote access:
| Service | Protocol | Port | Auth |
|---------|----------|------|------|
| OpenSSH (sshd) | SSH | 22 (TCP) | Public key only |
| NoMachine | NX | 4000 (TCP+UDP) | NX credentials |
| Tailscale | WireGuard | 41641 (UDP) + DERP fallback | OAuth device auth |

All three are systemd-managed, enabled for boot (`systemctl enable`), and protected by firewalld.

---

## 0. god-mode Skill

### Repair + Setup
```bash
# Fix missing wrapper and normalize line endings
python3 - <<'PY'
from pathlib import Path
root = Path('/home/diegopalhano/.openclaw/workspace/skills/god-mode')
wrapper = root / 'scripts' / 'god'
if not wrapper.exists():
    wrapper.write_text('''#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cmd="${1:-}"
if [[ $# -gt 0 ]]; then shift; fi
case "$cmd" in
  setup) exec "$SCRIPT_DIR/setup.sh" "$@" ;;
  status) exec "$SCRIPT_DIR/commands/status.sh" "$@" ;;
  sync) exec "$SCRIPT_DIR/commands/sync.sh" "$@" ;;
  projects) exec "$SCRIPT_DIR/commands/projects.sh" "$@" ;;
  agents) exec "$SCRIPT_DIR/commands/agents.sh" "$@" ;;
  ""|-h|--help|help) cat <<'EOF'
Usage: god <command> [args]
Commands: setup | status | sync | projects | agents
EOF
    ;;
  *) echo "Unknown command: $cmd" >&2; exit 1 ;;
esac
''')
for p in root.rglob('*'):
    if p.is_file():
        data = p.read_bytes()
        if b'\r\n' in data:
            p.write_bytes(data.replace(b'\r\n', b'\n'))
PY
chmod +x /home/diegopalhano/.openclaw/workspace/skills/god-mode/scripts/god \
  /home/diegopalhano/.openclaw/workspace/skills/god-mode/scripts/setup.sh \
  /home/diegopalhano/.openclaw/workspace/skills/god-mode/scripts/commands/*.sh

# Add to PATH for bash shells
if ! grep -Fq '/home/diegopalhano/.openclaw/workspace/skills/god-mode/scripts' ~/.bashrc; then
  printf '\n# god-mode\nexport PATH="$PATH:/home/diegopalhano/.openclaw/workspace/skills/god-mode/scripts"\n' >> ~/.bashrc
fi
export PATH="$PATH:/home/diegopalhano/.openclaw/workspace/skills/god-mode/scripts"

# Run first-time setup
god setup
```

### Verification
```bash
which god
ls -la ~/.config/god-mode ~/.god-mode
sed -n '1,120p' ~/.config/god-mode/config.yaml
```

### Notes
- `god setup` successfully created:
  - `~/.config/god-mode/config.yaml`
  - `~/.god-mode/cache.db`
- The installed skill was broken initially:
  - missing `scripts/god` wrapper
  - CRLF line endings in skill files
- `god status` still needs further repair if it fails with `show_overview: command not found`.

## 0.1. Composio Gmail Connection

### Connection via Composio
```bash
# Initiate connection
COMPOSIO_MANAGE_CONNECTIONS toolkits: ["gmail"]

# Wait for user authentication at:
# https://connect.composio.dev/link/lk_CkmNJqB5bPPZ

# Verify connection
COMPOSIO_WAIT_FOR_CONNECTIONS toolkits: ["gmail"] mode: "any"

# Test connection
COMPOSIO_MULTI_EXECUTE_TOOL tools: [{"tool_slug": "GMAIL_GET_PROFILE", "arguments": {"user_id": "me"}}]
```

### Verification Output
```json
{
  "emailAddress": "dfpalhano@gmail.com",
  "historyId": "25374834",
  "messagesTotal": 158231,
  "threadsTotal": 140223
}
```

### Notes
- Connected Gmail account: `dfpalhano@gmail.com`
- Connection established via Composio OAuth flow
- All Gmail tools now available via Composio MCP

## 1. Tailscale

### Installation
```bash
# Install from tailscale repo
dnf install -y tailscale
systemctl enable --now tailscaled
tailscale up --operator=$(whoami)
```

### Auth Persistence
Tailscale stores auth state in `/var/lib/tailscale/tailscaled.state`. Once authenticated, `WantRunning=true` is persisted there — the daemon reconnects automatically on reboot or network changes without re-auth.

Check: `tailscale debug prefs | grep WantRunning` should show `true`.

### DNS Fix (Critical)
Tailscale manages `/etc/resolv.conf` for MagicDNS. If the file gets an immutable flag set by another tool, Tailscale will log a DNS error but remain connected. To fix:

```bash
# Check for immutable flag
lsattr /etc/resolv.conf

# Remove it (as root)
chattr -i /etc/resolv.conf
```

After removal, Tailscale will update the file on its next DNS refresh cycle.

### Systemd Drop-in (Resilience)
Create `/etc/systemd/system/tailscaled.service.d/10-resilience.conf`:
```ini
[Service]
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
```
This upgrades from `on-failure` to `always` so the daemon restarts on any exit including clean stops.

### Verification
```bash
tailscale status          # Shows connected peers and IPs
tailscale netcheck        # DERP relay, UDP connectivity, latency
tailscale ip -4           # This machine's Tailscale IPv4
systemctl status tailscaled
```

---

## 2. NoMachine (nxserver)

### Installation
Download `.rpm` from https://www.nomachine.com/download/linux and install:
```bash
rpm -i nomachine_<version>_x86_64.rpm
systemctl enable nxserver
systemctl start nxserver
```

### Firewall
```bash
firewall-cmd --permanent --add-port=4000/tcp
firewall-cmd --permanent --add-port=4000/udp
firewall-cmd --reload
```

### Service Config
The unit file at `/usr/lib/systemd/system/nxserver.service` has `Restart=always`. Add `RestartSec` via drop-in:

Create `/etc/systemd/system/nxserver.service.d/10-resilience.conf`:
```ini
[Service]
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
```

### Dependency Ordering
The NX unit file includes:
```
After = syslog.target network.target network-online.target sshd.service
Wants = network-online.target
```
This ensures NX only starts after full network is ready — correct for a remote desktop service.

### Verification
```bash
systemctl status nxserver
/usr/sbin/ss -tlnp | grep 4000    # Should show 0.0.0.0:4000 and [::]:4000
/usr/NX/bin/nxserver --status     # Requires root
```

---

## 3. SSH / Termius

### Security Posture (key-only)
Ensure `/etc/ssh/sshd_config` (or drop-ins in `/etc/ssh/sshd_config.d/`) contain:
```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
```

Verify: `sshd -T | grep -E '(passwordauthentication|permitrootlogin|pubkeyauthentication)'`

### Authorized Keys
Store authorized keys in `~/.ssh/authorized_keys`. Avoid duplicates — they're harmless but create confusion:
```bash
# Deduplicate while preserving order
awk '!seen[$0]++' ~/.ssh/authorized_keys > /tmp/ak && mv /tmp/ak ~/.ssh/authorized_keys
```

### Systemd Drop-in (Resilience)
The default Rocky Linux sshd unit has `RestartSec=42s` — too slow for recovery. Override:

Create `/etc/systemd/system/sshd.service.d/10-resilience.conf`:
```ini
[Service]
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
```

### Firewall
```bash
firewall-cmd --list-services     # Should include 'ssh'
# If missing:
firewall-cmd --permanent --add-service=ssh
firewall-cmd --reload
```

### Verification
```bash
systemctl status sshd
/usr/sbin/ss -tlnp | grep :22
journalctl -u sshd -n 20
```

---

## 4. Reboot Resilience Checklist

After any system change, verify:
```bash
# All three enabled for boot
systemctl is-enabled tailscaled sshd nxserver

# All three currently running
systemctl is-active tailscaled sshd nxserver

# Ports listening
/usr/sbin/ss -tlnp | grep -E '(22|4000)'

# Tailscale connected
tailscale status | grep -v offline

# Firewall allows access
firewall-cmd --list-all
```

### Simulate Post-Reboot State
```bash
# Restart all three in dependency order
systemctl restart tailscaled
sleep 5
systemctl restart sshd
systemctl restart nxserver

# Verify
systemctl status tailscaled sshd nxserver
```

---

## 5. Quick Fix Script

If any service needs re-hardening (e.g., after OS update reverts drop-ins):
```bash
sudo bash ~/.openclaw/workspace/docs/fix-remote-access.sh
```

This script:
1. Removes immutable flag from `/etc/resolv.conf` (fixes Tailscale DNS)
2. Creates systemd drop-ins for resilience
3. Reloads systemd
4. Verifies all services are active

---

## Known Issues & Notes

| Issue | Cause | Fix |
|-------|-------|-----|
| Tailscale DNS health warning | `/etc/resolv.conf` immutable flag | `chattr -i /etc/resolv.conf` as root |
| `tailscale` reports OFF in openclaw status | Possible stale status check at boot | Run `tailscale status` to verify actual state |
| `ss` command not in default PATH | Use `/usr/sbin/ss` explicitly | Or `export PATH=$PATH:/usr/sbin` |

---

*Last updated: 2026-03-26 by Atlas*

---

## 6. Inspection Calendar Standard

Use this format for all inspection calendar entries created manually or via automation.

### Title format
```text
[INSP] <HOUSE> <TYPE>
```

Examples:
```text
[INSP] V5 Routine
[INSP] CO1 Pool
[INSP] SH2 Entry
```

Rules:
```bash
# Keep title short and aligned with MC existing entries
# Do not add dashes
# Do not add the word "Inspection" to the title
# Use house code + short type only
```

### Routine inspection time buffer
For routine inspections, use the Mission Control buffered notice window instead of the raw agent time.

Formula:
```bash
# actual start/end known
calendar_start="actual_start - 1 hour"
calendar_end="actual_end + 30 minutes"
```

Example:
```bash
# actual inspection time
09:00-11:00

# calendar event time
08:00-11:30
```

### Purpose
```bash
# Aligns calendar entries with the WA notice window
# Keeps Atlas and Mission Control consistent
# Matches existing short-form inspection naming in MC
```

---

## 3. WA Ops Bot — WhatsApp Conversation Worker

**Date:** 2026-03-09
**Purpose:** Dedicated stateful conversation worker for WhatsApp operational flows.

### Architecture

```
whatsapp-bridge (:8890)   →  pushes all inbound messages to :8891
wa-ops-bot (:8891 webhook, :8892 mgmt API)
  ├── flows/replacement_screening.js   ← full implementation
  ├── flows/registration_recovery.js   ← stub (escalates)
  ├── flows/temporary_resident_onboarding.js ← stub
  ├── flows/issue_resolution.js        ← stub
  ├── lib/state.js     — JSON state store (data/wa-threads.json)
  ├── lib/send.js      — routes sends through bridge /send
  ├── lib/escalate.js  — Telegram alerts + escalation detection
  └── lib/mc.js        — writes notes/tasks to MC
mission-control (:8899)   →  proxies /mc/wa-threads/* to :8892
```

### Project location

```
/home/diegopalhano/projects/wa-ops-bot/
```

### Systemd service install (requires sudo)

```bash
# Copy service file
sudo cp /home/diegopalhano/projects/wa-ops-bot/wa-ops-bot.service /etc/systemd/system/wa-ops-bot.service

# Reload + enable + start
sudo systemctl daemon-reload
sudo systemctl enable wa-ops-bot
sudo systemctl start wa-ops-bot

# Verify
sudo systemctl status wa-ops-bot
journalctl -u wa-ops-bot -f
```

### Environment

```
/home/diegopalhano/projects/wa-ops-bot/.env
  TELEGRAM_BOT_TOKEN=<atlas bot token>
```

Service reads this via `EnvironmentFile` directive.

### Ports

| Port | Binding | Purpose |
|------|---------|---------|
| 8891 | 127.0.0.1 | Inbound webhook (bridge pushes here) |
| 8892 | 0.0.0.0 | Management API (owner control) |

### MC integration

MC server proxies `/mc/wa-threads/*` → `localhost:8892/wa-threads/*`.
No MC restart needed — proxy reads from wa-ops-bot at request time.

### Key safety rules

- `approvedAutoFlow` defaults to `false` (watch-only until owner enables)
- All sends route through bridge `/send` (existing LID resolution applies)
- Existing bridge approval rules untouched
- Escalation patterns trigger on every message regardless of flow stage
- `escalateAll` per-house flag prevents any auto-flow for flagged houses

### Thread control API (via MC)

```bash
# List threads
curl http://localhost:8899/mc/wa-threads

# Create thread
curl -X POST http://localhost:8899/mc/wa-threads \
  -H 'Content-Type: application/json' \
  -d '{"phone":"61412345678","name":"John","threadType":"replacement_screening","houseCode":"SB1"}'

# Enable auto-flow
curl -X POST http://localhost:8899/mc/wa-threads/61412345678/command \
  -H 'Content-Type: application/json' \
  -d '{"command":"enable-auto-flow"}'

# Watch-only
curl -X POST http://localhost:8899/mc/wa-threads/61412345678/command \
  -d '{"command":"watch-only"}'

# Stop automation
curl -X POST http://localhost:8899/mc/wa-threads/61412345678/command \
  -d '{"command":"stop-automation"}'

# Escalate all for a house
curl -X POST http://localhost:8899/mc/wa-threads/ANY/command \
  -d '{"command":"escalate-all-for-house","houseCode":"SB1"}'
```

---

## WhatsApp Bridge — New Endpoints (2026-03-10)

All new endpoints accept connections from **127.0.0.1 only** (403 otherwise).

### Inbox Scanner
```bash
# Recent chats enriched with tenant data (tenantName, houseCode, isKnownOccupant)
curl http://127.0.0.1:8890/chats?limit=200

# Messages for a specific chat
curl "http://127.0.0.1:8890/chats/61412345678@c.us/messages?limit=50"

# Inbox keyword analysis (notice/leaving, substitution, inquiry)
curl -X POST http://127.0.0.1:8890/chats/analyse
```

### Contact / Group Resolution
```bash
# Resolve a phone to WA identity (JID, displayName, groups)
curl http://127.0.0.1:8890/contacts/resolve/61412345678

# All groups with members (JID + phone per participant)
curl http://127.0.0.1:8890/groups
```

### Group Membership (Scheduler Executors — never call directly)
```bash
# Called by Vox group-schedule on/after scheduledDate only
curl -X POST http://127.0.0.1:8890/groups/120363..@g.us/add    -d '{"phone":"+61412345678"}'
curl -X POST http://127.0.0.1:8890/groups/120363..@g.us/remove -d '{"phone":"+61412345678"}'
```

---

## Vox — Date-Gated Group Schedule (2026-03-10)

Group membership changes are **never immediate**. Scheduled via `lib/bridge.js → scheduleGroupChange()`.

Persistence: `/home/diegopalhano/projects/wa-ops-bot/data/group-schedule.json`

Scheduler fires:
- **On startup** — immediately if `lastRunDate != today` (idempotent)
- **Daily at 08:00 Brisbane** — processes any due items

### Management API (port 8892)
```bash
# List all scheduled changes
curl http://127.0.0.1:8892/group-schedule
curl "http://127.0.0.1:8892/group-schedule?status=pending"

# Schedule a new change
curl -X POST http://127.0.0.1:8892/group-schedule \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+61412345678","groupJid":"120363..@g.us","action":"add","scheduledDate":"2026-03-15","reason":"new occupant BRIS1"}'

# Cancel a pending item
curl -X DELETE http://127.0.0.1:8892/group-schedule/gs_1234_abcdef

# Reschedule (for remove: warns + requires confirmed=true if moving earlier)
curl -X POST http://127.0.0.1:8892/group-schedule/gs_1234_abcdef/override \
  -d '{"date":"2026-03-20"}'
# Force early removal (owner must explicitly confirm):
curl -X POST http://127.0.0.1:8892/group-schedule/gs_1234_abcdef/override \
  -d '{"date":"2026-03-10","confirmed":true}'

# Force run all due items now
curl -X POST http://127.0.0.1:8892/group-schedule/run-now
```

### Vox lib/bridge.js — Available Functions
```javascript
const bridge = require('./lib/bridge');

bridge.resolveContact(phone)           // GET /contacts/resolve/:phone
bridge.getGroups(query?)               // GET /groups
bridge.fetchChats(limit?)              // GET /chats?limit=
bridge.fetchMessages(jid, limit?)      // GET /chats/:jid/messages
bridge.scheduleGroupChange(            // writes to schedule, never immediate
  phone, groupJid, action, scheduledDate, reason?)
```

---

## 7. Mission Control — Welcome Package Timing Fix

**Date:** 2026-03-30  
**Purpose:** Prevent welcome messages/documents from being sent before payment is confirmed.

### Locked behaviour
```bash
# docs accepted
send = holding-message-only

# payment confirmed
send = full welcome package
```

### Required sequence
```bash
# step 1
registration form submitted

# step 2
if docs accepted:
  send short acknowledgement only
  # thank them for submitting
  # confirm docs accepted
  # say payment confirmation is pending
  # do NOT send welcome/docs here

# step 3
if payment confirmed:
  send welcome message
  send house rules PDF
  send occupancy licence PDF
  send occupancy letter (if applicable)
```

### Code fix applied
```bash
# mission-control/server.js
# - accept-docs path changed to holding message only
# - confirm-payment path is the real welcome-package trigger

# mission-control/scripts/daily-move-flow.js
# - explicit guard added: skip if !paymentConfirmed
```

### Verification rule
```bash
# never treat docsAccepted as permission to send the welcome pack
# only paymentConfirmed can trigger welcome/docs
# keep duplicate protection (welcomeSent + WA chat history check)
```
