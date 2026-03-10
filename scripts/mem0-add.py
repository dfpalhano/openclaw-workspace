#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

WORKSPACE = Path('/home/diegopalhano/.openclaw/workspace')
DATA_DIR = WORKSPACE / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(WORKSPACE / '.venv-mem' / 'lib'))

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


def get_text() -> str:
    if len(sys.argv) > 1:
        return ' '.join(sys.argv[1:]).strip()
    if not sys.stdin.isatty():
        return sys.stdin.read().strip()
    return ''


def main() -> int:
    text = get_text()
    if not text:
        print('Usage: mem0-add.py "memory text"  OR echo "memory text" | mem0-add.py', file=sys.stderr)
        return 1
    memory = build_memory()
    result = memory.add(text, user_id='atlas')
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
