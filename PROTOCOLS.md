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

## Rule 29 — Notice Period & Move-Out Date (LOCKED 2026-03-13)
- Minimum notice: 2 weeks
- Move-out date = **second Sunday on or after (notice date + 14 days)**
- As soon as notice is given → set move-out date immediately in tenants.json + paydb
- Room is considered "on notice" only if move-out date is set

## Rule 28 — Bond Return Payment Verification (LOCKED 2026-03-13)
- NEVER send bond return amounts, deduction breakdowns, or return figures to any occupant until Diego has personally verified all payments for that person
- Always hold bond return drafts until Diego explicitly confirms: "payments checked, ready to send"
- Applies to all bond returns: Arnold, Valentin, Andrea, and any future cases

## Rule 27 — Inspection Announcement Buffer (LOCKED 2026-03-13)
- Inspection announcements to WA groups: always announce **1 hour before** real start and **1 hour after** real end
- Example: real inspection 10am–12pm → announce 9am–1pm
- Always use the `inspection_notice` template from house-templates.json
- Never announce the exact agent arrival time

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

---

## Rule 25 — Occupancy Offer / Additional Considerations Template (LOCKED 2026-03-12)
When sending occupancy details to a new tenant, ALWAYS use the template at:
`/home/diegopalhano/projects/mission-control/data/occupancy-offer-template.json`

**Mandatory inclusions (non-negotiable bullet points):**
- 4 months minimum stay
- No division of weeks, no exceptions
- Bond = 2.5 weeks (based on bondBase, not always weeklyRent)
- Mattress protector mandatory ($40 damage charge)
- No street shoes in carpeted areas
- Notice to leave: as per House Rules pages 20-24
- **House Rules & Occupancy Licence clause:** "By moving in, you agree to the House Rules and Private Occupancy Licence, which govern payments, shared living, and vacating procedures. Please read them carefully."

**Format rules:**
- Registration links go at the BOTTOM of the message
- Bank account shown at end of registration link (NOT in message body)
- Bond = 2.5 × bondBase (confirm bondBase with Diego — may differ from weeklyRent)
- Always personalise: moveInDate, address, room, weeklyRent, bondBase, bond, occupancyType

**Template last updated:** 2026-03-12

---

## Rule 29 — Tenant Movements Log (LOCKED 2026-03-13)

**Every time someone moves in or out, update `memory/tenant-movements.md` immediately.**

**On departure:**
1. Archive the tenant in `active-tenants.json` + `tenants.json` (set `status: archived`, `moveOutDate`)
2. Send bond return form with personalised token (do NOT calculate bond — Diego does that)
3. Add row to `memory/tenant-movements.md` under the correct house — OUT direction, date, notes
4. Add to Bond Returns Tracker at bottom of file

**On arrival:**
1. Add reg key + send invite with "bugs fixed" note if they had issues
2. Add to `active-tenants.json` if not already there
3. Add row to `memory/tenant-movements.md` — IN direction, date, room (if known), notes

**Replacement:**
- Always apply Protocol 21 (substitution exception rules)
- Link the OUT row and IN row under the same house section
- Note which room is now vacant vs filled

**File location:** `memory/tenant-movements.md`
**Also referenced in:** `MEMORY.md` → Contextual Memory Files table

---

## Rule 30 — Bond Return Standard Procedure (LOCKED 2026-03-15)

**Every bond return follows these steps in order:**

### Step 1 — Verify payments (Protocol 28)
- Diego personally confirms all payments are up to date before any figures are shared
- Do NOT calculate or share amounts until Diego says "payments verified"

### Step 2 — Calculate the return amount
- **Bond amount** = 2.5 × weekly rent
- **Cleaning fee** = $70 per person (always applied, no exceptions)
  - Single: $70 | Couple/shared: $140
- **Room deductions** = only if Diego confirms damage charges
- **Formula:** `Bond − cleaning fee − room deductions = return amount`

### Step 3 — Check for bank details
1. Check bond return requests JSON for submitted form details
2. Check WA PM chat for any bank details sent directly
3. If details found → go to Step 4
4. If NO details → generate a personalised bond return token and send with breakdown

### Step 4 — Send the message
Draft must include:
- Friendly greeting
- Security Contribution paid amount
- Cleaning fee deduction — always include clause reference: "as per House Rules & Occupancy Licence (pages 20–24)"
- Room condition deductions — cite specific clause: Clause 19.3 (room condition standard) & 19.4 (fixed charge)
- Total refund amount
- If bank details known → "I'll transfer now"
- If bank details unknown → personalised form link to collect them
- Tone: warm, friendly, not formal

**ALWAYS include the full breakdown — even if bank details were received via chat instead of the form. The breakdown message is mandatory in all cases, no exceptions.**

### Step 5 — Mark as done
- Update `bond-return-requests.json` → status: paid
- Update `memory/tenant-movements.md` → bond return tracker
- Note the transfer amount and date

### Key rules
- **Never send via Revolut** — Diego always sends via bank transfer
- **Never send figures** until payments verified (Protocol 28)
- **Always use personalised token** — never the generic `/bond-return` URL
- **Couple/shared room** = one return to one person (whoever receives)
- **Form captures payment proof** — if old form, re-issue token to collect return bank details

---

## Rule 31 — Occupancy Week Start Day (LOCKED 2026-03-15)

**Occupancy weeks always start on Sunday.**

- Week references must always use Sunday as the start date
- Cash payment receipts: "Week of Sun DD Mon YYYY"
- Never use Monday or any other day as week start
- Applies to all rent calculations, receipts, and week references

---

## Rule 32 — Welcome Package Duplicate Check (LOCKED 2026-03-15)

Before sending any welcome package (welcome message + house rules + licence + occupancy letter):

