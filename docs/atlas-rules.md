# Atlas Hard Rules
_These are non-negotiable. Locked dates indicate when they were violated and hardened._

---

## Communication Rules

### Rule: Draft First (LOCKED 2026-03-10)
**Every WA message must be shown as a draft to Diego for approval before sending.**
- No exceptions — individual, group, short message, long message, urgent or not
- Show draft → wait for "send" / approval → then execute
- Violation: Swan message sent without approval (2026-03-10 17:45 AEST)

### Rule: Single Confirm for Individual WA (updated 2026-03-10)
- Show draft = confirmation step 1
- "send" / "yes" / approval = step 2 → fire

### Rule: Double Confirm for Group Blasts (16+ houses)
- Show draft → "good to send?" → explicit second confirm → fire
- Violation logged: 2026-03-09 (16-house blast on single approval)

### Rule: Thread Lifecycle (LOCKED 2026-03-10)
- Close threads when the purpose is resolved
- No lingering watchOnly threads
- Clean watch list = better follow-up visibility

---

## Vox Rules

### Rule: Active Tenants = watchOnly (LOCKED 2026-03-10)
- Contacts in `active-tenants.json` → watchOnly + ping Diego
- NEVER auto-flow active tenants into registration_recovery or any other flow
- Violation: Lilian GS1 spammed about registration forms (2026-03-10)

### Rule: NEVER SILENT
- Every inbound message (even watchOnly) → ping Diego via @vox_wa_messages_bot
- Creates tg-pending entry with Kimi draft
- "Sure" reply → fires draft; "skip" → dismisses

### Rule: Auto-approve NEVER
- `AUTO_APPROVE_AFTER_MS = Infinity` — never re-enable

### Rule: No Email Auto-Send
- Never send emails automatically, ever

---

## Inspection Rules

### Rule: 2-Hour Lead Time
- Minimum 2 hours from when Jess sends Flatmates message to inspection time
- If it's already past 5pm, earliest possible tonight is 7pm+
- If too late → propose tomorrow

### Rule: Approval Gate
- Diego must approve the full schedule before Jess sends any Flatmates messages
- Jess messages → addresses included → Diego confirmation required

### Rule: Emilio vs Mathis Territory
- Mathis: Brisbane houses (SH1, SH2, SH3, CO1, EB1, EB2, EB3, GS1, SB1, V5, WE1, WL3, WL4)
- Emilio: SP9 (Surfers Paradise) + Gold Coast properties

---

## Data Rules

### Rule: Registration URL
- ALWAYS: `https://forms.housemates.online/r/<key>`
- NEVER: `mc.inspectionsxraytesting.com.au` (deprecated)

### Rule: House Group JIDs
- Source of truth: `MC/data/house-wa-groups.json` — always read from here

### Rule: LID Detection
- ≥14 digits = LID → use `@lid` suffix
- Standard AU numbers (≤13 digits) → `@c.us`

### Rule: Payment References
- Always include exact reference: `<paymentId> <houseCode>`
- Tenant uses this on EVERY bank transfer for matching

---

## Memory Rules

### Rule: Write It Down
- No mental notes. If it matters, write to a file.
- Key decisions → `memory/2026-MM-DD.md`
- Rules → `docs/atlas-rules.md` (this file)
- Processes → `docs/*.md`

### Rule: MEMORY.md = Main Session Only
- Never load MEMORY.md in group chats or shared sessions
- Contains personal context that must not leak

---

## Sub-Agent Rules

### Rule: Protocol 13
- Every sub-agent job → report back to Diego on finish OR failure
- No silent exits

### Rule: Sub-Agent Flags
- Always: `pty: true` + `background: true`
- Without these → exits in ~13ms

---

## Model Routing (quick ref)
| Task | Model |
|------|-------|
| Heartbeats | `ollama/minimax-m2.5:cloud` |
| Medium tasks, multilingual, email scan | `moonshot/kimi-k2.5` |
| Coding, file edits, production changes | `anthropic/claude-sonnet-4-6` |
| Kimi temperature | **Must be exactly `1`** |
