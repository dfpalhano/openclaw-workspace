# Stackd Ops — Concept Spec

## Working Name
**Stackd Ops**

## Positioning
A lightweight worker operations and accountability app inside Mission Control.

Built for Mathis and Emilio first.

Purpose:
- track who is working
- track where they are
- confirm they actually reached the assigned property
- confirm travel and on-site time are credible
- capture proof-of-work cleanly
- produce useful reports without needing full live surveillance

## Why this exists
Timeroo is mainly useful for:
- reports
- GPS tracking
- timesheets
- timestamps

Instead of building a full standalone worker app immediately, Stackd Ops should bring the useful operational parts into Mission Control and keep the system simple.

## Core Product Direction
This is not a full employee-management platform.
This is not a full Timeroo replacement.
This is an internal field-operations system for house management work.

## Phase 1 — Smart lightweight worker tracking
### Core features
- worker login
- shift start / end
- task start / complete
- destination attached to every work trip
- event-based GPS pings on key actions
- every 3-minute GPS ping while actively working in a house
- timestamps for all worker actions
- simple timesheet view
- simple report view
- notes and proof-of-work attachment support

### Event pings
Capture GPS + timestamp on:
- shift start
- shift end
- travel start
- task start
- task complete
- inspection submitted
- manual check-in

### Active house pings
While worker is actively clocked into a specific house/job:
- ping every 3 minutes
- record worker, task, house, timestamp, location

## Geofence logic
When a worker is assigned to a property:
- attach destination address to the task
- create a geofence around that property
- if worker exits the valid work geofence while task timestamp is active:
  - send notification
  - flag the event
  - deactivate or pause the active timestamp for review

## Driving / route integrity logic
Goal: not perfect surveillance — make dishonest travel behaviour obvious.

### Travel model
Each trip should include:
- assigned destination
- travel start time
- start GPS point
- expected travel time reference
- periodic pings during travel if enabled
- arrival geofence confirmation

### Anti-bullshit signals
Flag for review if:
- no destination exists for a travel timestamp
- worker starts trip but does not move for too long
- worker moves away from destination for multiple pings
- actual travel time is materially longer than expected
- worker never enters destination geofence
- task is completed without credible arrival pattern
- on-site duration is too short for task type
- repeated unexplained detours happen

### Important rule
Use route reasonableness and anomaly detection, not exact turn-by-turn policing.

## Phase 2 — Stronger operations layer
- inspection forms
- cleaning checklists
- maintenance issue logging
- photo proof
- worker dashboard
- owner review dashboard
- recurring operational tasks
- exportable reports

## Phase 3 — Optional route intelligence
Only if needed later:
- Google Maps route reference per trip
- route deviation flagging
- stronger travel anomaly review
- richer analytics

## Product principle
The goal is to make false reporting easy to detect without overbuilding surveillance.

## Rollout path
### Stage 1 — inside Mission Control
- build Stackd Ops as a mobile-friendly internal module inside Mission Control
- prove workers actually use it
- keep updates fast and friction low

### Stage 2 — PWA / app-like deployment
- make it installable on phones
- improve mobile experience
- keep release cycle simple while validating usage

### Stage 3 — App Store / Google Play if proven
- wrap or rebuild the validated experience for store distribution
- only do this after the workflow is proven useful in real operations
- app-store release should come after permission/privacy/location flows are already stable

### Important rule
Do not start with the App Store. Validate the workflow inside Mission Control first, then package later if worth it.

## Payment reconciliation direction
### Source-of-truth rule
- Excel payment file is the truth
- bank statements are the reconciliation and enrichment layer
- never blindly overwrite Excel truth with bank data

### What bank data should do
Use bank statements to:
- confirm actual incoming payments
- fill payment history where possible
- flag missing payments
- flag late or partial payments
- identify unmatched transfers
- improve management visibility in Mission Control

### What the reconciled system should show per occupant
- house
- name
- expected weekly rent
- payment history
- matched bank transactions
- latest payment date
- missing or unpaid periods
- current payment status (`paid`, `partial`, `late`, `missing`, `uncertain`)

### Management outputs
- unmatched transaction list
- likely matches needing review
- per-house payment visibility
- payment history rollup per occupant
- cleaner MC payment dashboard fed by Excel + bank statement reconciliation

## Recommended implementation shape
- Build inside Mission Control first
- Keep it mobile-friendly
- Use GPS event capture and 3-minute work-site pings instead of full live tracking
- Add route intelligence only after the simpler version proves useful

## Brand direction
Use the existing **stackd** visual language:
- font: Plus Jakarta Sans 800
- tight letter spacing
- dark background option
- signature indigo/electric blue `d` (#4F6BFF)

## Logo direction — "standard but spicy"
### Primary recommendation
Keep the base `stackd` logo system and extend it into **Stackd Ops**.

### Wordmark direction
- `stackd` in the standard brand style
- `Ops` as a sharp, more energetic extension
- maintain clean premium look, but introduce subtle field/operations aggression

### Visual ideas
1. **stackd Ops** wordmark
   - `stackd` in standard style
   - `Ops` in white or cool steel with the blue accent carried through
   - slightly more angular spacing/treatment than nestd/crestd

2. **stackd`d` pulse variant**
   - keep normal stackd logo
   - add subtle GPS pulse / signal ring / tracking spark around the `d`
   - minimal, not gimmicky

3. **stackd Ops pin variant**
   - use a very subtle location-pin geometry or route-line cue integrated into the `Ops` lockup
   - keep it elegant, not startup-cheesy

### Spicy but still on-brand means
- do not abandon the current family look
- add motion / field / tracking cues subtly
- keep it premium, operational, and sharp
- no cartoon GPS pins, no generic app icons, no clutter

## Best logo concept to generate first
**stackd Ops** on dark background:
- `stackd` in the current stackd style
- blue accent on the `d` (#4F6BFF)
- `Ops` in clean white or silver-white
- subtle GPS pulse / route energy detail integrated around the final `d` or behind the lockup
- clean, premium, slightly dangerous / high-performance feel
