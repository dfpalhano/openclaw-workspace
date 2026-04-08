# Staff Empowerment & Vacancy Reduction System
## Architect Report — v1.0.0
**Date:** 2026-04-07  
**Author:** @architect (cc-godmode)  
**Status:** Ready for Smith to build

---

## 1. Executive Summary

Mission Control is a mature, operational system built on a single `server.js` (~18,000 lines) with JSON file persistence, a native Node.js HTTP server, and HTML/JS frontends. It already contains nearly all the primitives needed: Jess inspection scheduling, the Flatmates relay, staff auth, manager profiles, and per-house vacancy data.

The gap is that **staff (Mathis, Lenny) have no dedicated UI surface to act autonomously**. Today they must go through Diego for almost everything — booking inspections, updating vacancy status, sending forms, checking Flatmates pipeline. This creates a bottleneck that keeps vacancy days high.

**The proposal:** Add a `/staff-dashboard` page (a new HTML file in the existing pattern) backed by 5–8 new lean endpoints in `server.js`, all gated by a per-person staff token. Staff get a mobile-friendly dashboard where they can see open vacancies per house, book inspections by choosing a slot, communicate action to Jess via the existing command queue, mark rooms as filled, and monitor the Flatmates pipeline. Diego gets a read-only oversight layer — no workflow actions required from him day-to-day.

**Phase 1 is buildable in ~2–3 days of focused engineering.** No framework migrations, no new databases, no new runtimes.

---

## 2. Current-State Architecture Observations

### Stack
- **Runtime:** Node.js 25.x, single process, no framework (raw `http.createServer`)
- **Persistence:** JSON files in `data/`, a SQLite DB (`db/mc.db`, `db/payments.db`) for payments, append-only log files in `logs/`
- **Frontend:** Multiple HTML pages served from the same process — `index.html` (main MC dashboard), `manager.html` (occupant directory), `/mc/jess` (inline HTML served from a giant string in server.js)
- **Auth:** Two parallel auth systems:
  - `POST /mc/manager/auth` → localStorage session, password checked against env vars `MGR_PASS_MATHIS`, `MGR_PASS_EMILIO` (no Lenny entry yet)
  - `POST /mc/staff/verify` → Bearer token via HMAC from `STAFF_TOKEN_SECRET` (shared password)
- **Communication:** WhatsApp bridge via jess-bot relay at `http://127.0.0.1:3847`, Jess command queue at `POST /mc/jess/command`

### Existing Assets Directly Relevant to This System

| Asset | Location | Purpose |
|---|---|---|
| `data/jess-rooms.json` | Data | Rooms with `available`, `assistant`, `inspection_date/time`, `listing_url` |
| `data/jess-inspections.json` | Data | Per-house inspection events with `host`, `date`, `time`, `slots[]` |
| `data/jess-enquirers.json` | Data | Flatmates leads with status pipeline |
| `data/jess-pending.json` | Data | Leads awaiting approval/action |
| `data/managers.json` | Data | Mathis, Lenny, Emilio — phone, wa_id, role |
| `data/staff-profiles.json` | Data | Strengths, domain, watchouts per staff member |
| `data/jess-admin-state.json` | Data | Blast history, auto-mode toggle, emergency stop |
| `GET /mc/jess/vacancies` | Endpoint | Active rooms + pipeline counts |
| `POST /mc/jess/room/inspection/:id` | Endpoint | Update inspection date/time/assistant |
| `POST /mc/jess/room/fill/:id` | Endpoint | Mark room as filled |
| `POST /mc/jess/invite/:enquirerId` | Endpoint | Send inspection invite to lead |
| `GET /mc/jess/house-slot/:houseCode` | Endpoint | Next slot + assistant for a house |
| `POST /mc/jess/command` | Endpoint | Command queue to Jess bot |
| `POST /mc/manager/auth` | Endpoint | Per-name manager auth |
| `GET /mc/staff/occupants` | Endpoint | Bearer-token gated occupant list |

