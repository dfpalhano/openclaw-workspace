# Staff Dashboard Phase 1 — Permission Matrix and Communication Rules

## Purpose
Define exactly what Mathis and Lenny may see and do in the Phase 1 staff dashboard.

This document is the authority for Smith when implementing the restricted staff operations layer on top of Mission Control.

---

## Staff Model
- Mathis and Lenny have the **same access level** in Phase 1.
- They can see **all houses**.
- Their dashboard is an **operations console**, not full Mission Control.
- Diego remains the full-access owner/oversight role.

---

## Core Principle
Expose what staff need to operate vacancies, inspections, occupants, and lead flow.
Do not expose broader finance/admin/owner correspondence layers unless explicitly approved.

---

## Visibility Rules

### Staff CAN see

#### Houses / Rooms
- all houses
- all rooms
- room status
- vacancy state
- under-notice state
- inspection schedule
- occupancy timing relevant to operations

#### Occupants
- occupant name
- phone number
- email address
- room / house assignment
- move-in date
- move-out date
- notice status
- operational notes relevant to move-in, move-out, and inspections
- uploaded occupant documents
- passport pictures / identity images

#### Leads / Flatmates
- lead name
- phone number if present
- email if present
- assigned house / target room
- pipeline status
- inspection status
- relevant lead notes
- Flatmates situation per house

#### Groups / Communication Targets
- house WhatsApp groups
- leads
- occupants

#### Operations Context
- recent activity
- staff notes
- inspection history relevant to booking flow
- vacancy pipeline

---

## Staff CANNOT see

### Finance / Admin / Owner Layer
- full financial dashboards
- payment history
- bank details
- bills
- invoices
- owner-only financial reports
- broader admin/legal views
- real estate correspondence
- agent emails
- landlord emails
- private owner notes not relevant to operations
- full email inbox access

---

## Conditional Visibility Rules

### Contribution / Rent Visibility
Staff should **not** see normal room contribution/rate by default.

Staff **may** see room price/contribution only when:
- the room is vacant, or
- the occupant is under notice / the room is about to become available

This rule applies to:
- vacancy cards
- notice workflow
- listing / inspection preparation
- lead matching context

It should not be shown broadly on ordinary occupied-room views.

---

## Allowed Actions

### Operational Actions
Staff may:
- view vacancy dashboard
- view under-notice rooms
- book inspections
- reschedule inspections
- cancel inspections (if implemented in Phase 1 or Phase 2)
- mark room filled
- flag departure / notice given
- log internal notes
- view Flatmates pipeline
- trigger listing-related workflows through Jess

### WhatsApp Communication Actions
Staff may send WhatsApp messages to:
- occupants
- leads
- house groups

This is explicitly approved for Phase 1.

---

## Communication Model for Phase 1

### Strong Recommendation
Use **button-triggered and structured actions first**, with optional templated messaging where possible.

### Allowed Communication Types

#### 1. Structured / Button-triggered actions
Examples:
- Send inspection invite
- Send inspection reminder
- Send vacancy follow-up to lead
- Send move-in next steps to occupant
- Notify house group about inspection / house event / vacancy-related ops item

These should be preferred wherever possible.

#### 2. Guided message composer
Staff may also send WhatsApp messages directly to:
- leads
- occupants
- house groups

But this should be implemented with guardrails:
- clear recipient shown
- clear target type shown (lead / occupant / group)
- confirmation before send
- activity log entry after send
- template shortcuts where possible

---

## Recommended Communication Guardrails

For every staff WhatsApp send action, the UI should show:
- recipient name
- recipient type
- phone / WA target or group target
- house / room context if relevant
- message preview before send
- confirmation button

After send, log to `staff-activity.jsonl`:
- actor
- target type
- target id / number / group
- timestamp
- message type (template or custom)
- linked houseCode if relevant

---

## Suggested Message Modes

### Mode A — Template buttons
Preferred for common tasks:
- inspection invite
- inspection reminder
- move-in checklist
- vacancy follow-up
- house group notice

### Mode B — Editable template
Good balance:
- start from template
- allow staff to edit before send
- preview + confirm

### Mode C — Freeform custom message
Allowed in Phase 1 because Diego approved direct WA messaging.
Still apply confirmation + logging.

---

## Phase 1 Communication Scope

### Staff MAY send WA to occupants
Examples:
- inspection updates
- move-in / move-out logistics
- document reminders
- follow-up questions
- operational coordination

### Staff MAY send WA to leads
Examples:
- inspection invite
- follow-up after enquiry
- reminder before viewing
- next steps after inspection

### Staff MAY send WA to house groups
Examples:
- inspection notice
- access / coordination messages
- operational house updates

---

## Communication Restrictions Still In Place
Even though direct WA sending is allowed, staff should **not** use the staff dashboard for:
- owner-only legal messaging
- financial negotiation
- real estate / property manager email conversations
- sensitive admin messages outside operational scope
- unrestricted access to private email threads

If a workflow touches legal, finance, or owner-only correspondence, it stays with Diego or a separate protected workflow.

---

## Phase 1 UI Implications
The staff dashboard should include:

### Main sections
- vacancies
- under notice
- inspections
- Flatmates pipeline
- occupants/leads search
- activity feed
- message actions

### Messaging UI
For each occupant / lead / group card:
- quick action buttons
- message button
- prefilled template options
- preview modal
- confirm send

### Examples of quick action buttons
- Book inspection
- Send invite
- Send reminder
- Mark filled
- Log note
- Message occupant
- Message lead
- Message house group

---

## Audit Requirements
Every meaningful staff action should be logged, including:
- inspection booked
- inspection changed
- room marked filled
- departure flagged
- note added
- WA message sent

Minimum audit fields:
- timestamp
- actor
- action
- target type
- target identifier
- houseCode if relevant
- short metadata payload

---

## Smith Implementation Guidance
When implementing Phase 1:
- do not expose finance/admin/email layers in staff endpoints
- do expose operational contact/doc fields needed by staff
- hide room price unless vacant or under notice
- implement message sends with preview and confirmation
- prefer reusable template buttons for common communication
- append all message actions to the staff activity log

---

## Summary
Phase 1 staff dashboard =
- full operational visibility across all houses
- occupant and lead contact/doc visibility
- no broad finance/admin/email access
- conditional room price visibility
- direct WhatsApp messaging allowed to occupants, leads, and house groups
- button-driven workflows preferred
- logging and confirmation required

---

## One-line Rule
**Give staff the operational power to move vacancies and inspections fast, without giving them the owner’s full financial/admin brain.**
