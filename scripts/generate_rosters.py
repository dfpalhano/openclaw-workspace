#!/usr/bin/env python3
"""
generate_rosters.py
Generate per-house occupancy roster PDFs for all 15 Mission Control houses.
"""

import json
import os
import re
from collections import defaultdict
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    Image as RLImage, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import KeepTogether

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE = "/home/diegopalhano/projects/mission-control"
DATA = f"{BASE}/data"
JESS_DATA = "/home/diegopalhano/projects/jess-bot/data"
OUT_DIR = "/home/diegopalhano/.openclaw/workspace/rosters"

os.makedirs(OUT_DIR, exist_ok=True)

# ─── Load data ────────────────────────────────────────────────────────────────
with open(f"{DATA}/active-tenants.json") as f:
    _td = json.load(f)
ALL_TENANTS = _td if isinstance(_td, list) else _td.get("tenants", [])
ACTIVE = [t for t in ALL_TENANTS if t.get("status") == "active"]

with open(f"{DATA}/house-details.json") as f:
    _hd = json.load(f)
HOUSE_DETAILS = _hd.get("houses", _hd) if isinstance(_hd, dict) else {}

with open(f"{DATA}/house-wa-groups.json") as f:
    _wg = json.load(f)
WA_GROUPS = {h["houseCode"]: h for h in _wg}

with open(f"{JESS_DATA}/jess-rooms.json") as f:
    _jr = json.load(f)
JESS_ROOMS = {h["houseCode"]: h for h in _jr}

# ─── Colours / styles ─────────────────────────────────────────────────────────
BRAND_DARK   = colors.HexColor("#1a1a2e")
BRAND_ACCENT = colors.HexColor("#e94560")
BRAND_MID    = colors.HexColor("#16213e")
BADGE_BG     = colors.HexColor("#0f3460")
VACANT_BG    = colors.HexColor("#fff3cd")
VACANT_FG    = colors.HexColor("#856404")
NOROOM_BG    = colors.HexColor("#f8d7da")
ROW_ALT      = colors.HexColor("#f4f6fb")
HEADER_FG    = colors.white

styles = getSampleStyleSheet()

def make_style(name, **kw):
    s = ParagraphStyle(name, **kw)
    return s

STYLE_HOUSE   = make_style("HouseTitle",  fontSize=22, fontName="Helvetica-Bold",
                            textColor=HEADER_FG, spaceAfter=2)
STYLE_ADDR    = make_style("HouseAddr",   fontSize=11, fontName="Helvetica",
                            textColor=colors.HexColor("#c8d0e7"), spaceAfter=4)
STYLE_ROOMNUM = make_style("RoomNum",     fontSize=12, fontName="Helvetica-Bold",
                            textColor=BRAND_DARK)
STYLE_ROOMTYPE= make_style("RoomType",    fontSize=9,  fontName="Helvetica",
                            textColor=colors.HexColor("#5a6a8a"))
STYLE_NAME    = make_style("OccName",     fontSize=11, fontName="Helvetica-Bold",
                            textColor=BRAND_DARK)
STYLE_VACANT  = make_style("Vacant",      fontSize=11, fontName="Helvetica-Bold",
                            textColor=VACANT_FG)
STYLE_NOROOM  = make_style("NoRoom",      fontSize=11, fontName="Helvetica-Bold",
                            textColor=colors.HexColor("#721c24"))
STYLE_SECTION = make_style("Section",     fontSize=10, fontName="Helvetica-Bold",
                            textColor=BRAND_ACCENT, spaceBefore=8, spaceAfter=4)
STYLE_FOOTER  = make_style("Footer",      fontSize=8,  fontName="Helvetica",
                            textColor=colors.grey, alignment=TA_CENTER)


# ─── Helpers ──────────────────────────────────────────────────────────────────
def find_selfie(tenant: dict) -> str | None:
    """Return the first existing selfie path for a tenant, or None."""
    phone = tenant.get("phone", "").lstrip("+")
    # path 1: tenant-photos/{phone}/profile.jpg
    p1 = f"{DATA}/tenant-photos/{phone}/profile.jpg"
    if os.path.exists(p1):
        return p1
    # path 2: selfieFilePath field on tenant
    sfp = tenant.get("selfieFilePath", "")
    if sfp:
        p2 = f"{BASE}/{sfp}"
        if os.path.exists(p2):
            return p2
    return None


