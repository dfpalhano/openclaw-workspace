# OpenClaw + Desktop Setup Methodology
> Clean reference log — no personal identifiers, keys, or credentials.
> Use this as a repeatable setup guide on any new machine.

---

## 1. Operating Environment

- **OS:** Rocky Linux 10.x (x86_64)
- **Node.js:** v22.x (via nvm or system package)
- **Shell:** bash
- **Package managers:** npm (global), pip3, brew (Linuxbrew)

---

## 2. OpenClaw Installation

```bash
npm install -g openclaw
```

### First-run setup
- Run `openclaw init` to create workspace at `~/.openclaw/workspace/`
- Workspace is a git repo — commit changes regularly
- Connect messaging channel (Telegram or WhatsApp) via `openclaw gateway start`

### Workspace files created
| File | Purpose |
|---|---|
| `SOUL.md` | Agent identity, behaviour rules, operating philosophy |
| `AGENTS.md` | Session startup rules, memory architecture, group chat rules |
| `USER.md` | Owner profile, timezone, preferences |
| `IDENTITY.md` | Agent name, version, vibe |
| `MEMORY.md` | Long-term curated memory (main session only) |
| `TOOLS.md` | Local notes — cameras, SSH, TTS preferences |
| `HEARTBEAT.md` | Periodic check tasks |
| `SKILL_INSTALL_LOG.md` | Audit log of all skill install/reject decisions |

---

## 3. Skills Installed

### Installation policy (mandatory before any skill)
1. Inspect SKILL.md: `npx clawhub@latest inspect <slug> --file SKILL.md`
2. Scan: `python3 skills/claw-skill-guard/scripts/scanner.py scan /tmp/skill-scans/<slug>/`
3. Rules:
   - 🔴 CRITICAL → Do NOT install
   - 🟡 HIGH → Owner approval required
   - 🟠 MEDIUM → Install unless pipe-to-shell found
   - 🟢 LOW / ✅ SAFE → Install freely
4. Log every result to `SKILL_INSTALL_LOG.md`

### Skills installed
```
claw-skill-guard     Security scanner — run before all installs
agent-tinman         Agent framework utilities
local-approvals      Human-in-the-loop approval workflow
plansuite            Planning and project management
super-skills         Skill management utilities
soul-guardian        Identity and behaviour protection
context-recovery     Session context recovery
file-search          File search utilities
ripgrep              Fast text search
skill-detector       Passive workflow pattern detector — auto-drafts skills
```

### Skills rejected
| Skill | Reason |
|---|---|
| `youtube-iu` | CRITICAL — SKILL.md instructs downloading password-protected ZIP + running unknown executable |
| `youtube-transcript` | HIGH — VirusTotal flagged; routes traffic through residential proxy/WireGuard VPN |

### Alternative (no skill needed)
```bash
pip3 install youtube-transcript-api
# Pass YouTube URL to agent — transcript fetched natively, no proxy
```

---

## 4. Python Tools

```bash
pip3 install youtube-transcript-api
pip3 install xlsx2html weasyprint   # XLSX → PDF payslip conversion
```

---

## 5. Local AI — Ollama

### Install
```bash
curl -fsSL https://ollama.ai/install.sh | sh
# OR on Rocky Linux via package manager
```

### Pull models
```bash
# Clear any corrupt blobs first if digest mismatch errors occur:
rm -rf ~/.ollama/models/blobs/*

ollama pull llama3.2:3b    # Heartbeat model (2GB, lightweight)
# Fallback if registry issues:
ollama pull qwen2.5:3b
ollama pull tinyllama
```

### Test
```bash
ollama serve
ollama run llama3.2:3b "respond with OK"
```

### Purpose in stack
- Route OpenClaw heartbeats to local model (zero API cost)
- Free health checks, alert routing, monitoring tasks

---

## 6. Token Optimisation (OpenClaw Config)

Reference: @mattganzak OpenClaw Token Optimization Guide