### Key Gaps
1. **No per-person staff tokens** — current staff/verify uses a shared password; manager auth has Mathis + Emilio but not Lenny
2. **No staff-facing vacancy action UI** — Jess panel is Diego-only (no separate page, relies on existing complex Jess inbox)  
3. **No departure-trigger form** — staff can't record a noticed departure or flag a room coming available
4. **No structured Flatmates monitoring view for staff** — only the full Jess inbox (complex, no separation of concerns)
5. **No audit trail** for staff actions on vacancies — `manager-logins.log` exists but no vacancy action log
6. **`MANAGERS` dict in server.js doesn't include Lenny** — he can't log into `manager.html`

---

## 3. Proposed System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Mission Control server.js               │
│                                                           │
│  /staff-dashboard  ←── staff-dashboard.html (new file)   │
│                                                           │
│  NEW ENDPOINTS (all require per-person manager token)     │
│  POST /mc/staff/login          → per-person JWT-ish token │
│  GET  /mc/staff/context        → vacancy + pipeline data  │
│  POST /mc/staff/vacancy/depart → flag room coming avail.  │
│  POST /mc/staff/inspection/book → book slot, notify Jess  │
│  POST /mc/staff/room/fill      → mark room filled         │
│  GET  /mc/staff/flatmates      → filtered Flatmates view  │
│  POST /mc/staff/note           → log a field note         │
│                                                           │
│  MODIFIED ENDPOINTS                                       │
│  POST /mc/manager/auth → add Lenny, return role+houses   │
│                                                           │
│  EXISTING (reused as-is)                                  │
│  GET  /mc/jess/vacancies       ← context aggregation      │
│  POST /mc/jess/room/inspection/:id ← slot update         │
│  POST /mc/jess/room/fill/:id   ← fill room               │
│  POST /mc/jess/invite/:id      ← send invite via relay    │
│  POST /mc/jess/command         ← Jess task dispatch       │
└──────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
  jess-bot relay              data/*.json
  (127.0.0.1:3847)           (jess-rooms, jess-enquirers,
  WhatsApp sends             jess-pending, managers, etc.)
  Flatmates messages
```

### Auth Flow (Revised)
```
Staff opens /staff-dashboard
  → enters name + password
  → POST /mc/manager/auth (extended for Lenny)
  → receives { valid, displayName, role, assignedHouses, token }
  → token stored in sessionStorage
  → all subsequent requests use Authorization: Bearer <token>
  → server validates token = HMAC(name + secret)
```

Per-person tokens means Mathis and Lenny get different tokens, Diego can revoke independently, and we get a proper audit log per actor.

---

## 4. Minimal New Modules/Endpoints to Add in Mission Control

All additions live in `server.js`. Follow the existing pattern: `if (pathname === '...' && req.method === '...')`.

### 4.1 Extended Manager Auth — `POST /mc/manager/auth`
**Change:** Add `lenny` to the `MANAGERS` dict, add `MGR_PASS_LENNY` env var, return `assignedHouses` from `managers.json`, return a per-person HMAC token.

```js
// In /mc/manager/auth handler:
const MANAGERS = {
  'mathis': process.env.MGR_PASS_MATHIS || 'Mathis',
  'emilio': process.env.MGR_PASS_EMILIO || 'Emilio',
  'lenny':  process.env.MGR_PASS_LENNY  || 'Lenny',   // ADD THIS
};
// After valid check, generate per-person token:
const token = crypto.createHmac('sha256', _STAFF_TOKEN_SECRET)
  .update(nameLower + ':' + Date.now().toString().slice(0,-4))  // hourly rotation optional
  .digest('hex');
// Return assignedHouses from managers.json lookup
```

### 4.2 `GET /mc/staff/context` — Dashboard Data Bundle
Returns everything the staff dashboard needs in one shot. Avoids 5 separate fetches.

```js
// GET /mc/staff/context
// Auth: requireManagerAuth(req, res)  ← new helper (see §8)
// Response:
{
  staff: { name, role, assignedHouses },
  vacancies: [...],           // from /mc/jess/vacancies logic
  pipeline: {                 // per houseCode
    "SH1": { interested: 2, toInvite: 1, invited: 3, confirmed: 0 }
  },
  inspections: [...],         // from jess-inspections.json, next 7 days
  flatmatesActive: {          // from jess-rooms.json
    "SH1": true, "CO1": false
  },
  recentActivity: [...]       // last 10 entries from staff-activity.jsonl (new)
}
```

### 4.3 `POST /mc/staff/vacancy/depart` — Flag Departure
Staff records that a tenant has given notice or is about to leave. Writes to `active-tenants.json` (sets `moveOutDate`) and appends to `staff-activity.jsonl`.

```js
// Body: { tenantId, houseCode, moveOutDate, note, staffName }
// - Updates active-tenants.json tenant record
// - Appends to data/staff-activity.jsonl
// - Posts Jess command: { cmd: 'vacancy_incoming', args: { houseCode, availableDate } }
```

### 4.4 `POST /mc/staff/inspection/book` — Book Inspection
Staff picks a date/time and the assistant (themselves or colleague). Updates `jess-rooms.json` and `jess-inspections.json`, then triggers Jess to blast confirmed enquirers.

```js
// Body: { roomId, houseCode, date, time, assistant, sendInvites }
// - Calls existing jess/room/inspection/:id logic
// - If sendInvites=true, calls POST /mc/jess/command { cmd:'blast_invites', args:{ houseCode, date, time } }
// - Appends to staff-activity.jsonl
```

### 4.5 `POST /mc/staff/room/fill` — Mark Room Filled
Thin wrapper around existing `POST /mc/jess/room/fill/:id` that adds staff audit trail.

```js
// Body: { roomId, staffName, note }
// - Calls existing fill logic
// - Appends to staff-activity.jsonl
// - Sends Jess command: { cmd: 'listing_deactivate', args: { houseCode } }
```

### 4.6 `GET /mc/staff/flatmates` — Filtered Flatmates Pipeline
Returns only the Flatmates conversations/leads relevant to the staff member's assigned houses, without exposing the full Jess inbox complexity.

```js
// Query: ?house=SH1 or empty for all assigned houses
// Returns subset of jess-enquirers.json + jess-pending.json filtered by houseCode
// Sorted by: priority desc, updatedAt desc
// Fields: id, name, houseCode, status, phone, profileUrl, lastMessage, priority
```

### 4.7 `POST /mc/staff/note` — Field Note
General-purpose note from staff — can reference a house, tenant, or task.

```js
// Body: { staffName, houseCode, tenantId, note, category }
// categories: 'maintenance', 'tenant', 'vacancy', 'inspection', 'general'
// Appends to data/staff-activity.jsonl
```

### 4.8 New File: `data/staff-activity.jsonl`
Append-only JSONL log of all staff actions. Each line:
```json
{"ts":"2026-04-07T10:00:00Z","actor":"mathis","action":"inspection_booked","houseCode":"SH1","detail":{"date":"2026-04-12","time":"18:00"}}
```

---

## 5. Data Model Changes (Minimal / Additive)

### 5.1 `data/managers.json` — Add `hashedPassword` field
Currently stores role and houses but no credential. Two options:
- **Option A (simpler):** Keep passwords in env vars only, `managers.json` stays as-is. Just add Lenny.
- **Option B:** Add `passhash` field to `managers.json` to allow in-app password rotation without server restart.

**Recommendation:** Option A for Phase 1. Just add Lenny to `managers.json` and `MGR_PASS_LENNY` env var.

```json
// Add to managers.json:
{
  "id": "lenny",
  "name": "Lenny",
  "full_name": "Lenny",
  "phone": "+33783146859",
  "wa_id": "33783146859@c.us",
  "telegram_chat_id": null,
  "role": "manager",
  "active": true,
  "houses": ["CO1","EB1","EB2","EB3","GS1","SB1","SH1","SH2","SH3","SP9","V5","WE1","WL3","WL4","BRIS1"],
  "languages": ["FR","EN"]
}
```

### 5.2 `data/jess-rooms.json` — Add `staffNotes` field
Already has `notes`. Add `staffNotes: []` array for append-only field notes from staff (non-destructive).

### 5.3 `data/staff-activity.jsonl` — New file (append-only log)
No schema migration needed — append-only JSONL, created on first write.

### 5.4 `data/active-tenants.json` — No structural change
`moveOutDate` already exists on tenant records. Staff departure form just writes to an existing field.

### 5.5 `.env.local` — Add `MGR_PASS_LENNY`
```
MGR_PASS_LENNY=<password>
```

### Summary: What Does NOT Need to Change
- `jess-inspections.json` — already tracks inspections with assistant field
- `jess-enquirers.json` / `jess-pending.json` — already have status pipeline
- SQLite schema — no payment changes needed for Phase 1
- `house-details.json` — no changes needed

---

## 6. UI Structure for Staff Dashboard (Existing Stack)

### File: `staff-dashboard.html` (new, at repo root)
Pattern follows `manager.html` — single-file HTML with inline JS and CSS, served by existing static file handler in `server.js`.

```
Route: GET /staff-dashboard → serve staff-dashboard.html
Auth: /mc/manager/auth → sessionStorage token
```

### Page Layout (mobile-first, no framework)

```
┌────────────────────────────┐
│ MERIDIAN [logout] [Mathis] │  ← Header
├────────────────────────────┤
│ 🏠 OPEN VACANCIES (3)      │  ← Section: active rooms
│ ┌──────────┐ ┌──────────┐  │
│ │ SH1 R2   │ │ CO1 R4   │  │  ← Room cards
│ │ $280/wk  │ │ $310/wk  │  │
│ │ [Book]   │ │ [Book]   │  │
│ └──────────┘ └──────────┘  │
├────────────────────────────┤
│ 📅 UPCOMING INSPECTIONS    │  ← Section: inspection schedule
│ SH1 — Sat 12 Apr 18:00     │
│ [Mathis] 3 confirmed       │
├────────────────────────────┤
│ 👥 FLATMATES PIPELINE      │  ← Section: lead counts per house
│ SH1: 5 new | 2 invited     │
│ CO1: 2 new | 1 confirmed   │
├────────────────────────────┤
│ 📝 LOG A NOTE / DEPARTURE  │  ← Action section
│ [House ▼] [Category ▼]     │
│ [Note text...]             │
│ [Submit]                   │
├────────────────────────────┤
│ 📋 RECENT ACTIVITY         │  ← Last 10 entries from staff-activity.jsonl
│ 10:14 Mathis booked SH1    │
│ 09:50 Lenny noted CO1...   │
└────────────────────────────┘
```

### Interaction Patterns
- **Book Inspection:** Room card → slide-down form → pick date/time/assistant → submit → server updates jess-rooms + optionally triggers Jess blast
- **Mark Filled:** Room card → confirm button → POST /mc/staff/room/fill
- **Log Departure:** Form at bottom → select tenant → date → note → POST /mc/staff/vacancy/depart
- **View Flatmates Leads:** Each house pipeline count is clickable → expands to list of leads (name, status, last message)
- **Refresh:** Auto-refresh context every 60s via setInterval; no SSE needed for Phase 1

### CSS Approach
Copy the CSS variables and card pattern from `manager.html` — already defines `--bg`, `--accent`, `--card`, `--border`. The dashboard needs ~150 lines of additional CSS for the card grid and mobile breakpoints.

---

## 7. Jess + Flatmates Integration Points

### 7.1 Booking an Inspection → Jess
When staff books via `POST /mc/staff/inspection/book`:
1. Write to `jess-rooms.json` (inspection_date, inspection_time, assistant)
2. Write to `jess-inspections.json` (add/update entry for houseCode)
3. If `sendInvites=true`: `POST /mc/jess/command { cmd:'blast_invites', args:{ houseCode, date, time, assistant } }`
   - Jess picks this up, sends invites to all `viewing_pending` enquirers for that house
4. Append to `staff-activity.jsonl`

This is the core loop: **staff sets the when, Jess handles the who.**

### 7.2 Flatmates Pipeline Monitoring
- `GET /mc/staff/flatmates` reads `jess-enquirers.json` + `jess-pending.json`, filters by staff's assigned houses
- Staff can view lead name, last message snippet, status, priority
- Staff can call `POST /mc/jess/invite/:enquirerId` directly from the dashboard to send an inspection invite
- Staff cannot generate AI drafts (Diego-only for now) — they see the pipeline and trigger invites

### 7.3 Listing Activation/Deactivation
- When staff marks a room as filled: `POST /mc/staff/room/fill` → internally calls `POST /mc/jess/command { cmd:'listing_deactivate', args:{ houseCode } }`
- When a departure is flagged and room becomes available: `POST /mc/staff/vacancy/depart` → `POST /mc/jess/command { cmd:'vacancy_incoming', args:{ houseCode, availableDate } }`
- Jess already handles `listing_deactivate` — check if `vacancy_incoming` is implemented; if not, Smith adds a handler in the Jess command processor

### 7.4 Communicating with Jess (Existing Command Queue)
The command queue at `POST /mc/jess/command` accepts `{ cmd, args }`. Existing commands include:
- `listing_deactivate` — turn off Flatmates listing for a house
- `blast_invites` — send invites to pending enquirers for a house inspection

**New commands to add** (handled in the existing command processor block):
```
vacancy_incoming  { houseCode, availableDate }  → activate listing if not active, notify Jess inbox
inspection_cancel { houseCode, date }            → cancel scheduled inspection, notify confirmed enquirers
```

### 7.5 Jess Boost Status
`data/jess-boost-state.json` tracks per-house Flatmates boost availability. Staff dashboard can display this (read-only) — shows "Boost available" or "Boost unavailable" per house. No action needed from staff on this.

---

## 8. Permission Model (Mathis, Lenny, Diego)

### Auth Levels

| Action | Mathis | Lenny | Diego |
|---|---|---|---|
| View open vacancies | ✅ | ✅ | ✅ |
| View Flatmates pipeline (assigned houses) | ✅ | ✅ | ✅ |
| View Flatmates pipeline (all houses) | ✅ | ✅ | ✅ |
| Book inspection (any house) | ✅ | ✅ | ✅ |
| Send inspection invite to lead | ✅ | ✅ | ✅ |
| Mark room filled | ✅ | ✅ | ✅ |
| Flag departure | ✅ | ✅ | ✅ |
| Log field note | ✅ | ✅ | ✅ |
| Generate AI Jess reply draft | ❌ | ❌ | ✅ |
| Approve/send Jess messages | ❌ | ❌ | ✅ |
| Toggle Jess auto-mode | ❌ | ❌ | ✅ |
| Access full Jess inbox | ❌ | ❌ | ✅ |
| View tenant financials | ❌ | ❌ | ✅ |
| View tenant payment history | ❌ | ❌ | ✅ |
| Tenant registration / move-in | ❌ | ❌ | ✅ |
| Bond return actions | ❌ | ❌ | ✅ |
| View activity log (all staff) | ❌ | ❌ | ✅ |
| View activity log (own actions) | ✅ | ✅ | — |

### Implementation

**Phase 1:** Role check is simple — manager auth returns `role: 'manager'`. The new `requireManagerAuth()` helper checks for a valid per-person token. No house-level filtering needed yet (both can see all houses).

```js
function requireManagerAuth(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  // Validate against per-person token map (HMAC of name+secret)
  const managerEntry = getManagerByToken(token);
  if (!managerEntry) {
    json(res, 401, { error: 'unauthorized' });
    return null;
  }
  return managerEntry; // { id, name, role, houses }
}
```

**Diego's Oversight:** Diego uses the existing main MC dashboard (`/` or `/index.html`) — no changes to his workflow. He gets visibility into staff actions via `data/staff-activity.jsonl` (a new section in the MC dashboard, or a simple read endpoint he checks occasionally). Diego does NOT need to approve inspection bookings — that's the whole point.

**Future:** If per-house access control is needed (e.g. Mathis owns SH group, Lenny owns EB group), add a `restrictedHouses` array to `managers.json` and filter in `GET /mc/staff/context`.

---

## 9. Phase 1 Build Scope for Smith

This is the complete buildable spec. Estimated time: 2–3 days.

### Deliverables

#### A. `server.js` changes (additive only)

1. **Extend `/mc/manager/auth`:**
   - Add `lenny` to MANAGERS dict (reads `MGR_PASS_LENNY` env)
   - Return per-person HMAC token in response
   - Return `assignedHouses` from `managers.json` lookup

2. **Add `requireManagerAuth(req)` helper:**
   - Validates `Authorization: Bearer <token>` against per-person HMAC tokens
   - Returns manager object or null

3. **Add `GET /mc/staff/context`:**
   - Aggregates vacancies, pipeline, inspections, boost state
   - Requires manager auth
   - Returns single JSON bundle

4. **Add `POST /mc/staff/vacancy/depart`:**
   - Body: `{ tenantId, houseCode, moveOutDate, note, staffName }`
   - Updates `active-tenants.json` tenant's `moveOutDate`
   - Appends to `data/staff-activity.jsonl`
   - Posts `vacancy_incoming` command to Jess queue

5. **Add `POST /mc/staff/inspection/book`:**
   - Body: `{ roomId, houseCode, date, time, assistant, sendInvites }`
   - Updates `jess-rooms.json` and `jess-inspections.json`
   - If `sendInvites`: posts `blast_invites` to Jess command queue
   - Appends to `staff-activity.jsonl`

6. **Add `POST /mc/staff/room/fill`:**
   - Body: `{ roomId, staffName, note }`
   - Calls existing fill logic (reuse code from `/mc/jess/room/fill/:id`)
   - Posts `listing_deactivate` to Jess command queue
   - Appends to `staff-activity.jsonl`

7. **Add `GET /mc/staff/flatmates`:**
   - Query: `?house=SH1` (optional)
   - Reads `jess-enquirers.json` + `jess-pending.json`
   - Filters by manager's assigned houses
   - Returns simplified array: `[{ id, name, houseCode, status, priority, lastMessage, phone }]`

8. **Add `POST /mc/staff/note`:**
   - Body: `{ staffName, houseCode, tenantId, note, category }`
   - Appends to `staff-activity.jsonl`

9. **Add `GET /staff-dashboard` route** → serve `staff-dashboard.html` from root dir

10. **Add Jess command handler for `vacancy_incoming`:**
    - If houseCode has a room in `jess-rooms.json` with `available: false` and `available_date` in the future → set to available
    - Log to Jess inbox

#### B. `staff-dashboard.html` (new file)

Single-file HTML/CSS/JS. Sections:
- Login screen → POST /mc/manager/auth
- After auth: load context via GET /mc/staff/context
- Vacancy cards grid (mobile-responsive)
- Book inspection modal (form)
- Flatmates pipeline per house (expandable)
- Field note form
- Recent activity feed
- Auto-refresh every 60 seconds

#### C. `data/staff-activity.jsonl` (auto-created on first write)

#### D. `managers.json` (add Lenny entry)

#### E. `.env.local` (add MGR_PASS_LENNY — done manually by Diego)

### Out of Scope for Phase 1
- Staff-to-Jess direct messaging (not needed; Jess handles leads autonomously)
- Push notifications (staff refresh manually or on 60s poll)
- Per-house access restriction (all managers see all houses)
- Audit log viewer in main MC dashboard (Diego reads staff-activity.jsonl directly for now)
- Mobile app (mobile browser works fine)

---

## 10. Risks / Assumptions / Open Questions

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `blast_invites` Jess command not implemented | Medium | Smith checks jess-bot command processor; add handler if missing |
| `vacancy_incoming` command not implemented | High (new) | Smith implements in Jess command processor |
| Relay not running when staff books | Medium | Surface relay status in dashboard header (already available via `/mc/jess/status`) |
| Per-person token collision | Low | Use name+secret+date in HMAC; acceptable for this threat model |
| Mathis/Lenny share a device and see each other's tokens | Low | SessionStorage is per-tab; coach on browser hygiene |
| Staff books inspection without Flatmates listing active | Medium | Dashboard shows listing status; warn if booking for inactive listing |
| Race condition on jess-rooms.json concurrent writes | Very Low | Single-process Node.js; file writes are synchronous |

### Assumptions
1. Lenny is trusted with the same access level as Mathis for Phase 1 — confirmed by task context
2. Staff will use the dashboard from mobile browsers (site is served publicly via Cloudflare tunnel `cloudflared`)
3. The Flatmates relay (`http://127.0.0.1:3847`) is assumed running; dashboard shows an error state if not
4. Staff do NOT need to draft or send WhatsApp messages directly — Jess handles all outbound comms
5. Diego approves no inspection workflows — the point is full staff autonomy on scheduling

### Open Questions

1. **Does Lenny get a specific subset of houses or all houses?** Currently `managers.json` has Lenny assigned all houses — confirm with Diego if this is correct for Phase 1.

2. **Should the departure form trigger a WhatsApp confirmation to the departing tenant?** Could be a checkbox option. For Phase 1, assume no (just internal record).

3. **Blast invites: who does Jess message?** Currently `blast_invites` would message all `viewing_pending` enquirers. Should staff be able to select which enquirers to invite? For Phase 1: blast all, refine later.

4. **Inspection confirmation to confirmed leads if rescheduled?** If staff changes an existing inspection time, should Jess send a reschedule notice? Recommend yes — worth adding to the `inspection/book` handler.

5. **Activity log access for Diego:** Does Diego want a `/mc/staff-activity` endpoint in the main dashboard, or is reading the JSONL file directly acceptable for now?

6. **Mobile Cloudflare URL:** What's the public URL for the Cloudflare tunnel? Staff needs to bookmark `/staff-dashboard` at that URL. No change needed if `index.html` route pattern is followed.

---

## 11. Builder Handoff Checklist

Smith, work through this in order:

### Environment Setup
- [ ] Confirm `server.js` line count hasn't changed significantly from 18,353 (your working copy)
- [ ] Confirm `data/managers.json` is writable; add Lenny entry
- [ ] Set `MGR_PASS_LENNY` in `.env.local` (coordinate value with Diego)
- [ ] Confirm `data/jess-rooms.json` exists and has `id` field on each entry (it does — verified in codebase)
- [ ] Confirm jess-bot is at `/home/diegopalhano/projects/jess-bot` and relay is accessible

### server.js — Locate Insert Points
- [ ] Find the `POST /mc/manager/auth` block (~line 9255) — extend MANAGERS dict
- [ ] Find the `// ── POST /mc/staff/verify` block (~line 8406) — add `requireManagerAuth` helper nearby
- [ ] Find the end of the Jess section (~line 14200) — add new staff endpoints after
- [ ] Find the Jess command processor block (~line 13317) — add `vacancy_incoming` and `inspection_cancel` handlers
- [ ] Find the static file / catch-all at the bottom — ensure `/staff-dashboard` is served before the 404 handler

### Build Order
1. Extend `/mc/manager/auth` + `requireManagerAuth()` helper — test with curl
2. Add `GET /mc/staff/context` — verify it returns clean JSON for Mathis
3. Add `staff-activity.jsonl` append helper function (single reusable function)
4. Add `POST /mc/staff/note` (simplest action endpoint — good smoke test)
5. Add `POST /mc/staff/inspection/book`
6. Add `POST /mc/staff/vacancy/depart`
7. Add `POST /mc/staff/room/fill`
8. Add `GET /mc/staff/flatmates`
9. Add `vacancy_incoming` Jess command handler
10. Build `staff-dashboard.html` (can be done in parallel with steps 5–8)
11. Wire `GET /staff-dashboard` → serve `staff-dashboard.html`

### Testing Checkpoints
- [ ] `POST /mc/manager/auth` with `lenny` credentials returns valid token
- [ ] `GET /mc/staff/context` with Mathis token returns non-empty vacancies array
- [ ] `POST /mc/staff/note` appends to `staff-activity.jsonl`
- [ ] `POST /mc/staff/inspection/book` updates `jess-rooms.json` and `jess-inspections.json`
- [ ] `staff-dashboard.html` loads at `/staff-dashboard`, shows login screen
- [ ] Login as Mathis, dashboard shows vacancy cards
- [ ] "Book Inspection" form submits and rooms.json is updated
- [ ] Check `staff-activity.jsonl` has the correct entry format

### Do NOT Touch
- [ ] `data/active-tenants.json` schema — only write `moveOutDate` field
- [ ] Existing `/mc/jess/*` endpoints — call them from new staff endpoints, don't modify them
- [ ] `data/rent-payments.json`, payment endpoints — out of scope
- [ ] The main `index.html` Jess panel — Diego's tool, no changes

### Deployment Note
- Mission Control runs as a systemd service (`mission-control.service`) or launchd plist (`com.missioncontrol.server.plist`)
- After changes: `sudo systemctl restart mission-control` (Linux) or equivalent
- Cloudflare tunnel (`cloudflared`) is separate — no restart needed for URL routing
- No `npm install` needed if no new npm dependencies are introduced (target: zero new deps)

---

*End of Architect Report v1.0.0*  
*Written to: `/home/diegopalhano/.openclaw/workspace/reports/v1.0.0/01-architect-report.md`*