def room_sort_key(room_str: str) -> int:
    """Parse 'R3' → 3, 'R10' → 10 for numeric sorting."""
    m = re.search(r"(\d+)", str(room_str))
    return int(m.group(1)) if m else 9999


def normalise_room(room_raw) -> str:
    """Normalise a room field to 'R1', 'R2' etc."""
    s = str(room_raw).strip()
    # already 'R1' style
    if re.match(r"^R\d+$", s, re.IGNORECASE):
        return s.upper()
    # just a digit
    if re.match(r"^\d+$", s):
        return f"R{s}"
    return s


def get_address(house_code: str) -> str:
    wa = WA_GROUPS.get(house_code, {})
    return wa.get("address") or HOUSE_DETAILS.get(house_code, {}).get("address", "")


def get_friendly_name(house_code: str) -> str:
    wa = WA_GROUPS.get(house_code, {})
    return wa.get("friendlyName") or wa.get("displayName") or house_code


def get_room_type(house_code: str, room_str: str) -> str | None:
    """Look up room type from house-details rooms array."""
    rooms = HOUSE_DETAILS.get(house_code, {}).get("rooms", [])
    for r in rooms:
        rn = normalise_room(r.get("room", ""))
        if rn == room_str:
            return r.get("type")
    return None


def get_defined_rooms(house_code: str) -> list[str] | None:
    """
    Return the full ordered list of room codes from house-details.json
    if the rooms array is rich enough (more than 1 entry), else None.
    """
    rooms = HOUSE_DETAILS.get(house_code, {}).get("rooms", [])
    # Ignore stub lists (e.g. EB1/EB2 have only 1 entry)
    if len(rooms) <= 1:
        return None
    norm = [normalise_room(r.get("room", "")) for r in rooms]
    # Must look like proper room codes
    valid = [r for r in norm if re.match(r"^R\d+$", r)]
    return sorted(set(valid), key=room_sort_key) if valid else None


def get_total_rooms(house_code: str) -> int:
    """Best estimate of total rooms from jess-rooms bedrooms count."""
    j = JESS_ROOMS.get(house_code, {})
    return j.get("bedrooms", 0)


# ─── Build tenant index ───────────────────────────────────────────────────────
by_house: dict[str, list] = defaultdict(list)
for t in ACTIVE:
    by_house[t.get("houseCode", "")].append(t)


