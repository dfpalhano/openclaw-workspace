#!/usr/bin/env python3
import sys

with open('memory/core/active-tasks.md', 'r') as f:
    lines = f.readlines()

# Find the first occurrence of "# Active Tasks"
start_idx = -1
for i, line in enumerate(lines):
    if line.strip() == '# Active Tasks':
        start_idx = i
        break

if start_idx == -1:
    print("Could not find '# Active Tasks'")
    sys.exit(1)

# Keep from start_idx onwards
lines = lines[start_idx:]

# Remove duplicate lines (simple approach: keep unique lines but preserve order)
seen = set()
unique = []
for line in lines:
    stripped = line.strip()
    if stripped and stripped not in seen:
        seen.add(stripped)
        unique.append(line)
    elif not stripped:
        # Keep empty lines
        unique.append(line)

# Write back
with open('memory/core/active-tasks.md', 'w') as f:
    f.writelines(unique)

print(f"Cleaned {len(lines) - len(unique)} duplicate lines")