#!/bin/bash
set -euo pipefail

WORKSPACE="/home/diegopalhano/.openclaw/workspace"
MEMORY_DIR="$WORKSPACE/memory"
RG_BIN="/home/diegopalhano/.npm-global/lib/node_modules/@openai/codex/bin/rg"
QUERY="${*:-}"

if [[ -z "$QUERY" ]]; then
  echo "Usage: $(basename "$0") \"query keywords\"" >&2
  exit 1
fi

cd "$WORKSPACE"
TMP_FILES="$(mktemp)"
trap 'rm -f "$TMP_FILES"' EXIT

{
  find "$MEMORY_DIR/daily" -type f -name '*.md' -printf '%T@\t%p\n' 2>/dev/null | sort -nr
  find "$MEMORY_DIR" -type f -name '*.md' ! -path "$MEMORY_DIR/daily/*" -printf '%T@\t%p\n' 2>/dev/null | sort -nr
  find "$WORKSPACE" -maxdepth 1 -type f -name '*.md' -printf '%T@\t%p\n' 2>/dev/null | sort -nr
} | awk -F '\t' '!seen[$2]++ { print $2 }' > "$TMP_FILES"

mapfile -t files < "$TMP_FILES"
"$RG_BIN" --with-filename --line-number --context 2 --fixed-strings "$QUERY" "${files[@]}"
