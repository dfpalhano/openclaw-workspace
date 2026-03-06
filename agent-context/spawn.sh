#!/bin/bash
# spawn.sh — Distil context → build brief → spawn sub-agent → log result
# Usage: ./spawn.sh "task description" [--model sonnet] [--files memory/foo.md] [--no-distill]
#
# Examples:
#   ./spawn.sh "fix the payment parser future-date bug"
#   ./spawn.sh "analyse rent-alerts.json and summarise" --model gemini-flash --files memory/2026-03-06.md
#   ./spawn.sh "refactor jess-v2.js sendMessage function" --model codex --no-distill

set -e

WORKSPACE="$HOME/.openclaw/workspace"
SCRIPT_DIR="$WORKSPACE/agent-context"
BRIEF_FILE="/tmp/agent-brief-$(date +%s).md"
LOG="$SCRIPT_DIR/spawn-log.jsonl"

TASK="$1"
shift

if [ -z "$TASK" ]; then
  echo "Usage: spawn.sh \"task description\" [--model MODEL] [--files file1 file2] [--no-distill]"
  exit 1
fi

MODEL="anthropic/claude-sonnet-4-6"
FILES=()
NO_DISTILL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --no-distill) NO_DISTILL="--no-distill"; shift ;;
    --files) shift; while [[ $# -gt 0 && "$1" != --* ]]; do FILES+=("$1"); shift; done ;;
    *) shift ;;
  esac
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Spawning sub-agent"
echo "   Task:  $TASK"
echo "   Model: $MODEL"
echo "   Files: ${FILES[*]:-none}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Distil context
FILE_ARGS=""
for f in "${FILES[@]}"; do FILE_ARGS="$FILE_ARGS $f"; done

python3 "$SCRIPT_DIR/distill.py" "$TASK" \
  --model "$MODEL" \
  --out "$BRIEF_FILE" \
  $NO_DISTILL \
  ${FILES:+--files} ${FILES:+"${FILES[@]}"}

echo ""
echo "📋 Brief:"
cat "$BRIEF_FILE"
echo ""

# Step 2: Log spawn start
START_TS=$(date -Iseconds)
echo "{\"event\":\"spawn_start\",\"ts\":\"$START_TS\",\"task\":\"$(echo $TASK | head -c 120)\",\"model\":\"$MODEL\",\"brief\":\"$BRIEF_FILE\"}" >> "$LOG"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Brief ready at: $BRIEF_FILE"
echo "   Pass to sessions_spawn as task attachment, or:"
echo "   openclaw session spawn --task \"\$(cat $BRIEF_FILE)\" --model $MODEL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