### Edit `~/.openclaw/openclaw.json`

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-haiku-4-5"
      },
      "cache": {
        "enabled": true,
        "ttl": "5m",
        "priority": "high"
      },
      "models": {
        "anthropic/claude-sonnet-4-5": { "alias": "sonnet", "cache": true },
        "anthropic/claude-haiku-4-5": { "alias": "haiku", "cache": false }
      }
    }
  },
  "heartbeat": {
    "every": "1h",
    "model": "ollama/llama3.2:3b",
    "session": "main",
    "prompt": "Check: Any blockers, opportunities, or progress updates needed?"
  }
}
```

### System prompt rules to add to SOUL.md

**Session initialization:**
```
On every session start, load ONLY: SOUL.md, USER.md, IDENTITY.md, memory/YYYY-MM-DD.md
DO NOT auto-load: MEMORY.md, session history, prior tool outputs
Use memory_search() on demand. Pull only relevant snippets.
```

**Model selection:**
```
Default: Haiku
Switch to Sonnet ONLY for: architecture decisions, production code review,
security analysis, complex debugging, strategic multi-project decisions
```

**Rate limits:**
```
5s minimum between API calls
10s between web searches
Max 5 searches per batch, then 2-minute break
Batch similar work
If 429 error: STOP, wait 5 minutes, retry
Daily budget: $5 (warn at 75%)
Monthly budget: $200 (warn at 75%)
```

### Expected cost impact
| Period | Before | After |
|---|---|---|
| Daily | $2–3 | ~$0.10 |
| Monthly | $70–90 | $3–5 |
| Yearly | $800+ | $40–60 |

---

## 7. Mission Control Dashboard

### Stack
- `index.html` — single-file SPA (vanilla JS, no frameworks, glassmorphism dark theme)
- `server.js` — Node.js local engine, port 8899, no npm deps
- `mission-control.service` — systemd service for auto-start on reboot

### Location
```
~/projects/mission-control/
├── index.html
├── server.js
├── mission-control.service
├── mc-data.json          # Dashboard state (auto-created)
├── mc-activity.json      # Activity log (auto-created)
└── logs/
    └── server.log
```

### Features
| Tab | Contents |
|---|---|
| 📊 Dashboard | Metric cards, activity feed, top priorities |
| 📋 Projects | Kanban (drag-drop, Backlog/In Progress/Done) |
| 📅 Timeline | Phase-based roadmap with milestone checkboxes |
| 💰 Revenue | MRR gauge, bar chart, client list, projections (password gated) |
| 📝 Notes | Text area + snippet library |
| 🏢 Command Center | Agent cards, slide-out panel, task sending, executive decisions |
| 📡 Intel | Category feed, daily brief, importance tags |

### Access
- Dashboard login: set on first load (stored hashed via SHA-256)
- Revenue tab: separate password gate (resets each browser session)

### Server REST API
```
GET  /mc/status     → uptime, node version, connection status
GET  /mc/data       → full dashboard state
POST /mc/data       → overwrite state (auto-backup from dashboard every 5min)
GET  /mc/weather    → Brisbane weather via wttr.in
GET  /mc/activity   → last 50 activity entries
POST /mc/activity   → append activity entry
```

### Auto-start setup (Linux/systemd)
```bash
sudo cp ~/projects/mission-control/mission-control.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable mission-control
sudo systemctl start mission-control
```

### Verify running
```bash
curl http://localhost:8899/mc/status
```

---

## 8. Google Cloud CLI

### Install
```bash
curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
tar -xf google-cloud-cli-linux-x86_64.tar.gz
./google-cloud-sdk/install.sh --quiet --path-update=true

# Add to PATH permanently
echo 'source ~/google-cloud-sdk/path.bash.inc' >> ~/.bashrc
source ~/.bashrc
```

### Authenticate with service account
```bash
# Store key securely (never in Downloads)
mkdir -p ~/.config/gcloud/keys
mv ~/Downloads/<your-key>.json ~/.config/gcloud/keys/

# Activate
gcloud auth activate-service-account --key-file=~/.config/gcloud/keys/<your-key>.json
gcloud config set project <your-project-id>
```

### Enable required APIs
```bash
# Required first — enables API management
# Enable via browser: console.developers.google.com/apis/api/cloudresourcemanager.googleapis.com

# Then via CLI:
gcloud services enable drive.googleapis.com
gcloud services enable calendar-json.googleapis.com
```

### APIs enabled
| API | Purpose |
|---|---|
| `drive.googleapis.com` | Google Drive backup of dashboard + workspace files |
| `calendar-json.googleapis.com` | Calendar integration for scheduling, inspections |
| `cloudresourcemanager.googleapis.com` | Required to manage other API enables |

---

## 9. Cloudflare Tunnel

> Remote access to Mission Control — no port forwarding, no VPN. Uses Cloudflare edge.

```bash
# Install (no sudo needed)
curl -L https://github.com/cloudflare/cloudflared/releases/download/2026.2.0/cloudflared-linux-amd64 -o ~/.local/bin/cloudflared
chmod +x ~/.local/bin/cloudflared

# Authenticate (opens browser — log in with Cloudflare account)
cloudflared tunnel login
# Saves cert to ~/.cloudflared/cert.pem

# Create tunnel
cloudflared tunnel create mission-control
# Saves credentials to ~/.cloudflared/<tunnel-id>.json

# Route subdomain (domain must be on Cloudflare)
cloudflared tunnel route dns mission-control mc.<yourdomain>

# Config file: ~/.cloudflared/config.yml
# tunnel: <tunnel-id>
# credentials-file: ~/.cloudflared/<tunnel-id>.json
# ingress:
#   - hostname: mc.<yourdomain>
#     service: http://localhost:8899
#   - service: http_status:404

# Run
cloudflared tunnel run mission-control

# Auto-start on reboot (systemd)
sudo cp ~/projects/mission-control/cloudflared.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

