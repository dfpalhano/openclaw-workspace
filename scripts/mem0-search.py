#!/usr/bin/env python3
import json
import sys
from pathlib import Path

WORKSPACE = Path('/home/diegopalhano/.openclaw/workspace')
DATA_DIR = WORKSPACE / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)

import site
site.addsitedir(str(WORKSPACE / '.venv-mem' / 'lib' / f'python{sys.version_info.major}.{sys.version_info.minor}' / 'site-packages'))

from mem0 import Memory  # type: ignore


def build_memory():
    config = {
        'vector_store': {
            'provider': 'qdrant',
            'config': {
                'collection_name': 'atlas-memory',
                'path': str(DATA_DIR / 'mem0-qdrant'),
            },
        },
                'history_db_path': str(DATA_DIR / 'mem0-history.db'),
    }
    return Memory.from_config(config)


def main() -> int:
    if len(sys.argv) < 2:
        print('Usage: mem0-search.py "query"', file=sys.stderr)
        return 1
    query = ' '.join(sys.argv[1:]).strip()
    memory = build_memory()
    result = memory.search(query, user_id='atlas', limit=5)
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