# ─── PDF builder ─────────────────────────────────────────────────────────────
def build_roster_pdf(house_code: str, out_path: str) -> dict:
    """Build one PDF. Returns summary dict."""
    tenants = by_house.get(house_code, [])
    address = get_address(house_code)
    friendly = get_friendly_name(house_code)

    # Map room → list of tenants
    room_to_tenants: dict[str, list] = defaultdict(list)
    for t in tenants:
        r = normalise_room(t.get("room", ""))
        room_to_tenants[r].append(t)

    # Determine full room list
    defined_rooms = get_defined_rooms(house_code)
    total_beds = get_total_rooms(house_code)

    if defined_rooms:
        all_rooms = defined_rooms
    elif total_beds > 0:
        all_rooms = [f"R{i}" for i in range(1, total_beds + 1)]
    else:
        # fallback: just use rooms with occupants
        all_rooms = sorted(room_to_tenants.keys(), key=room_sort_key)

    # Identify "no room assigned" tenants
    no_room_tenants = room_to_tenants.get("", []) + room_to_tenants.get("?", [])
    assigned_rooms = set(all_rooms)
    overflow_tenants = []
    for room, ts in room_to_tenants.items():
        if room not in assigned_rooms and room not in ("", "?"):
            overflow_tenants.extend(ts)

    # ── Start building PDF flowable elements ──
    doc = SimpleDocTemplate(
        out_path,
        pagesize=A4,
        leftMargin=15*mm, rightMargin=15*mm,
        topMargin=12*mm, bottomMargin=15*mm,
    )

    W = A4[0] - 30*mm  # usable width

    story = []

    # ── Header banner ──
    header_data = [[
        Paragraph(f"{house_code} — {friendly}", STYLE_HOUSE),
        Paragraph(address, STYLE_ADDR),
    ]]
    header_table = Table([[
        Paragraph(f"<b>{house_code}</b>  {friendly}", STYLE_HOUSE),
    ]], colWidths=[W])
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), BRAND_DARK),
        ("ROWPADDING", (0,0), (-1,-1), 10),
        ("TOPPADDING", (0,0), (-1,-1), 12),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ("LEFTPADDING", (0,0), (-1,-1), 14),
        ("RIGHTPADDING", (0,0), (-1,-1), 14),
        ("ROUNDEDCORNERS", [6]),
    ]))
    story.append(header_table)

    addr_table = Table([[Paragraph(address, STYLE_ADDR)]], colWidths=[W])
    addr_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), BRAND_MID),
        ("LEFTPADDING", (0,0), (-1,-1), 14),
        ("RIGHTPADDING", (0,0), (-1,-1), 14),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    story.append(addr_table)
    story.append(Spacer(1, 6*mm))

    # ── Room rows ──
    vacant_rooms = []
    gaps = []

    PHOTO_SIZE = 70  # pts ≈ 25mm

    # Column widths: photo | room info | spacer
    COL_PHOTO = PHOTO_SIZE + 6
    COL_INFO  = W - COL_PHOTO - 4

    def room_row(room_code: str, tenant_list: list, row_idx: int):
        """Return a list of flowables for one room block."""
        room_type = get_room_type(house_code, room_code)
        bg = ROW_ALT if row_idx % 2 == 0 else colors.white

        if not tenant_list:
            # Vacant
            label = f"{room_code} — 🏚 Vacant / To investigate"
            if room_type:
                label = f"{room_code} ({room_type}) — 🏚 Vacant / To investigate"
            cell = Paragraph(label, STYLE_VACANT)
            row = Table([[cell]], colWidths=[W])
            row.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,-1), VACANT_BG),
                ("LEFTPADDING", (0,0), (-1,-1), 14),
                ("TOPPADDING", (0,0), (-1,-1), 10),
                ("BOTTOMPADDING", (0,0), (-1,-1), 10),
                ("RIGHTPADDING", (0,0), (-1,-1), 14),
            ]))
            return [row, Spacer(1, 2)]

        # One row per occupant in this room (usually 1, sometimes 2)
        rows_out = []
        for i, tenant in enumerate(tenant_list):
            name = tenant.get("name", "Unknown")
            selfie = find_selfie(tenant)

            # Build badge text
            badge_parts = [f"<b>{room_code}</b>"]
            if room_type:
                badge_parts.append(f"<font color='#5a6a8a' size='9'>{room_type}</font>")
            badge_para = Paragraph("  ".join(badge_parts), STYLE_ROOMNUM)
            name_para  = Paragraph(name, STYLE_NAME)

            info_col = [badge_para, Spacer(1, 3), name_para]

            if selfie:
                try:
                    img = RLImage(selfie, width=PHOTO_SIZE, height=PHOTO_SIZE)
                    img.hAlign = "CENTER"
                    data = [[img, info_col]]
                    col_w = [COL_PHOTO, COL_INFO]
                except Exception:
                    data = [[info_col]]
                    col_w = [W]
            else:
                data = [[info_col]]
                col_w = [W]

            cell_table = Table(data, colWidths=col_w)
            cell_table.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,-1), bg if i == 0 else colors.white),
                ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
                ("LEFTPADDING", (0,0), (0,-1), 10),
                ("TOPPADDING", (0,0), (-1,-1), 8),
                ("BOTTOMPADDING", (0,0), (-1,-1), 8),
                ("RIGHTPADDING", (0,0), (-1,-1), 10),
                ("LEFTPADDING", (0,1), (1,-1), 10),
            ]))
            rows_out.append(cell_table)
            rows_out.append(Spacer(1, 2))

        return rows_out

    for idx, room in enumerate(all_rooms):
        ts = room_to_tenants.get(room, [])
        if not ts:
            vacant_rooms.append(room)
        elems = room_row(room, ts, idx)
        story.extend(elems)

    gaps = vacant_rooms

    # ── Overflow: no room assigned ──
    no_room_all = no_room_tenants + overflow_tenants
    if no_room_all:
        story.append(Spacer(1, 5*mm))
        story.append(HRFlowable(width=W, thickness=1, color=BRAND_ACCENT))
        story.append(Paragraph("⚠ No room assigned", STYLE_SECTION))
        for tenant in no_room_all:
            name = tenant.get("name", "Unknown")
            room_raw = tenant.get("room", "?")
            selfie = find_selfie(tenant)
            note = f"<b>{name}</b>  <font color='#721c24' size='9'>(room field: {room_raw})</font>"
            name_para = Paragraph(note, STYLE_NOROOM)
            if selfie:
                try:
                    img = RLImage(selfie, width=PHOTO_SIZE, height=PHOTO_SIZE)
                    data = [[img, [name_para]]]
                    col_w = [COL_PHOTO, COL_INFO]
                except Exception:
                    data = [[[name_para]]]
                    col_w = [W]
            else:
                data = [[[name_para]]]
                col_w = [W]
            ct = Table(data, colWidths=col_w)
            ct.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,-1), NOROOM_BG),
                ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
                ("LEFTPADDING", (0,0), (-1,-1), 10),
                ("TOPPADDING", (0,0), (-1,-1), 8),
                ("BOTTOMPADDING", (0,0), (-1,-1), 8),
                ("RIGHTPADDING", (0,0), (-1,-1), 10),
            ]))
            story.append(ct)
            story.append(Spacer(1, 2))

    # ── Footer ──
    story.append(Spacer(1, 8*mm))
    story.append(HRFlowable(width=W, thickness=0.5, color=colors.lightgrey))
    story.append(Spacer(1, 2*mm))
    story.append(Paragraph(
        f"Meridian Group — {house_code} Occupancy Roster  |  Generated 2026-03-17",
        STYLE_FOOTER
    ))

    doc.build(story)

    return {
        "house": house_code,
        "tenants": len(tenants),
        "rooms_total": len(all_rooms),
        "vacant": vacant_rooms,
        "no_room_assigned": [t.get("name") for t in no_room_all],
    }