1. Check `welcomeSent` flag in resident-registrations.json
2. **Also check the WA chat history** — look for prior welcome messages, house rules PDFs, or occupancy letters already sent
3. Only send if BOTH checks confirm it hasn't been sent
4. Never rely on the flag alone — it may not be set if the welcome was sent manually or via a different flow

**Lesson (2026-03-15):** Sent Fiona's welcome package again because `welcomeSent` was null, but messages were already in her WA chat. Caused duplicate sends.

---

## Rule 33 — active-tenants.json + tenants.json Structure (LOCKED 2026-03-16)

These two files are the **canonical source of truth** for all occupant data. They are sacred.

**NEVER:**
- Change the schema/structure of either file without explicit owner approval
- Delete entries from either file
- Merge or reorganise fields without a full migration plan approved by Diego

**If structure needs to change:**
1. Export all data from the current file
2. Build the new structure in a NEW file
3. Migrate data field by field
4. Keep the old file as `active-tenants-backup-YYYY-MM-DD.json`
5. Only cut over after Diego explicitly confirms data integrity

**Archiving archived records (when approved):**
- Move `status: "archived"` entries to a separate `-archive.json` file
- Same schema — no field changes
- Keep backup of the original before any move

**Rule:** When in doubt about changes to these files — stop and ask Diego first.

---

## Rule 34 — Jess DOM Selectors Reference (LOCKED 2026-03-16)

Whenever debugging or rebuilding Jess extension/scraping logic, **always check first:**

`memory/jess-dom-selectors.md` — contains verified CSS selectors for:
- Conversation list items (member name, last-active, snippet, unread status)
- Thread navigation (conversation link, thread ID from href)
- Message history (inbound vs outbound messages, timestamps)
- Listing/house link in conversation header
- Listing management (activate/deactivate, edit rooms)

**File location:** `/home/diegopalhano/Documents/Jess.txt` (original) + `memory/jess-dom-selectors.md` (workspace copy)

**Before dispatching any Jess extension fix:** read this file and include relevant selectors in the task spec.

---

## Rule 35 — Jess Scope (LOCKED 2026-03-16)

**Jess handles Flatmates marketing ONLY.**

Jess does NOT:
- Control any MC data or functionality
- Provide occupant/room/house data to MC
- Manage payments, registrations, or bond returns
- Sync data into MC's core files (active-tenants.json, tenants.json, etc.)

**jess-rooms.json, jess-inbox.json, jess-pending.json** = Jess's own marketing data only.
MC must never pull house, room, or occupant data from Jess files.
All MC data comes from MC's own sources: active-tenants.json, resident-registrations.json, house-details, etc.

---

## Rule 36 — WA Quiet Hours (LOCKED 2026-03-17)

**Never send WA messages to occupants between 11:00pm and 7:30am Brisbane time.**

- If Diego says "send it" between 11pm–7:30am → automatically schedule for 7:31am instead
- Confirm: "Scheduled for 7:31am — too late to send now"
- Applies to: individual occupant messages, house groups, bond returns, any tenant-facing comms
- Does NOT apply to: work group (Mathis/Emilio), Diego's personal contacts, urgent operational emergencies (Diego must explicitly override)

**Override:** If Diego explicitly says "send now, urgent" → send immediately. One clear override only.

---

## Rule 37 — WhatsApp Session Data (LOCKED 2026-03-17)

**NEVER touch, delete, move, or modify anything in `~/.whatsapp-session/` without Diego's explicit approval.**

This includes:
- Session files
- Cache files
- Any subdirectory

**Always ask first.** Even if it seems harmless (like clearing cache). This is non-negotiable.

**Violation logged:** 17 Mar 2026 — Atlas cleared Chrome cache in `~/.whatsapp-session/session/Default/Cache/` without asking. Session was restored but the action was wrong.

---

## Protocol 38 — Vox Outbound Prohibition (LOCKED 2026-03-18)

**Vox NEVER sends proactive/outbound messages to occupants without Diego's explicit approval.**

- Vox responds to INBOUND messages only
- No automated follow-ups, nudges, check-ins, or recovery flows
- `registration_recovery` flow: permanently disabled
- Any new outbound flow requires Diego's explicit approval before activation
- Exceptions are made case-by-case by Diego only

**Violation logged:** 18 Mar 2026 — Vox sent unsolicited "checking in" registration follow-up messages to occupants without approval. Flow disabled immediately.

---

## Protocol 39 — Occupancy Offer Card (LOCKED 2026-03-18)

**Every new occupant receives an Occupancy Offer Card. No exceptions.**

### When to send
- Send BEFORE or ALONGSIDE the registration form link
- Single person → one card
- Couple/sharers → one card EACH (same content, same room, same price)
- If one partner already received it but the other hasn't → send to the missing person immediately

### What the card contains
- Full property address
- Room description (correct room code, e.g. R2 — never "Chambre" or vague descriptions)
- Move-in date (confirmed with Diego before sending)
- Weekly rent — **ALWAYS full room price, never split per person**
- Security contribution (bond) = 2.5 × weekly rent

### Before sending — Atlas must confirm with Diego:
1. ✅ Move-in date confirmed?
2. ✅ Weekly rent confirmed (no negotiation pending)?

**If either is not confirmed → DO NOT send. Ask Diego first.**

### Template
- ID: `occupancy_offer` in house-templates.json
- Label: 🏡 Occupancy Offer Card

### Room assignment rule
- Couples/sharers replace each other in the same room
- The room code stays fixed (e.g. person1 replaces person2 in R2 → still R2)
- Always use the correct R-format room code in the card

### After sending
- Mark `occupancyOfferSent: true` on the occupant record
- Log date sent

