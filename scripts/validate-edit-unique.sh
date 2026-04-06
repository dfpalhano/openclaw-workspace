#!/bin/bash
# Validate edit uniqueness before applying
# Part of capability-evolver repair strategy

if [ $# -lt 2 ]; then
    echo "Usage: $0 <file> <pattern>"
    echo "Example: $0 openclaw.json '\"model\": \"ollama/minimax-m2.5\"'"
    exit 1
fi

FILE="$1"
PATTERN="$2"

if [ ! -f "$FILE" ]; then
    echo "Error: File not found: $FILE"
    exit 1
fi

# Count occurrences using grep (basic pattern matching)
OCCURRENCES=$(grep -o "$PATTERN" "$FILE" | wc -l)

echo "File: $FILE"
echo "Pattern: $PATTERN"
echo "Occurrences: $OCCURRENCES"

if [ "$OCCURRENCES" -eq 1 ]; then
    echo "✅ Pattern is unique - safe to edit"
    exit 0
elif [ "$OCCURRENCES" -eq 0 ]; then
    echo "⚠️  Pattern not found"
    exit 2
else
    echo "❌ Pattern appears $OCCURRENCES times - not unique"
    echo "Suggestion: Use more context to make pattern unique"
    exit 3
fi