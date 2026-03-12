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

## 13. Sub-Agent Completion/Failure — Always Notify (LOCKED 2026-03-10)
- **EVERY sub-agent job** (Smith, Thor, Ledger, any coding agent) must be reported to Diego when it finishes OR fails — no exceptions, no silent exits
- If an agent exits in under 30 seconds without output → immediate alert: "⚠️ [Agent] exited immediately without completing. Re-dispatching now."
- If an agent completes → immediate message: "✅ [Agent] done: [what was built/changed]"
- If an agent errors → immediate message: "❌ [Agent] failed: [error]. Options: [A/B/C]"
- This applies 24/7 — even during heartbeats, even at night if a job was running
- Never assume Diego saw the system event — always send an explicit Telegram message

## 14. Draft First — WA Messages (LOCKED 2026-03-10 17:47 AEST)
- **EVERY WhatsApp message** must be shown as a draft to Diego before sending
- No exceptions: individual, group, short, long, urgent, routine — all require approval
- Flow: Draft → Diego approves → Execute
- Violation logged: Swan EB1 message sent without draft approval (2026-03-10 17:45 AEST)
- This applies to Atlas AND Vox — no unsolicited sends ever

## 15. Thread Lifecycle — Close When Done (LOCKED 2026-03-10)
- Close threads immediately when their purpose is resolved
- `status: "closed"`, `watchOnly: true`, `approvedAutoFlow: false`
- No lingering open threads "just in case"
- Stale threads = noise. Closed threads = clarity.
- Review watch list regularly — anything resolved gets closed same session

## 16. Active Tenant Rule — watchOnly Only (LOCKED 2026-03-10)
- Contacts found in `active-tenants.json` = currently living in a property
- When they message in: watchOnly + ping Diego — NEVER auto-flow
- Do NOT create registration_recovery threads for active tenants
- They may be asking anything — a question, a complaint, a request — Diego handles
- Violation: Lilian GS1 auto-threaded into registration_recovery, spammed about forms (2026-03-10)

## Protocol 17 — Verify Before Sending (House Code / Contact Mismatch)
**Locked: 2026-03-10**

If a message instruction contains a house code, name, or phone number that doesn't clearly match — flag the discrepancy and ask for confirmation before sending.

Examples:
- "Send to Thomas from SH2" but records show Thomas at EB2 → ask: "Just confirming — Thomas at SH2 or EB2?"
- Phone number given but house code doesn't match the contact in records → flag it

**When context makes it unambiguous** (e.g. name+phone clearly identifies one person), proceed. But if there's genuine doubt, ask once. One question beats one wrong send.


## Memory architecture note
- Structured memory lives under `memory/core/`, `memory/daily/`, `memory/people/`, `memory/projects/`, `memory/finance/`, and `memory/properties/`.

## Protocol 18 — Search Memory Before Acting
**Locked: 2026-03-11**

Before acting on ANY request — always search memory first.
- Run `memory_search` for relevant context before executing
- Check `memory/core/active-tasks.md` for current task state
- Check `memory/YYYY-MM-DD.md` for recent decisions
- Check `MEMORY.md` for long-term context

Purpose: avoid repeating work, avoid contradicting prior decisions, avoid sending duplicate messages.
This is mandatory. No exceptions.

## Protocol 19 — Same Name ≠ Same Person (LOCKED 2026-03-11)
If a name matches an existing contact in records but the house code or context is different — they are a DIFFERENT person. NEVER update or overwrite the existing record.
- Ask Diego to confirm if genuinely unsure
- Create a new record under the new house
- Violation example: "Baptiste EB3" ≠ "Baptiste SB1" — two different people

---

## Rule 21 — Occupancy Substitution Exception (LOCKED 2026-03-12)
When an occupant finds their own back-to-back replacement (new person moves in as they move out), Diego makes an exception to the formal notice requirement. No notice period enforced.

**Process:**
1. Confirm the replacement is real (has messaged, interested, ready to sign)
2. Send replacement the registration form + additional considerations
3. Once replacement is registered AND paid → send outgoing occupant the exit template
4. Exit template: `vacate_checklist` in `/home/diegopalhano/projects/mission-control/data/house-templates.json`
5. No bond return until exit checklist is met

**Rule:** Back-to-back only. Gap between contracts = no exception. Overlapping = no exception. Exact handover = exception applies.

---

## Rule 22 — WhatsApp Contact Naming Convention (LOCKED 2026-03-12)
All occupant/lead contacts must be named in this format:

**`Firstname Lastname MM.YYYY HouseCode RoomCode`**

Examples:
- `Nathan Laws 03.2026 WL4 R2`
- `Maxime 03.2026 EB2 R4`
- `Colin 03.2026 EB2 R1`

Rules:
- Surname only if known/available
- Month.Year = move-in month (or current month for new leads)
- House code = 2-4 char code (WL4, EB2, SH1, etc.)
- Room code = R1, R2, R3... (if known)
- Apply to every new thread created — update on confirmed room assignment
- Staff/family contacts keep their existing naming (this rule applies to occupants/leads only)

---

## Rule 23 — Group Member Changes: Timing (LOCKED 2026-03-12)
When managing WhatsApp group membership during tenant transitions:

1. **Remove leavers AFTER they have physically left the room** — not before, not same day unless confirmed out
2. **Add new arrivals AFTER leavers are removed** — never overlap
3. **Send welcome message AFTER new arrivals are added**

Sequence: Confirm out → Remove → Confirm in → Add → Welcome

Violation noted: EB2 group 12/03 — new arrivals added before James & Ioanna left. Fine this time, but must not repeat.

**Pending: Remove James Murray + Ioanna from EB2 group — Saturday 14/03 ~11am**

---

## Rule 24 — New Tenant Contact Saving Procedure (LOCKED 2026-03-12)
When a new tenant is confirmed (paid + form submitted):

1. **Save to Diego's phone contacts** using Rule 22 naming convention:
   `Firstname Lastname MM.YYYY HouseCode RoomCode`
2. WhatsApp will automatically pick up the name from the phone contact
3. Atlas cannot save to the phone directly — present the contact card (name + number) to Diego for manual save
4. Once the `/contacts/save` endpoint is live in the WA bridge, Atlas will handle this automatically

**Pending manual saves (12/03/2026):**
- `Tom Ross 03.2026 EB2 R7` — +33 6 03 17 70 94
- `Colin 03.2026 EB2 R1` — +33 6 10 81 71 96
- `Pablo 03.2026 EB2 R1` — +33 7 68 19 95 31