# ─── Main ─────────────────────────────────────────────────────────────────────
HOUSES = ["SH1", "SH2", "SH3", "CO1", "EB1", "EB2", "EB3",
          "GS1", "SB1", "SP9", "V5", "WE1", "WL3", "WL4", "BRIS1"]

summaries = []

for house_code in HOUSES:
    out_path = f"{OUT_DIR}/roster_{house_code}.pdf"
    print(f"  Generating {house_code}...", end="", flush=True)
    try:
        result = build_roster_pdf(house_code, out_path)
        summaries.append(result)
        v = len(result["vacant"])
        nr = len(result["no_room_assigned"])
        print(f" ✓  ({result['tenants']} tenants, {v} vacant, {nr} no-room)")
    except Exception as e:
        print(f" ✗  ERROR: {e}")
        import traceback; traceback.print_exc()
        summaries.append({"house": house_code, "error": str(e)})

# ─── Summary file ─────────────────────────────────────────────────────────────
with open(f"{OUT_DIR}/summary.txt", "w") as sf:
    sf.write("Mission Control — Occupancy Roster Summary\n")
    sf.write("Generated: 2026-03-17\n")
    sf.write("=" * 60 + "\n\n")
    for s in summaries:
        code = s["house"]
        if "error" in s:
            sf.write(f"{code}: ERROR — {s['error']}\n")
            continue
        sf.write(f"{code}  |  {s['tenants']} active tenants  |  {s['rooms_total']} rooms defined\n")
        if s["vacant"]:
            sf.write(f"  Vacant rooms: {', '.join(s['vacant'])}\n")
        if s["no_room_assigned"]:
            sf.write(f"  No room assigned: {', '.join(s['no_room_assigned'])}\n")
        sf.write("\n")

print(f"\nDone! {len([s for s in summaries if 'error' not in s])} PDFs written to {OUT_DIR}")
print(f"Summary saved to {OUT_DIR}/summary.txt")
