#!/bin/bash
# Morning Brief — runs at 7:00am daily
# Collects outputs from all agents and sends synthesis to Telegram via Atlas

WORKSPACE="/home/diegopalhano/.openclaw/workspace"
BRIEF_FILE="/tmp/morning-brief-$(date +%Y%m%d).md"
TG_TOKEN="8758803508:AAGVnQv_a1Nn2aL5BWV5qURULSQzhMKXBr8"
DIEGO_ID="1267601160"

python3 << PYEOF
import json, subprocess, urllib.request, datetime, html
from pathlib import Path

TODAY = datetime.date.today().strftime('%A %-d %B %Y')
DAYS_TO_DEPARTURE = (datetime.date(2026, 3, 21) - datetime.date.today()).days

sections = []

# ── Warden: Inspection alerts ──────────────────────────────────────────────
try:
    state = json.loads(Path('/home/diegopalhano/projects/scripts/inspection_alert_state.json').read_text())
    last_run = state.get('last_run','unknown')
    sections.append(f"🔑 <b>Warden</b> — last scan: {last_run[:10]}\nInspection monitor: active ✅")
except:
    sections.append("🔑 <b>Warden</b> — ⚠️ state file missing, inspection monitor may be down")

# ── Ledger: Rent alerts ────────────────────────────────────────────────────
try:
    alerts = json.loads(Path('/home/diegopalhano/projects/mission-control/data/rent-alerts.json').read_text())
    alert_arr = alerts if isinstance(alerts, list) else []
    critical = [a for a in alert_arr if a.get('severity') in ['critical','high']]
    sections.append(f"💰 <b>Ledger</b> — {len(critical)} high/critical alerts, {len(alert_arr)} total\n" +
        ('\n'.join(f"  • {a.get('name','?')} ({a.get('houseCode','?')}): {a.get('message','')}" for a in critical[:3]) or '  All clear'))
except:
    sections.append("💰 <b>Ledger</b> — ⚠️ rent-alerts.json not found")

# ── Jess: Pipeline ─────────────────────────────────────────────────────────
try:
    enqs = json.loads(Path('/home/diegopalhano/projects/mission-control/data/jess-enquirers.json').read_text())
    enq_arr = enqs if isinstance(enqs, list) else []
    pending_invite = [e for e in enq_arr if e.get('status') == 'viewing_pending']
    invited = [e for e in enq_arr if e.get('status') == 'invited']
    by_house = {}
    for e in pending_invite:
        h = e.get('property_enquired','?')
        by_house[h] = by_house.get(h, 0) + 1
    house_str = ', '.join(f"{h}:{n}" for h,n in sorted(by_house.items()))
    sections.append(f"🏠 <b>Jess</b> — {len(pending_invite)} awaiting invite, {len(invited)} invited\n  By house: {house_str or 'none'}")
except:
    sections.append("🏠 <b>Jess</b> — ⚠️ enquirers data not found")

# ── Orbit: Onboarding ──────────────────────────────────────────────────────
try:
    orbit_state = json.loads(Path('/home/diegopalhano/projects/orbit/orbit-state.json').read_text())
    active = {k:v for k,v in orbit_state.items() if isinstance(v,dict) and v.get('step') not in ['done','complete','step0']}
    blocked = [k for k,v in active.items() if v.get('paymentOk') == False]
    sections.append(f"🛰️ <b>Orbit</b> — {len(active)} active onboardings, {len(blocked)} payment pending\n" +
        (', '.join(blocked[:3]) if blocked else '  All clear'))
except:
    sections.append("🛰️ <b>Orbit</b> — ⚠️ orbit-state.json not found")

# ── Compose brief ──────────────────────────────────────────────────────────
brief = f"""🗺️ <b>Atlas Morning Brief</b>
{TODAY} · {DAYS_TO_DEPARTURE} days to departure

{chr(10).join(sections)}

<i>Next brief: tonight 6pm</i>"""

# Send to Telegram
payload = json.dumps({'chat_id': '1267601160', 'text': brief, 'parse_mode': 'HTML'}).encode()
req = urllib.request.Request(
    f'https://api.telegram.org/bot8758803508:AAGVnQv_a1Nn2aL5BWV5qURULSQzhMKXBr8/sendMessage',
    data=payload, headers={'Content-Type': 'application/json'})
urllib.request.urlopen(req, timeout=10)
print("Morning brief sent.")
PYEOF
