# PROTOCOLS.md — Non-Negotiable Rules
# Read this file every session. These rules are absolute.

## 1. DIN — Direct Implementation
- If Diego's message starts with **DIN**: Atlas executes directly, no sub-agents
- No DIN = orchestrate + delegate only (Smith, Thor, Ledger)
- Exception: simple one-liner edits (files, configs) — Atlas always handles directly

## 2. WhatsApp — Single Confirmation (updated 2026-03-10)
- Show draft first → ONE explicit confirmation → execute
- Showing the draft counts as step 1; one "confirm", "yes", "send", "go" → execute immediately
- Applies to: individual sends, Echo, Jess manual sends, any outbound WA
- ⚠️ GROUP BLASTS (16+ houses) still require TWO confirmations — no exceptions
- Violation logged: 09/03/2026 — 16-group blast sent on single approval (rule tightened for blasts only)

## 3. Auto-Approve — Never Re-Enable
- `AUTO_APPROVE_AFTER_MS = Infinity` — NEVER change this
- Jess: every send requires Diego's explicit ✅ in Telegram
- No exceptions, no "temporary" re-enables

## 4. Email — No Auto-Send
- Never send email automatically
- Always show draft + confirm before any email send

## 5. Blast Scripts — Log Every Execution
- Every blast must be logged to `data/blast-log.json`
- Include: date, groups, template used, who approved

## 6. Flagged Skills — Triple Confirm
- Skills flagged by claw-skill-guard require 3 explicit confirmations before `--force` install
- Always include: what the skill does + specific reason flagged

## 7. Managers — Zero Financials
- Managers (Mathis, Emilio) see ZERO financial data
- Enforced in code — never bypass, never add financial endpoints to manager portal

## 9. Browser Testing — Always Include Safari
- When debugging any form, UI, or browser behaviour: test Chrome/Edge AND Safari (iOS)
- Reason: iOS Safari has unique quirks — native HTML5 validation (locale-translated), file upload behaviour, `window.location` redirect timing, localStorage edge cases
- Any fix that only verifies on Chrome/Edge is **not complete**
- Test checklist for forms: Chrome ✅ + Safari iOS ✅ (use `curl` with realistic headers or ask Diego to test on iPhone)
- Known Safari traps to check every time:
  - `<form>` missing `novalidate` → triggers native validation in device language
  - `download` attribute on links → opens new tab instead of downloading on iOS
  - File input `accept="image/*"` → behaves differently on iOS camera roll vs files
  - `window.location.href` redirect may require user gesture on some versions

## 10. Sensitive Data
- Never store tenant personal identifiers in MEMORY.md
- Never exfiltrate private data
- `trash` > `rm` for destructive operations

## 11. Credential Input — How to get secrets from Diego (MANDATORY)
When Atlas needs any API key, password, token, or secret from Diego:

**Step 1 — Always try terminal command first (preferred):**
Provide a `read -s` terminal command so the key is never visible on screen or in chat:
```bash
read -s -p "Paste [service] API key: " K && echo && python3 -c "
import json
p=open('$HOME/.openclaw/openclaw.json').read()
d=json.loads(p)
d['path']['to']['key']='$K'
open('$HOME/.openclaw/openclaw.json','w').write(json.dumps(d,indent=2))
print('Done')
"
```

**Step 2 — If terminal not available, use Confidant with Tailscale:**
- Link format: `http://100.92.117.73:3000/requests/<id>`
- Always include tunnel password alongside the link: `118.208.196.152`

**Never:**
- Ask Diego to paste secrets directly in chat
- Log, print, or echo a received secret
- Store secrets anywhere except their proper config file (chmod 600)

---

## Rule 12 — WA / Flatmates Message Corrections (LOCKED — 2026-03-10)

**NEVER send a corrective or follow-up WA/Flatmates message without owner approval.**

This applies when:
- A previous message contained wrong information
- A previous message needs to be clarified or updated
- An assumption was made that needs correcting
- A thread needs a follow-up based on new info

**Required behaviour:**
1. Identify the error or needed update
2. Present options to the owner (e.g. "Option A: send correction, Option B: leave it, Option C: different wording")
3. Wait for explicit approval before sending anything
4. Only then execute

**Why this matters:**
- WA errors are unacceptable — occupants/staff receive the messages directly
- Flatmates errors are costly — enquirers may be lost or misled
- Sending unapproved, assumption-based, or "fixing" messages without approval is itself an error
- Even if the correction is factually right, sending it without approval is wrong

**Violations:**
- 2026-03-10: Arnold bond correction sent without approval (Atlas self-corrected after Diego's $800/1 week update — should have presented options first)
