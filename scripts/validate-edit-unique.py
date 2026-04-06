#!/usr/bin/env python3
"""
Validate edit uniqueness before applying
Part of capability-evolver repair strategy
"""

import sys
import re

def count_occurrences(content, pattern):
    """Count occurrences of pattern in content"""
    if not content or not pattern:
        return 0
    # Escape special regex characters
    escaped_pattern = re.escape(pattern)
    matches = re.findall(escaped_pattern, content)
    return len(matches)

def main():
    if len(sys.argv) < 3:
        print("Usage: python validate-edit-unique.py <file> <pattern>")
        print("Example: python validate-edit-unique.py openclaw.json '\"model\": \"ollama/minimax-m2.5\"'")
        sys.exit(1)
    
    file_path = sys.argv[1]
    pattern = sys.argv[2]
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        occurrences = count_occurrences(content, pattern)
        
        print(f"File: {file_path}")
        print(f"Pattern: {pattern}")
        print(f"Occurrences: {occurrences}")
        
        if occurrences == 1:
            print("✅ Pattern is unique - safe to edit")
            sys.exit(0)
        elif occurrences == 0:
            print("⚠️  Pattern not found")
            sys.exit(2)
        else:
            print(f"❌ Pattern appears {occurrences} times - not unique")
            print("Suggestion: Use more context to make pattern unique")
            sys.exit(3)
    except FileNotFoundError:
        print(f"Error: File not found: {file_path}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()