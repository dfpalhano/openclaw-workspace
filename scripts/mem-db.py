#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import sqlite3
import sys
import uuid
from pathlib import Path

WORKSPACE = Path('/home/diegopalhano/.openclaw/workspace')
DB_PATH = WORKSPACE / 'data' / 'atlas-memory.db'
MEMORY_DIR = WORKSPACE / 'memory'

SCHEMA = '''
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  source_file TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  date TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  key_decisions TEXT,
  tasks_completed TEXT,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, tags, category);
'''


def utc_now():
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def rebuild_fts(conn):
    conn.execute('DELETE FROM memories_fts')
    conn.execute('INSERT INTO memories_fts(rowid, content, tags, category) SELECT rowid, content, coalesce(tags, \"\"), category FROM memories')
    conn.commit()


def add_memory(conn, category, content, tags=None, source_file=None, expires_at=None):
    now = utc_now()
    mem_id = str(uuid.uuid4())
    conn.execute(
        'INSERT INTO memories (id, category, content, tags, source_file, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (mem_id, category, content, tags, source_file, now, now, expires_at),
    )
    conn.commit()
    rebuild_fts(conn)
    return mem_id


def command_add(args):
    conn = connect()
    mem_id = add_memory(conn, args.category, args.content, args.tags, args.source, args.expires_at)
    print(json.dumps({'id': mem_id, 'status': 'ok'}, indent=2))


def command_search(args):
    conn = connect()
    sql = '''
    SELECT m.id, m.category, m.content, m.tags, m.source_file, m.created_at, m.updated_at
    FROM memories_fts f
    JOIN memories m ON m.rowid = f.rowid
    WHERE memories_fts MATCH ?
    '''
    params = [args.query]
    if args.category:
        sql += ' AND m.category = ?'
        params.append(args.category)
    sql += ' ORDER BY m.updated_at DESC LIMIT 10'
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    print(json.dumps(rows, indent=2))


def extract_bullets(section_text):
    out = []
    for line in section_text.splitlines():
        line = line.strip()
        if line.startswith('- '):
            out.append(line[2:].strip())
    return out


def command_summary(args):
    conn = connect()
    date = args.date
    daily_path = MEMORY_DIR / 'daily' / f'{date}.md'
    if not daily_path.exists():
        legacy = MEMORY_DIR / f'{date}.md'
        daily_path = legacy if legacy.exists() else daily_path
    if not daily_path.exists():
        raise SystemExit(f'Daily file not found for {date}: {daily_path}')

    text = daily_path.read_text()
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    bullets = [ln[2:].strip() for ln in lines if ln.startswith('- ')]
    summary = ' | '.join(bullets[:8]) if bullets else 'No bullet summary available.'
    key_decisions = [b for b in bullets if 'decision' in b.lower() or 'rule' in b.lower() or 'locked' in b.lower()][:10]
    tasks_completed = [b for b in bullets if any(k in b.lower() for k in ['done', 'completed', 'built', 'fixed', 'created', 'updated'])][:10]
    conn.execute(
        'REPLACE INTO daily_summaries (date, summary, key_decisions, tasks_completed, created_at) VALUES (?, ?, ?, ?, ?)',
        (date, summary, json.dumps(key_decisions), json.dumps(tasks_completed), utc_now()),
    )
    conn.commit()
    print(json.dumps({'date': date, 'summary': summary, 'key_decisions': key_decisions, 'tasks_completed': tasks_completed}, indent=2))


def command_export(args):
    conn = connect()
    payload = {
        'memories': [dict(r) for r in conn.execute('SELECT * FROM memories ORDER BY updated_at DESC').fetchall()],
        'daily_summaries': [dict(r) for r in conn.execute('SELECT * FROM daily_summaries ORDER BY date DESC').fetchall()],
    }
    print(json.dumps(payload, indent=2))


def seed_from_memory():
    conn = connect()
    existing = conn.execute('SELECT COUNT(*) AS c FROM memories').fetchone()['c']
    if existing:
        return
    memory_file = WORKSPACE / 'MEMORY.md'
    text = memory_file.read_text()
    seeds = [
        ('rule', 'AUTO_APPROVE_AFTER_MS = Infinity — NEVER re-enable Jess auto-send', 'jess,approval,rule', 'MEMORY.md'),
        ('rule', 'Email: no auto-send, ever', 'email,rule', 'MEMORY.md'),
        ('rule', 'Managers see ZERO financials', 'managers,finance,rule', 'MEMORY.md'),
        ('fact', 'Owner is in Brisbane, Australia. Timezone Australia/Brisbane (GMT+10).', 'owner,timezone,location', 'MEMORY.md'),
        ('fact', 'Platform is Rocky Linux 10.1.', 'platform,os', 'MEMORY.md'),
        ('project', 'Jess bot path: /home/diegopalhano/projects/jess-bot/jess-v2.js', 'jess,path', 'MEMORY.md'),
        ('project', 'Dashboard path: /home/diegopalhano/projects/mission-control/', 'dashboard,path', 'MEMORY.md'),
        ('project', 'WA Bridge path: /home/diegopalhano/projects/whatsapp-bridge/index.js', 'whatsapp,path', 'MEMORY.md'),
        ('rule', 'Atlas is an orchestrator and should delegate implementation unless DIN-prefixed.', 'orchestrator,delegation,rule', 'MEMORY.md'),
        ('person', 'Team roster: Smith=MC engineering, Thor=bot infrastructure, Ledger=finance, Orbit=onboarding, Jess=leasing, Warden=property ops, Flashbot=quick tasks.', 'team,agents,roster', 'MEMORY.md'),
    ]
    for category, content, tags, source in seeds:
        add_memory(conn, category, content, tags, source)


def build_parser():
    parser = argparse.ArgumentParser(description='Atlas SQLite memory CLI')
    sub = parser.add_subparsers(dest='cmd', required=True)

    p_add = sub.add_parser('add')
    p_add.add_argument('--category', required=True)
    p_add.add_argument('--content', required=True)
    p_add.add_argument('--tags')
    p_add.add_argument('--source')
    p_add.add_argument('--expires-at')
    p_add.set_defaults(func=command_add)

    p_search = sub.add_parser('search')
    p_search.add_argument('query')
    p_search.add_argument('--category')
    p_search.set_defaults(func=command_search)

    p_summary = sub.add_parser('summary')
    p_summary.add_argument('--date', required=True)
    p_summary.set_defaults(func=command_summary)

    p_export = sub.add_parser('export')
    p_export.set_defaults(func=command_export)

    return parser


def main():
    seed_from_memory()
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
