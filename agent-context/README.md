# agent-context/

Optimised sub-agent context system.
Goal: reduce sub-agent initialisation from ~8,000 tokens → ~800 tokens.

## Files
- `base-soul.md`      — Minimal cached soul for all sub-agents (stable, rarely changes)
- `distill.py`        — Context distiller: takes task + relevant memory files → tight brief via Gemini Flash
- `brief-template.md` — Task brief format for surgical handoffs
- `spawn-log.jsonl`   — Append-only log of every sub-agent spawn: model, tokens estimated, task, result
- `spawn.sh`          — CLI wrapper: distill → brief → spawn, logs automatically

## Strategy
1. Sub-agents get `base-soul.md` (stable → prompt cache hits at ~10% cost after first call)
2. `distill.py` extracts only task-relevant context (cheap Flash model, ~200 tokens output)
3. Brief = distilled context + specific task instruction (<500 tokens total)
4. All spawns logged to `spawn-log.jsonl` with token estimates
