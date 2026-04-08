# Smith Build Brief — Staff Dashboard Prototype (Mock Only)

## Objective
Build a **mock / prototype** version of the Mission Control staff dashboard.

This is **not** a live Mission Control implementation.
This prototype must use **cloned/mock data only** and must **not modify real occupant data or live operational files**.

---

## Hard Safety Rule
**Do not touch live Mission Control data.**

That includes, at minimum:
- `/home/diegopalhano/projects/mission-control/data/active-tenants.json`
- `/home/diegopalhano/projects/mission-control/data/tenants.json`
- `/home/diegopalhano/projects/mission-control/data/jess-rooms.json`
- `/home/diegopalhano/projects/mission-control/data/jess-inspections.json`
- `/home/diegopalhano/projects/mission-control/data/jess-enquirers.json`
- `/home/diegopalhano/projects/mission-control/data/jess-pending.json`
- any live send queue, registration, rent, payment, or production JSON files

Do not write to the live Mission Control repo for this phase.
Do not change production routes for this phase.
Do not send live WhatsApp messages for this phase.

---

## Execution Mode
- mock implementation only
- workspace-safe only
- no production edits
- no live sends
- no writes to real occupant data

Use cc-godmode principles, but build a prototype only.

---

## Build Location
Create the prototype under:
`/home/diegopalhano/.openclaw/workspace/mock-business-improvements/staff-dashboard-prototype/`

Suggested structure:
- `README.md`
- `index.html`
- `styles.css`
- `app.js`
- `data/`
- `data/mock-active-occupants.json`
- `data/mock-jess-rooms.json`
- `data/mock-jess-inspections.json`
- `data/mock-jess-enquirers.json`
- `data/mock-house-groups.json`
- `data/mock-config.json`

If a lightweight local mock server is useful, keep it inside this prototype folder only.

---

## Data Rules

### Allowed
- read live structures to understand schema
- create cloned/sanitised copies in prototype folder
- reduce data volume for usability
- preserve realistic field shapes

### Not allowed
- editing original live JSON
- editing live Mission Control routes
- using production send queues
- hitting live outbound messaging paths

### Preferred approach
Create **schema-faithful clones** with realistic representative records.
If sensitive fields are not needed for the prototype, they may be redacted.
If visibility rules require passport images/docs, use placeholder or copied-safe references only if that can be done without risking production files.

---

## Prototype Goals
The prototype should let Diego review:
- the staff dashboard layout
- permission boundaries
- vacancy workflow
- inspection workflow
- Flatmates pipeline view
- messaging UX
- note logging UX
- visibility of occupant/leads data

This is a product/UX/proof prototype, not a live system yet.

---

## Required Features in Prototype

### 1. Dashboard UI
- mobile-friendly
- simple and clear
- staff-oriented operations layout

### 2. Data Views
- all houses overview
- vacancies
- under-notice rooms
- occupants view
- leads / Flatmates pipeline
- house groups
- recent activity feed

### 3. Visibility Rules
Prototype the approved Phase 1 access rules:
- staff can see all houses
- staff can see occupant phone/email/docs/passport pictures in prototype view
- staff can see leads and house groups
- staff cannot see finance/admin/email layers
- contribution/rate shown only when room is vacant or under notice

### 4. Action Flows (Mock)
Mock the flows for:
- book inspection
- mark room filled
- flag departure / notice
- add note
- message occupant
- message lead
- message house group

### 5. Messaging UX
No live sends.
Instead, implement:
- template buttons
- editable message modal
- preview screen
- confirm action
- mock send result
- activity log entry in prototype data only

---

## Suggested Technical Approach
Prefer a lightweight static prototype unless there is a strong reason not to.

Recommended:
- HTML/CSS/JS only, or very lightweight local mock server if needed
- local JSON files loaded from prototype directory
- no new heavy framework unless absolutely justified

---

## Local Worker Delegation
Local qwen workers may help with:
- file/data mapping
- UI drafts
- test checklist drafting
- diff review
- docs

But final prototype integration remains with Smith.

---

## Deliverables
- complete prototype folder in workspace
- clear README for how to open/run it
- brief summary of mock data sources used
- explicit confirmation that live occupant data was not modified
- commit in workspace repo if workspace files are changed under git

---

## Verification Requirements
Before calling it done, verify:
- prototype runs locally
- mock data loads correctly
- vacancy and notice logic render correctly
- contribution visibility rule works
- messaging preview/confirm flow works in mock mode
- no live data files were modified by the prototype

If anything is not verified, state it clearly.

---

## Definition of Done
Done means:
- a usable prototype exists in workspace
- it demonstrates the intended staff experience
- it uses cloned/mock data only
- real occupant/live operational data remains untouched
- Diego can review the UI and workflow safely before production work starts

---

## One-line Rule
**Prototype the staff operations layer safely with cloned data first, and do not touch live Mission Control occupant data.**
