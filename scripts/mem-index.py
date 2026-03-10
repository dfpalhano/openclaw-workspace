#!/usr/bin/env python3
import sys
from pathlib import Path

WORKSPACE = Path('/home/diegopalhano/.openclaw/workspace')
SCRIPTS_DIR = WORKSPACE / 'scripts'
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from mem_semantic import index_all_files


def main() -> int:
    try:
        total_files, total_chunks = index_all_files()
    except Exception as exc:
        print(f'Error: {exc}', file=sys.stderr)
        return 2
    print(f'Indexed {total_files} markdown files into semantic memory.')
    print(f'Chunks stored: {total_chunks}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
