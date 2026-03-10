import sqlite3
import pandas as pd
import os
import datetime
import re
from datetime import datetime as dt

DB_PATH = '/home/diegopalhano/.openclaw/workspace/data/atlas-memory.db'
ODS_PATH = '/home/diegopalhano/Downloads/Payments.ods'

HOUSE_MAP = {
    '43 Redfern': 'WL4', 'WL4': 'WL4',
    '36 Rosa': 'SH2', 'SH2': 'SH2',
    '28 Taylor': 'WL3', 'WL3': 'WL3',
    '15 Cameron': 'SB1', 'SB1': 'SB1',
    '553 Vulture': 'EB1', 'EB1': 'EB1',
    '3 Hardgrave': 'WE1', 'WE1': 'WE1',
    '40 Rosa': 'SH1', 'SH1': 'SH1',
    '37 Marian': 'CO1', 'CO1': 'CO1',
    '111 Juliette': 'GS1', 'GS1': 'GS1',
    '606 Vulture': 'EB2', 'EB2': 'EB2',
    '69 Gresham': 'EB3', 'EB3': 'EB3',
    '147 Warry': 'V5', 'V5': 'V5',
    '41 Park': 'SH3', 'SH3': 'SH3',
    '79 Albert': 'BRIS1', 'BRIS1': 'BRIS1',
    '50 Peninsular': 'SP9', 'SP9': 'SP9'
}

def slugify(text):
    return re.sub(r'[^a-z0-9]', '_', text.lower())

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY,
          tenant_name TEXT NOT NULL,
          house_code TEXT NOT NULL,
          property_address TEXT NOT NULL,
          room_number TEXT,
          weekly_rent REAL,
          week_due TEXT NOT NULL,
          paid_date TEXT,
          status TEXT NOT NULL,
          notes TEXT,
          imported_at TEXT NOT NULL
        )
    ''')
    cursor.execute('DELETE FROM payments')
    conn.commit()
    return conn

def get_house_code(sheet_name):
    for key, code in HOUSE_MAP.items():
        if key in sheet_name:
            return code
    return None

def import_payments():
    conn = init_db()
    cursor = conn.cursor()
    
    if not os.path.exists(ODS_PATH):
        print(f"Error: {ODS_PATH} not found.")
        return

    print(f"Reading {ODS_PATH}...")
    xl = pd.ExcelFile(ODS_PATH, engine='odf')
    print(f"Sheets found: {xl.sheet_names}")
    
    total_imported = 0
    now_iso = dt.now().isoformat()
    summary = {}

    for sheet_name in xl.sheet_names:
        house_code = get_house_code(sheet_name)
        if not house_code:
            continue
        
        df = pd.read_excel(ODS_PATH, sheet_name=sheet_name, engine='odf', header=None)
        
        # FIND DATE HEADERS
        date_headers = {}
        for r_idx in [0, 1]:
            date_row = df.iloc[r_idx]
            for col_idx in range(len(date_row)):
                val = date_row[col_idx]
                if isinstance(val, (dt, datetime.date)) and not pd.isna(val):
                    date_headers[col_idx] = val.strftime('%Y-%m-%d')
                elif pd.notna(val):
                    try:
                        d = pd.to_datetime(val)
                        if not pd.isna(d) and d.year > 2000:
                            date_headers[col_idx] = d.strftime('%Y-%m-%d')
                    except:
                        pass
            if date_headers:
                break

        if not date_headers:
            continue

        house_count = 0
        for idx in range(1, len(df)):
            row = df.iloc[idx]
            tenant_name = str(row[0]).strip() if pd.notna(row[0]) else ""
            
            if not tenant_name or tenant_name in ['Potential','Room','EMPTY','4','5','6','nan','None',''] or \
               'Warry' in tenant_name or \
               re.match(r'^\d', tenant_name) or \
               (len(tenant_name) > 5 and re.search(r'\d+\s+\w+', tenant_name)) or \
               tenant_name == sheet_name:
                continue
            
            room = str(row[1]) if pd.notna(row[1]) else ""
            try:
                # Try Col C for rent
                weekly_rent = float(row[2]) if pd.notna(row[2]) else 0.0
            except:
                try:
                    # Try Col B
                    weekly_rent = float(row[1]) if pd.notna(row[1]) else 0.0
                except:
                    weekly_rent = 0.0

            for col_idx, week_due in date_headers.items():
                if col_idx >= len(row): continue
                cell_val = row[col_idx]
                
                paid_date = None
                status = 'missing'
                notes = None
                
                if isinstance(cell_val, (dt, datetime.date)) and not pd.isna(cell_val):
                    status = 'paid'
                    paid_date = cell_val.strftime('%Y-%m-%d')
                elif isinstance(cell_val, str):
                    cv_upper = str(cell_val).upper().strip()
                    if cv_upper in ['PAID', 'YES', 'OK']: status = 'paid'
                    elif cv_upper == 'EMPTY': status = 'empty'
                    elif cv_upper == 'LEFT': status = 'left'
                    elif cv_upper == 'BOND': status = 'bond'
                    elif cv_upper == 'MISSING': status = 'missing'
                    else: notes = cell_val
                elif pd.isna(cell_val):
                    status = 'missing'
                
                if status == 'missing' and week_due > dt.now().strftime('%Y-%m-%d'):
                    continue

                record_id = f"{house_code}_{slugify(tenant_name)}_{week_due}"[:80]
                
                cursor.execute('''
                    INSERT OR REPLACE INTO payments (
                        id, tenant_name, house_code, property_address, 
                        room_number, weekly_rent, week_due, paid_date, 
                        status, notes, imported_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    record_id, tenant_name, house_code, sheet_name,
                    room, weekly_rent, week_due, paid_date,
                    status, notes, now_iso
                ))
                total_imported += 1
                house_count += 1
        
        summary[house_code] = house_count

    conn.commit()
    conn.close()
    
    print("\nImport Summary:")
    for h, count in sorted(summary.items()):
        print(f"  {h}: {count} records")
    print(f"\nTotal imported: {total_imported} records")

if __name__ == '__main__':
    import_payments()