### Dashboard credentials
- Stored hashed (SHA-256) in `~/.config/mission-control/credentials.json`
- To generate hash for new password:
```bash
python3 -c "import hashlib,getpass; print(hashlib.sha256(getpass.getpass().encode()).hexdigest())"
```

---

## 10. Git Checkpoints

All workspace changes are committed to a private GitHub repo.

### Create a checkpoint before major changes
```bash
cd ~/.openclaw/workspace
git add -A
git commit -m "Checkpoint: description"
git tag -a "checkpoint-name" -m "description"
git push origin checkpoint-name
```

### Restore from checkpoint
```bash
# Full restore
git checkout checkpoint-name

# Single file restore
git checkout checkpoint-name -- SOUL.md
```

### Named checkpoints
| Tag | Description |
|---|---|
| `checkpoint-pre-token-opt` | Stable baseline — Atlas 2.1 configured, 51 skills, before cost optimisation |

---

## 11. Sequence Summary (order of operations)

1. Install Node.js + npm
2. Install OpenClaw (`npm install -g openclaw`)
3. `openclaw init` → configure workspace
4. Install `claw-skill-guard` first (security scanner)
5. Install remaining skills (scan each before install)
6. Install Ollama + pull `llama3.2:3b`
7. Configure `openclaw.json` (model routing + heartbeat)
8. Build Mission Control dashboard (`~/projects/mission-control/`)
9. Install as systemd service
10. Install Google Cloud CLI + authenticate service account
11. Enable required Google APIs
12. Set up Cloudflare tunnel (pending)
13. Configure Google Drive backup via rclone or Drive API (pending)

---

## 12. Tenants Module (Mission Control)

Added to dashboard as **👥 Tenants** tab.

### Features
- Tenant profiles: name, identity/passport, nationality, phone, WhatsApp (number + active status)
- Tenancy details: house code, house group, room, rent/week, bond, start date
- Unique tenant number (auto-incremented: T001, T002…)
- Payment history per tenant: week start, payment date, amount, method (cash/deposit)
- Bank CSV import: each row = one entry, duplicates preserved as separate payments
- Name matching from bank description field (partial name match scoring)
- Manual tenant assignment for unmatched CSV rows
- All data in localStorage key `mc.tenants`

### CSV import rules
- Every credit row in the CSV is treated as a unique, separate entry
- Duplicate rows (same amount, same name, same date) are NOT deduplicated — each counts
- Match confidence shown — low confidence flagged for manual review
- Unmatched rows can be manually assigned before import

---

## 13. Houses, Managers & Maintenance (Mission Control)

### Houses tab (🏠)
- Register properties: code, name, address, bank account, WhatsApp group
- Rooms: number, linked tenant, rent/wk, live payment status (Paid/Waiting/Missing)
- Shows maintenance alerts + next inspection date per house card

### Managers tab (👷) — owner password gated
- Register managers: name, role, phone, email, assigned houses
- Maintenance jobs: priority (High/Med/Low), assignee, due date, completion tracking
- Inspection scheduling: date, time, inspector, notes
- Recurring jobs tracker: predictive scheduling from history, snooze 1 week if unbooked

### Recurring jobs predictive logic
- Tracks history of each job completion date
- Calculates average interval from ≥2 records
- Predicts next date = last done + avg days
- Status: green (on track), amber (due ≤3 days), red (overdue)
- Snooze: defers reminder 7 days, resets when job is marked done
- Check ✓ on job = records today as done, recalculates avg, updates prediction

### Weather
- Switched from wttr.in (blocked) to Open-Meteo API (free, no key needed)
- Brisbane coords hardcoded: lat=-27.4705, lon=153.0260

---

## 14. Model Routing Strategy

### Decision (2026-02-27)
Implemented Option B + C model routing — rules in SOUL.md enforced at sub-agent spawn time.

### Routing table
| Task type | Model |
|---|---|
| Heartbeats, simple lookups, summaries | `ollama/qwen3:8b` (local, 8b) |
| Coding, file edits, production changes | `anthropic/claude-sonnet-4-6` |
| Dedicated coding (coding-agent skill) | `openai/gpt-5.1-codex` |
| Complex reasoning / orchestration | `anthropic/claude-sonnet-4-6` |

### Rules
- Main session default: `ollama/minimax-m2.5:cloud`
- Sub-agents always receive explicit `model=` parameter — never inherit default blindly
- Heartbeat sub-agents: `ollama/qwen3:8b` (local, zero API cost)
- Sonnet triggered for: coding, multi-step plans, any edit to production files
- Codex triggered for: dedicated coding tasks via coding-agent skill

### Failure protocol
1. Capture exact error
2. Report to owner: model used, task, error
3. Propose alternative
4. Wait for confirmation before retrying

### Files updated
- `SOUL.md` — Model Routing Rules section added
- `atlas/03_behaviour_model.md` — Model Routing section added
