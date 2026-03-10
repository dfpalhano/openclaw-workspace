#!/usr/bin/env python3
import sys
import time
from pathlib import Path

WORKSPACE = Path('/home/diegopalhano/.openclaw/workspace')
SCRIPTS_DIR = WORKSPACE / 'scripts'
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from mem_semantic import WATCH_POLL_SECONDS, file_state, index_file


def main() -> int:
    print(f'Watching {WORKSPACE} for markdown changes every {WATCH_POLL_SECONDS}s...')
    previous = file_state()
    try:
        while True:
            time.sleep(WATCH_POLL_SECONDS)
            current = file_state()

            changed = [path for path, mtime in current.items() if previous.get(path) != mtime]
            deleted = sorted(set(previous) - set(current))

            for path_str in changed:
                path = Path(path_str)
                try:
                    count = index_file(path)
                    print(f'Re-indexed {path.relative_to(WORKSPACE)} ({count} chunks)')
                except Exception as exc:
                    print(f'Error re-indexing {path}: {exc}', file=sys.stderr)

            if deleted:
                # Deleted file cleanup is handled on full re-index for now.
                for path_str in deleted:
                    print(f'Deleted markdown file detected: {Path(path_str).relative_to(WORKSPACE)}')

            previous = current
    except KeyboardInterrupt:
        print('Stopped.')
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
