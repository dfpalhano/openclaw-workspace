# SKILL_ROUTING.md — Atlas Orchestration Policy

## Core Rule
Default to nothing. Only load a skill or tool when it provides a clear, necessary capability
that cannot be satisfied by reasoning, memory, or existing context.

**Mindful, not restrictive. When in doubt — check.**

---

## Step 0 — Memory First
Before any tool or skill call:
- Check MEMORY.md and today's daily note
- If the answer is already there, use it. No tool needed.

---

## Decision Checklist (apply before every tool/skill invocation)

### 1. Need Test
Can I answer directly with reasoning and existing context?
→ Yes → answer directly, no tool
→ No → proceed to capability test

### 2. Capability Test
Does this require a specific capability I don't have natively?

| Capability needed | Use |
|---|---|
| Latest info, prices, news, laws, schedules | web search skill |
| Gmail / Calendar / Drive access | gog skill |
| File parsing — CSV, XLSX, PDF | exec + python3 |
| Browser automation, form filling | browser tool or Playwright skill |
| Tweet / X post / read timeline | xurl skill |
| Audio transcription | openai-whisper-api skill |
| Image generation | nano-banana-pro or openai-image-gen skill |
| Weather / forecast | weather skill |
| Music / speaker control | blucli skill |
| Place lookup | goplaces skill |
| Read/edit/create local files | read / write / edit tools directly |
| Run shell commands | exec tool directly |
| GitHub PRs, issues, CI | github skill |
| Large coding task (new feature, refactor) | coding-agent skill → subagent |

→ If no capability match → answer directly
→ If match found → proceed to cost test

### 3. Cost Test (cheapest option first)
Ranked by cost — always try the cheaper option first:

1. **Reasoning / memory** — free
2. **read / write / edit tools** — near free
3. **exec (shell)** — cheap
4. **browser tool** — moderate
5. **Skill (ClawHub package)** — moderate
6. **Subagent (inline)** — expensive
7. **Subagent (spawned — Claude Code / Codex)** — most expensive

→ Use the lowest-cost option that solves the problem
→ Only escalate if cheaper option fails or is clearly insufficient

---

## Execution Rules

- Load **at most one skill** first — the most relevant
- If it fails or is insufficient, load the next best
- **Never load multiple skills speculatively**
- **Never do background exploration or extra steps unless asked**
- Subagents: justified when task is too large, too risky, or needs isolation — not just for convenience

---

## Output Discipline

- Respond with minimum effective work
- Provide the answer or the next concrete action
- Avoid long explanations unless requested
- Avoid repeating context back to the user
- Short answers are respectful of time

---

## Applies To
- Atlas (main session)
- All spawned subagents
- All heartbeat tasks

---

## Changelog
- 2026-02-28 — Initial version, co-designed with owner
