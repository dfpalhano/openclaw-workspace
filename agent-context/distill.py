#!/usr/bin/env python3
"""
Context distiller — extracts task-relevant context from memory files using a cheap model.
Usage: python3 distill.py "fix the payment parser bug in import_rent_excel.py" [--files memory/2026-03-06.md]
Output: brief.txt (≤500 tokens) ready to pass to sub-agent
"""

import sys
import os
import json
import argparse
import urllib.request
import urllib.error
from pathlib import Path

WORKSPACE = Path.home() / '.openclaw/workspace'
MEMORY_FILE = WORKSPACE / 'MEMORY.md'
LOG_FILE = WORKSPACE / 'agent-context/spawn-log.jsonl'

# Cheap model for distillation
DISTILL_MODEL = 'google/gemini-3-flash-preview'

def read_files(paths: list[str]) -> str:
    chunks = []
    for p in paths:
        fp = Path(p) if Path(p).is_absolute() else WORKSPACE / p
        if fp.exists():
            content = fp.read_text(encoding='utf-8')
            # Truncate to 4000 chars per file to stay cheap
            if len(content) > 4000:
                content = content[:4000] + '\n...[truncated]'
            chunks.append(f'=== {fp.name} ===\n{content}')
    return '\n\n'.join(chunks)

def distill(task: str, context_text: str, api_key: str) -> str:
    prompt = f"""You are a context distiller. Given a task and raw context files, extract ONLY what's relevant to the task.
Output a tight brief: max 400 words, no fluff. Include: key paths, current state, constraints, what the agent needs to know.

TASK: {task}

CONTEXT:
{context_text}

BRIEF (relevant context only):"""

    payload = json.dumps({
        'model': DISTILL_MODEL,
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': 600,
        'temperature': 0.1
    }).encode()

    req = urllib.request.Request(
        'https://openrouter.ai/api/v1/chat/completions',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://openclaw.ai'
        }
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    return data['choices'][0]['message']['content'].strip()

def log_spawn(task: str, model: str, brief_tokens: int, distill_tokens: int, files: list):
    entry = {
        'ts': __import__('datetime').datetime.now().isoformat(),
        'task': task[:120],
        'model': model,
        'brief_tokens_est': brief_tokens,
        'distill_tokens_est': distill_tokens,
        'context_files': files,
        'total_overhead_est': brief_tokens + distill_tokens
    }
    LOG_FILE.parent.mkdir(exist_ok=True)
    with open(LOG_FILE, 'a') as f:
        f.write(json.dumps(entry) + '\n')
    return entry

def estimate_tokens(text: str) -> int:
    # Rough estimate: 1 token ≈ 4 chars
    return max(1, len(text) // 4)

def main():
    parser = argparse.ArgumentParser(description='Distill context for sub-agent task')
    parser.add_argument('task', help='Task description')
    parser.add_argument('--files', nargs='*', default=[], help='Additional context files (relative to workspace)')
    parser.add_argument('--model', default='anthropic/claude-sonnet-4-6', help='Target agent model')
    parser.add_argument('--no-distill', action='store_true', help='Skip distillation, just bundle files as-is')
    parser.add_argument('--out', default='/tmp/agent-brief.md', help='Output brief file')
    args = parser.parse_args()

    api_key = os.environ.get('OPENROUTER_API_KEY') or os.environ.get('OR_API_KEY', '')

    # Always include base soul
    base_soul = (WORKSPACE / 'agent-context/base-soul.md').read_text()

    # Collect context files
    context_files = ['MEMORY.md'] + (args.files or [])
    context_text = read_files(context_files)

    if args.no_distill or not api_key or not context_text.strip():
        distilled = context_text[:2000] if context_text else '(no additional context)'
        distill_tokens = estimate_tokens(distilled)
    else:
        print(f'Distilling context for: {args.task[:60]}...', file=sys.stderr)
        distilled = distill(args.task, context_text, api_key)
        distill_tokens = estimate_tokens(context_text)  # what we consumed in distill call

    brief = f"""# Task Brief

## Task
{args.task}

## Context
{distilled}

## Instructions
{base_soul}
"""

    brief_tokens = estimate_tokens(brief)
    Path(args.out).write_text(brief, encoding='utf-8')

    entry = log_spawn(args.task, args.model, brief_tokens, distill_tokens, context_files)

    print(f'Brief written to: {args.out}')
    print(f'Brief tokens (est): {brief_tokens}')
    print(f'Distill consumed (est): {distill_tokens}')
    print(f'Saved vs full context (est): {max(0, distill_tokens - brief_tokens)} tokens')
    print(f'Log: {LOG_FILE}')
    return args.out

if __name__ == '__main__':
    main()
