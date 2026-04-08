# Smith Local Swarm Template

## Purpose
Reusable orchestration template for coding work where Smith is the sole integrator and local Ollama workers handle cheap bounded subtasks.

## Core Rule
- Smith is the only final integrator.
- Local workers may analyse, draft, review, and suggest.
- Local workers do not get final authority.
- No swarm democracy.

---

## Recommended Topology

```text
Forge (optional, only for larger/ambiguous work)
        ↓
      Smith
   /    |    |    \
Mapper  UI   Tests  Reviewer
(qwen) (qwen) (qwen) (qwen)
```

---

## Roles

### 1. Smith
**Role:** Lead implementer and integrator  
**Authority:** Final code changes, integration decisions, verification

**Owns:**
- final patching
- route/auth/data-flow changes
- production-sensitive logic
- final review before commit
- verification that work actually functions

### 2. Forge (optional)
**Role:** Architect/coordinator for bigger work  
**Use when:** scope is broad, ambiguous, or multi-system

**Owns:**
- architecture decisions
- sequencing
- acceptance criteria
- handoff spec for Smith

### 3. Mapper Worker
**Model:** local qwen3.5  
**Owns:**
- codebase mapping
- insert-point discovery
- dependency listing
- touched file inventory

**Output:** report only

### 4. UI Worker
**Model:** local qwen3.5  
**Owns:**
- HTML/CSS/vanilla JS drafts
- lightweight UI structure
- copy text / labels / layout suggestions

**Output:** draft UI only

### 5. Test Worker
**Model:** local qwen3.5  
**Owns:**
- smoke test plans
- curl examples
- edge-case checklist
- manual validation steps

**Output:** test draft only

### 6. Diff Reviewer Worker
**Model:** local qwen3.5  
**Owns:**
- review of Smith diff
- auth/regression/duplication warnings
- missing error handling notes

**Output:** review notes only

### 7. Docs Worker (optional)
**Model:** local qwen3.5  
**Owns:**
- changelog draft
- operator notes
- implementation summary

**Output:** doc draft only

---

## Safe Delegation Boundaries

### OK to delegate to local workers
- code search
- summarisation
- first-pass patch suggestions
- UI mockups
- test drafting
- docs drafting
- diff review
- file mapping

### Do NOT delegate final authority on
- auth
- permissions
- data writes
- production routes
- cross-system integration decisions
- destructive refactors
- final merge logic

---

## Default Execution Flow

### Small implementation
```text
Smith
 ├─ Mapper
 ├─ UI Worker (if UI needed)
 ├─ Test Worker
 └─ Reviewer
Smith integrates → verifies → commits
```

### Larger implementation
```text
Forge → architecture/spec
         ↓
       Smith
   ├─ Mapper
   ├─ UI Worker
   ├─ Test Worker
   ├─ Docs Worker
   └─ Reviewer
Smith integrates → verifies → commits
```

---

## Prompt Templates

### Mapper Prompt
"Map all files, endpoints, functions, and likely insertion points relevant to: [task]. Output only exact file paths, function names, route names, data files, and key risks. Do not propose a rewrite."

### UI Worker Prompt
"Draft a minimal [HTML/CSS/JS] UI for: [task]. Match the existing local style and stack. Do not invent backend APIs beyond: [list]. Output draft markup and interaction notes only."

### Test Worker Prompt
"Create a smoke-test checklist and sample requests for: [task]. Cover auth failure, invalid input, happy path, and obvious edge cases. Keep it concrete."

### Diff Reviewer Prompt
"Review this diff for regressions, auth issues, duplicated logic, broken existing flows, and missing validation. Be concise and specific."

### Docs Worker Prompt
"Draft a short operator/developer summary for: [task]. Include what changed, files touched, how to test, and rollback notes."

---

## Smith Integration Checklist

Before Smith merges anything from local workers:
- verify file paths exist
- verify route names match real code
- verify JSON/data structures are real
- verify no invented helper functions slipped in
- verify auth flow end-to-end
- verify side effects on existing workflows
- verify errors are handled cleanly
- verify test checklist against real endpoints/files

---

## Quality Rules
- Prefer additive changes over rewrites.
- One worker, one bounded concern.
- Never let multiple cheap workers independently patch the same production file.
- If outputs conflict, Smith decides.
- If the task is messy or architecture-heavy, escalate to Forge first.
- If verification is weak, do not claim completion.

---

## Recommended Model Use
- Forge: architecture, planning, system design
- Smith: implementation and final integration
- local qwen3.5: mapper, UI, tests, docs, diff review

---

## Mission Control Example

For a staff dashboard feature:

### Suggested swarm
1. Mapper: map Jess endpoints, manager auth, staff auth, data files
2. UI Worker: draft `staff-dashboard.html`
3. Test Worker: create endpoint smoke tests
4. Diff Reviewer: review Smith patch

### Smith then
- extends auth for Lenny
- adds new staff endpoints
- adds activity logging
- integrates UI
- validates in local Mission Control
- commits final result

---

## One-Line Operating Principle
**One strong integrator, several cheap bounded helpers, no swarm democracy.**
