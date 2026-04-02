# TOOLS.md — Atlas Environment Reference
_Last updated: 2026-04-01 (change detection + backups added) | Read every session._

---

## ⚠️ CRITICAL: Two things, same name — never confuse them

| "MC occupants" (what Diego means) | "Staff occupants page" (NOT what Diego means) |
|-----------------------------------|-----------------------------------------------|
| The database: `active-tenants.json` | The browser UI: `mc.housemates.online/occupants` |
| Atlas reads this directly | For human staff only — Atlas never touches this |
| Use internal API or cat the file | Password-gated HTML — irrelevant to Atlas |

**When Diego asks about occupants, always read the database. Never mention the web page.**

---

## Mission Control (MC) — Canonical Data Sources

**MC is the source of truth for all occupant, tenant, and house data.**
Atlas reads data directly from files or the internal API — never the web UI.

### MC Server
- **Port:** `8899` (local) — proxied via nginx → `mc.housemates.online`
- **Service:** `~/.config/systemd/user/mission-control.service`
- **Source:** `/home/diegopalhano/projects/mission-control/server.js`

---

## Reading MC Occupant Data (3 methods — use in this order)

### Method 1 — Read file directly (fastest, no HTTP)
```bash
cat /home/diegopalhano/projects/mission-control/data/active-tenants.json
```
Returns all tenants including active, future, archived, bond_pending.

Filter to current occupants only:
```bash
node -e "
const t = JSON.parse(require('fs').readFileSync('/home/diegopalhano/projects/mission-control/data/active-tenants.json','utf8'));
const arr = Array.isArray(t) ? t : (t.tenants || []);
const live = arr.filter(x => x.status === 'active' || x.status === 'future');
live.forEach(x => console.log(x.houseCode, x.room, x.name, x.phone, x.status));
console.log('Total:', live.length);
"
```

### Method 2 — Internal API (use when HTTP is needed)
```bash
curl -s http://localhost:8899/mc/internal/occupants \
  -H "X-MC-Token: 995a08a0189499f8dbf4d11012f274fde09df35a845ab82b1ad120749d0ae069"
```
Returns full raw active-tenants.json array. No password involved.

---

## Occupant Change Detection — Who Moved In / Who Left

This is Atlas's primary tool for keeping WA groups in sync.

### Step 1 — Check what changed since last session
```bash
curl -s http://localhost:8899/mc/internal/occupant-changes \
  -H "X-MC-Token: 995a08a0189499f8dbf4d11012f274fde09df35a845ab82b1ad120749d0ae069"
```
Returns:
```json
{
  "snapshotTs": "2026-04-01T13:40:36Z",   // when Atlas last acknowledged
  "hasChanges": true,
  "added": [...],       // new occupants (status active/future/bond_pending)
  "departed": [...],    // were live, now archived or removed
  "statusChanged": [...], // same person, status changed
  "currentTotal": 132
}
```

### Step 2 — After processing changes, acknowledge (update baseline)
```bash
curl -s -X POST http://localhost:8899/mc/internal/occupant-changes \
  -H "X-MC-Token: 995a08a0189499f8dbf4d11012f274fde09df35a845ab82b1ad120749d0ae069" \
  -H "Content-Type: application/json" \
  -d '{"acknowledge":true}'
```
Always acknowledge AFTER completing WA group adds/removes — not before.

### Workflow for WA group sync
1. Call `/mc/internal/occupant-changes` → get `added` + `departed`
2. For each `added`: find their WA group via `houseCode` in the table below → add them to the group using their `phone`/`waId`/`lid`
3. For each `departed`: remove them from their house WA group
4. Confirm with Diego before executing group changes (per PROTOCOLS.md)
5. After Diego confirms and changes are done → acknowledge

---

### Method 3 — Staff API (filtered/formatted view)
```bash
curl -s http://localhost:8899/mc/internal/occupants \
  -H "X-MC-Token: 995a08a0189499f8dbf4d11012f274fde09df35a845ab82b1ad120749d0ae069" | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const a=JSON.parse(d);
    const live=a.filter(x=>x.status==='active'||x.status==='future');
    live.forEach(t=>console.log(t.houseCode,t.room||'-',t.name,t.phone||t.whatsappId||''));
    console.log('---',live.length,'live occupants');
  })"
```

---

## Key Data Files

| File | Path | What it is |
|------|------|-----------|
| **Active tenants (LIVE SOURCE OF TRUTH)** | `/home/diegopalhano/projects/mission-control/data/active-tenants.json` | All occupants. `status`: `active`, `future`, `archived`, `bond_pending` |
| All tenants (full archive) | `/home/diegopalhano/projects/mission-control/data/tenants.json` | Full history including past tenants |
| House WA groups | `/home/diegopalhano/projects/mission-control/data/house-wa-groups.json` | Maps `houseCode` → WA `groupJid` + group name |
| House details | `/home/diegopalhano/projects/mission-control/data/house-details.json` | Address, capacity, room list per house |
| Occupant audit log | `/home/diegopalhano/projects/mission-control/data/occupant-audit.log` | Change history |
| Tenant movements | `/home/diegopalhano/projects/mission-control/data/tenant-movements.md` | Move-in/move-out log |

