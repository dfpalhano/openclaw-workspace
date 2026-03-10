#!/usr/bin/env python3
import json
import math
import os
import sqlite3
import sys
from pathlib import Path

WORKSPACE = Path('/home/diegopalhano/.openclaw/workspace')
SCRIPTS_DIR = WORKSPACE / 'scripts'
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from mem_semantic import DEFAULT_LIMIT, search_chunks


def main() -> int:
    if len(sys.argv) < 2:
        print('Usage: python3 mem-search.py "query" [limit]', file=sys.stderr)
        return 1

    query = ' '.join(sys.argv[1:]).strip()
    limit = DEFAULT_LIMIT
    if len(sys.argv) > 2:
        try:
            limit = int(sys.argv[-1])
        except ValueError:
            limit = DEFAULT_LIMIT

    try:
        results = search_chunks(query=query, limit=limit)
    except Exception as exc:
        print(f'Error: {exc}', file=sys.stderr)
        return 2

    if not results:
        print('No semantic matches found.')
        return 0

    for idx, row in enumerate(results, start=1):
        score = row['score']
        file_path = row['file_path']
        line_start = row.get('line_start')
        line_end = row.get('line_end')
        snippet = row['chunk_text'].strip().replace('\r\n', '\n')
        line_info = ''
        if line_start and line_end:
            line_info = f':{line_start}-{line_end}'
        elif line_start:
            line_info = f':{line_start}'
        print(f'[{idx}] score={score:.4f} {file_path}{line_info}')
        print(snippet)
        print('-' * 80)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
