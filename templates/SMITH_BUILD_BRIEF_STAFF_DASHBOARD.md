# Smith Build Brief — Staff Dashboard Phase 1

## Objective
Build Phase 1 of the Mission Control staff dashboard using the existing Mission Control stack.

This is **not** a rewrite and **not** a SaaS/plugin workflow.
Use the existing local codebase and infrastructure.

---

## Execution Mode
- Use **cc-godmode** orchestration principles.
- **Do not use superpowers** for this task.
- You, Smith, are the **sole integrator**.
- You may use local qwen workers for bounded subtasks only.
- Final implementation decisions remain with you.

---

## Project Context
Project path:
`/home/diegopalhano/projects/mission-control`

Existing architecture:
- native Node.js HTTP server in `server.js`
- HTML/JS frontends, no React migration
- existing Jess integration and command queue
- existing manager auth flow
- existing JSON data files for vacancies, inspections, enquirers, managers

Reference architecture report:
`/home/diegopalhano/.openclaw/workspace/reports/v1.0.0/01-architect-report.md`

Reference local swarm pattern:
`/home/diegopalhano/.openclaw/workspace/templates/SMITH_LOCAL_SWARM_TEMPLATE.md`

---

## Business Goal
Enable Mathis and Lenny to operate day-to-day without Diego being a bottleneck.

Phase 1 should let staff:
- view vacancies
- book inspections with Jess
- monitor Flatmates pipeline
- log notes
- mark rooms filled
- flag departures / upcoming vacancies

Diego should remain oversight-only in the happy path.

---

## Mandatory Constraints
- no React migration
- no new npm dependencies unless absolutely necessary
- prefer additive changes only
- do not break existing Jess or Mission Control flows
- do not invent new infrastructure if existing systems already cover it
- verify before claiming completion

---

## Required Deliverables

### 1. Auth extension
Extend existing manager auth so Lenny can authenticate properly.

Expected outcome:
- Lenny added to auth flow
- per-person token returned for staff dashboard use
- token-based validation available for new staff endpoints

### 2. New staff dashboard UI
Create:
- `staff-dashboard.html`

Expected qualities:
- mobile-friendly
- simple HTML/CSS/JS
- matches current Mission Control style closely
- login flow + authenticated dashboard state

### 3. New staff endpoints
Add the Phase 1 endpoints proposed by architecture:
- `GET /mc/staff/context`
- `POST /mc/staff/vacancy/depart`
- `POST /mc/staff/inspection/book`
- `POST /mc/staff/room/fill`
- `GET /mc/staff/flatmates`
- `POST /mc/staff/note`

### 4. Activity logging
Create and use:
- `data/staff-activity.jsonl`

Use it as append-only activity/audit trail.

### 5. Jess integration reuse
Reuse existing command queue and Jess-related logic.
Only add thin glue where required.

---

## Suggested Local Worker Delegation
Use local qwen workers only for bounded help.

### Worker A — Mapper
Task:
- map exact insert points in `server.js`
- identify all relevant Jess endpoints, auth handlers, and data files
- produce exact file/function notes only

### Worker B — UI Draft
Task:
- draft `staff-dashboard.html`
- mobile-first, existing style, no invented APIs

### Worker C — Test Draft
Task:
- produce smoke tests for all new endpoints
- include auth failure, bad input, happy path

### Worker D — Diff Reviewer
Task:
- review your final patch for regressions, duplicate logic, broken auth, missing logging

You may also add a docs worker if helpful.

---

## Integration Order
1. confirm current code paths in `server.js`
2. extend auth for Lenny
3. add reusable staff auth helper
4. add activity log helper
5. add `GET /mc/staff/context`
6. add simplest write endpoint first (`POST /mc/staff/note`)
7. add inspection/vacancy/fill endpoints
8. add `GET /mc/staff/flatmates`
9. create `staff-dashboard.html`
10. wire route for `/staff-dashboard`
11. run smoke tests
12. review diff
13. verify manually
14. commit

---

## Verification Requirements
Before calling it done, verify at minimum:
- Lenny auth works
- Mathis auth still works
- `GET /mc/staff/context` returns valid data
- `POST /mc/staff/note` appends correctly
- staff dashboard loads and login works
- inspection booking path updates expected data files
- no obvious breakage to existing Jess flow

If anything is unverified, say so explicitly.

---

## Definition of Done
Phase 1 is done when:
- staff can log in
- staff can see vacancy/pipeline context
- staff can book inspections
- staff can log notes
- staff can mark rooms filled
- staff actions are logged
- no existing core flow is broken
- changes are committed cleanly

---

## Commit Guidance
Use clear commit messages, for example:
- `feat(mc): add phase 1 staff dashboard and staff endpoints`
- `feat(mc): extend manager auth for lenny and staff activity logging`

---

## One-line Operating Principle
**Use cheap local workers for bounded help, but keep Smith as the sole integrator and verifier.**
