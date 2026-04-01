# Active Tasks

## Current
- App-route-first lookup for MC requests: when someone asks for an MC page/route (like occupants), check the MC app path first before memory or broad search.
- Add explicit MC registration-key rule: when drafting a new occupancy card, generate a fresh individual registration key automatically for that person unless the source data is ambiguous or missing.
- For occupancy send flow: after the owner says "send her" (or equivalent final send instruction) and the draft is already approved, send immediately without asking for confirmation again.
- For occupancy drafts, always fill the commencement date with the actual calendar date, never "tomorrow".

- Bond-return identity chain fix: use WhatsApp number as the person anchor, occupant/tenant id as the stay anchor, and make bond-return cases children of the occupant record. Do not treat bond-return token/request ids as source of truth.
- Messaging confirmation rule updated: single destination (1:1 or one group) executes without extra confirmation when the instruction is clear; multiple groups/destinations, ambiguous details, confusing corrections, or unusually sensitive/public-facing messages require extra confirmation.
- WhatsApp bridge /send-file requires `filePath` (not `path`) in the JSON payload. Use `to`, `filePath`, optional `caption`, and optional `filename`. This is the working permanent send-file format.
