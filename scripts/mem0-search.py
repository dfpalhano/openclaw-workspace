#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path

WORKSPACE = Path('/home/diegopalhano/.openclaw/workspace')
SCRIPT = WORKSPACE / 'scripts' / 'mem-search.py'


def main() -> int:
    if len(sys.argv) < 2:
        print('Usage: mem0-search.py "query"', file=sys.stderr)
        return 1
    cmd = ['python3', str(SCRIPT), *sys.argv[1:]]
    completed = subprocess.run(cmd)
    return completed.returncode


if __name__ == '__main__':
    raise SystemExit(main())