### Active-Tenants Key Fields
```
id, name, houseCode, phone, whatsappId, waId, lid,
status, moveInDate, moveOutDate, room, weeklyRent,
paymentId, nationality, email, passportNumber
```

### Status Meanings
- `active` — currently living there ✅
- `future` — confirmed, not yet moved in ✅
- `bond_pending` — paid bond, awaiting move-in confirmation
- `archived` — moved out / departed

---

## Internal API Token

MC internal API token (machine-to-machine, not a staff password):
```
995a08a0189499f8dbf4d11012f274fde09df35a845ab82b1ad120749d0ae069
```
Header: `X-MC-Token: <token>`

| Endpoint | Method | What it does |
|----------|--------|-------------|
| `/mc/internal/occupants` | GET | Full raw `active-tenants.json` |
| `/mc/internal/occupant-changes` | GET | Diff since last Atlas acknowledge |
| `/mc/internal/occupant-changes` | POST `{"acknowledge":true}` | Commit current state as new baseline |

---

## Backups

### Local rolling backups (new — runs every hour via cron)
- **Hourly:** `/home/diegopalhano/projects/mission-control/backups/hourly/` — keeps last 48
- **Daily:** `/home/diegopalhano/projects/mission-control/backups/daily/` — keeps last 30
- **Script:** `projects/mission-control/scripts/mc-backup.sh`
- **Log:** `projects/mission-control/logs/backup.log`

### Google Drive backup
- Runs daily at 17:00 via `projects/scripts/drive_backup.py`
- Uploads to folder: `Atlas Mission Control / Daily Logs`

### Atlas change-detection snapshot
- `/home/diegopalhano/projects/mission-control/data/mc-atlas-snapshot.json`
- Written when Atlas acknowledges changes — this is Atlas's "last known state" baseline

---

## WA House Groups — houseCode → groupJid

| houseCode | Friendly Name | groupJid |
|-----------|--------------|----------|
| CO1 | Entertainers Paradise | `120363300299462258@g.us` |
| EB1 | Eastside Sanctuary | `120363179855324665@g.us` |
| EB2 | EB Paradiso | `120363270182260588@g.us` |
| EB3 | East Brisbane Resort | `120363403136537362@g.us` |
| GS1 | Juliette Junction | `120363150005097135@g.us` |
| SB1 | South Brisbane Family | `120363332344223581@g.us` |
| SH1 | Springing Love | `120363137659018279@g.us` |
| SH2 | Spring Hill Dreams | `120363200964128944@g.us` |
| SH3 | Spring Paradise | `120363404905443488@g.us` |
| SP9 | Surfers Paradise Fam | `120363419101379205@g.us` |
| V5 | Fortitude Valley Family | `120363405402800661@g.us` |
| WE1 (upstairs) | West End Upstairs | `120363354973746741@g.us` |
| WE1 (downstairs) | West End Downstairs | `120363363555800297@g.us` |
| WL3 | Woolloongabba Family | `120363371022106088@g.us` |
| WL4 | Top of the Gabba | `120363421772343552@g.us` |
| BRIS1 | Superior Brisbane | `120363408294551957@g.us` |

Full mapping: `/home/diegopalhano/projects/mission-control/data/house-wa-groups.json`

### WA Group Member Management
- Match tenant `phone` / `waId` / `lid` from `active-tenants.json` to find the right WA ID
- **LID contacts:** 14+ digit IDs → use `@lid` suffix, not `@c.us`
- **French numbers** often come in as LIDs (e.g. `107941202002047@lid`)
- Add/remove via `wa-ops-bot` or the WhatsApp bridge

---

## Other Services

| Service | Port | Location |
|---------|------|----------|
| Mission Control | 8899 | `/home/diegopalhano/projects/mission-control/` |
| WhatsApp bridge | varies | `/home/diegopalhano/projects/whatsapp-bridge/` |
| Jess bot | 3847/3848 | `/home/diegopalhano/projects/jess-bot/` |
| wa-ops-bot | — | `/home/diegopalhano/projects/wa-ops-bot/` |
| Payments DB | — | `/home/diegopalhano/projects/sql-migration/payments.db` |

## Projects Root
`/home/diegopalhano/projects/` — all services live here

## Atlas Workspace
`~/.openclaw/workspace/` — Atlas's writable working directory

---

## SSH / Network
- This machine: Rocky Linux 10.1, Brisbane, GMT+10
- Wired ethernet only — no WiFi
- Cloudflare Tunnel: `mc.housemates.online` + `forms.housemates.online` → nginx:80 → node:8899
