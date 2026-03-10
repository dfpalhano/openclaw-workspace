import sqlite3
import argparse
import sys

DB_PATH = '/home/diegopalhano/.openclaw/workspace/data/atlas-memory.db'

def query_payments():
    parser = argparse.ArgumentParser(description='Query payment database')
    parser.add_argument('--tenant', help='Filter by tenant name')
    parser.add_argument('--house', help='Filter by house code')
    parser.add_argument('--missing', action='store_true', help='Show missing payments')
    parser.add_argument('--summary', action='store_true', help='Show summary per house')
    
    args = parser.parse_args()
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    if args.summary:
        print(f"{'House':<10} | {'Collected':<12} | {'Missing #':<10}")
        print("-" * 40)
        cursor.execute('''
            SELECT house_code, 
                   SUM(CASE WHEN status='paid' THEN weekly_rent ELSE 0 END) as collected,
                   COUNT(CASE WHEN status='missing' THEN 1 END) as missing_count
            FROM payments
            GROUP BY house_code
        ''')
        for row in cursor.fetchall():
            print(f"{row['house_code']:<10} | ${row['collected']:>10.2f} | {row['missing_count']:<10}")
            
    elif args.missing:
        cursor.execute('''
            SELECT house_code, tenant_name, week_due, weekly_rent
            FROM payments
            WHERE status = 'missing'
            ORDER BY house_code, week_due DESC
        ''')
        rows = cursor.fetchall()
        if not rows:
            print("No missing payments found.")
        else:
            print(f"{'House':<10} | {'Tenant':<20} | {'Week Due':<12} | {'Rent':<8}")
            print("-" * 60)
            for row in rows:
                print(f"{row['house_code']:<10} | {row['tenant_name']:<20} | {row['week_due']:<12} | ${row['weekly_rent'] or 0:.2f}")

    elif args.tenant:
        cursor.execute('''
            SELECT week_due, status, paid_date, weekly_rent, house_code
            FROM payments
            WHERE tenant_name LIKE ?
            ORDER BY week_due DESC
        ''', (f"%{args.tenant}%",))
        rows = cursor.fetchall()
        if not rows:
            print(f"No records found for tenant: {args.tenant}")
        else:
            print(f"Payments for {args.tenant}:")
            print(f"{'Week Due':<12} | {'House':<8} | {'Status':<10} | {'Paid Date':<12} | {'Rent':<8}")
            print("-" * 60)
            for row in rows:
                print(f"{row['week_due']:<12} | {row['house_code']:<8} | {row['status']:<10} | {str(row['paid_date']):<12} | ${row['weekly_rent'] or 0:.2f}")

    elif args.house:
        cursor.execute('''
            SELECT tenant_name, week_due, status, weekly_rent
            FROM payments
            WHERE house_code = ?
            ORDER BY week_due DESC, tenant_name
        ''', (args.house,))
        rows = cursor.fetchall()
        if not rows:
            print(f"No records found for house: {args.house}")
        else:
            print(f"Payments for House {args.house}:")
            print(f"{'Tenant':<20} | {'Week Due':<12} | {'Status':<10} | {'Rent':<8}")
            print("-" * 60)
            for row in rows:
                print(f"{row['tenant_name']:<20} | {row['week_due']:<12} | {row['status']:<10} | ${row['weekly_rent'] or 0:.2f}")
    
    else:
        parser.print_help()

    conn.close()

if __name__ == '__main__':
    query_payments()
