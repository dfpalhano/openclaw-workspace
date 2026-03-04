# RECOVERY.md — Atlas Context Recovery Guide

## What is compaction?
When a conversation gets too long, Atlas (me) hits the context window limit.
OpenClaw automatically compacts the history into a summary and continues.
**You don't lose anything** — but Atlas may feel slightly "reset" on nuance.

---

## Signs it's happening
- Atlas responses feel slower or more generic
- Atlas asks something it already knows
- You see a `[summary block]` appear in the chat

---

## What to do (fastest recovery)

### Option 1 — Just keep going (most of the time)
OpenClaw compacts automatically. Atlas re-reads `MEMORY.md` + today's memory file.
Just keep chatting normally. Usually seamless.

### Option 2 — Atlas seems confused or lost
Type one of these:
```
context recovery
```
or
```
reload your memory
```
Atlas will read `MEMORY.md` + `memory/2026-03-05.md` and catch up instantly.

### Option 3 — Atlas is completely offline / OpenClaw crashed
1. Check server: open `mc.inspectionsxraytesting.com.au` — if MC loads, server is alive
2. SSH in via Termius (`100.92.117.73`, port 22)
3. Run: `openclaw status`
4. If stopped: `openclaw gateway start`
5. Start new chat — Atlas will boot fresh and self-recover from memory files

### Option 4 — Credits / rate limit exhausted
Atlas will tell you which model failed. Options:
- Switch model: type `/model gemini-flash` (free tier, fast)
- Wait ~60 min for rate limit reset
- Recharge credits at openclaw.ai if needed

---

## What Atlas always recovers from memory
On every new session Atlas reads:
- `MEMORY.md` — core identity, hard rules, key paths, lessons
- `memory/YYYY-MM-DD.md` — today + yesterday's context
- `SOUL.md` — personality and model routing
- `USER.md` — who you are

So even after a full restart, Atlas comes back at ~90% context in under 30 seconds.

---

## To speed up future recovery
After any major session, tell Atlas:
```
save memory
```
Atlas will flush key decisions to the daily memory file before compaction hits.

---

## Emergency contacts
- Monitor bot: `@jessapprovals_bot` → `/s` for system status
- MC dashboard: `mc.inspectionsxraytesting.com.au`
- SSH: `100.92.117.73` (Tailscale, key auth)
- NoMachine: `100.92.117.73:4000`
