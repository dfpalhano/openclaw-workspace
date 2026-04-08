# Memory Source Hierarchy

## Purpose
Atlas must treat Diego's environment as a large operational memory surface, not a small notebook.

The problem is not memory capacity. The problem is retrieval routing.

This system has abundant memory across live data, historical data, logs, exports, backups, repos, and plugin-backed recall layers. Atlas must choose the right source for the question.

---

## Core Rule
For any question, Atlas should ask:

**What is the most authoritative and useful memory source for this exact task?**

Not:
- what is easiest to read
- what is already in context
- what is inside one memory folder only

---

## Memory Tiers

### Tier 1 — Hot Memory (Live Source of Truth)
Use first for live operational questions.

Examples:
- Mission Control live data
- WhatsApp bridge current code/config
- Jess live data
- registration keys
- active occupants
- house groups
- live queues
- current service configs
- current logs when debugging live behaviour

Use Tier 1 when the question is about:
- current state
- what is live now
- operational truth
- current workflow outputs
- current integration behaviour

---

### Tier 2 — Warm Memory (Curated Operational Memory)
Use for rules, preferences, policy, and recurring workflow knowledge.

Examples:
- `MEMORY.md`
- `memory/core/active-tasks.md`
- `PROTOCOLS.md`
- `TOOLS.md`
- workspace docs
- onboarding docs
- process docs

Use Tier 2 when the question is about:
- rules
- templates
- procedures
- owner preferences
- operating constraints
- known lessons

---

### Tier 3 — Cold Memory (Historical Operational Memory)
Use when the answer likely exists in prior examples, old chats, exports, logs, or backups.

Examples:
- WhatsApp chat exports
- archived logs
- backups
- historical JSON snapshots
- prior examples in data exports
- previous message phrasing
- old implementation traces

Use Tier 3 when the question is about:
- “we did this before”
- previous wording
- historical examples
- debugging regressions
- how a prior flow worked
- what used to be sent or stored

---

### Tier 4 — Semantic / Plugin Memory
Use when retrieval is fuzzy, cross-session, summarised, or the exact file/location is unknown.

Examples:
- memU
- lossless-claw
- hyperspell
- memory_search
- lcm_grep / lcm_expand_query

Use Tier 4 when the question is about:
- compacted conversation history
- fuzzy memory recall
- semantic lookup
- cross-session retrieval
- “what did we decide previously?”

---

### Tier 5 — Extended Memory Surface
Use when the answer may live outside the usual workspace or live MC path.

Examples:
- other repos
- plugin state
- sidecar tools
- Git history
- external-but-local exports
- long-term archives outside workspace

Use Tier 5 when:
- the obvious sources are insufficient
- the task references old plugins, backups, historical installs, or side systems
- Diego explicitly says to look in broader memory

---

## Retrieval Routing by Question Type

### A. Live ops question
Examples:
- current occupant state
- active registration key
- did a WA message send
- current Jess listing status

Route:
1. Tier 1
2. Tier 2
3. Tier 3 if needed
4. Tier 4 only if required

### B. Policy / rule / template question
Examples:
- what format we use
- what is allowed
- how occupancy drafts should look

Route:
1. Tier 2
2. Tier 1 if live implementation matters
3. Tier 3 for old examples
4. Tier 4 for prior conversation decisions

### C. “We did this before” / historical example question
Examples:
- how we previously phrased a message
- what endpoint worked before
- where the old workflow lived

Route:
1. Tier 3
2. Tier 2
3. Tier 1 if verifying current implementation
4. Tier 4 for fuzzy recall

### D. Compacted conversation question
Examples:
- what was decided earlier in chat
- which model was chosen
- what plan we had before compaction

Route:
1. Tier 4 (lossless-claw first)
2. Tier 2
3. Tier 3 if examples/history matter

### E. Unknown/fuzzy recall question
Examples:
- “I know we had this somewhere”
- “check plugins/backups/history”

Route:
1. Tier 4
2. Tier 3
3. Tier 5
4. Then Tier 1/Tier 2 for verification

---

## Default Search Discipline
Before answering, Atlas should decide whether the task needs:
- live truth
- curated rules
- historical examples
- compacted conversation recall
- broad semantic retrieval

Then search the best matching tier first.

Do not default to only one source class.

---

## Verification Rule
If the answer affects live operations, messages, payments, occupants, or system behaviour:
- verify against the most authoritative live source before presenting as fact
- historical memory may inform, but live truth wins

---

## Anti-Pattern to Avoid
Atlas must not behave as if memory only means:
- one markdown file
- one plugin search
- whatever is already in context

That is too narrow for Diego’s environment.

---

## One-line Principle
**This system has abundant memory. Atlas must route retrieval intelligently across the full operational memory surface.**
