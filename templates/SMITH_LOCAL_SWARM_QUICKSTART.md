# Smith Local Swarm Quickstart

## When to use
Use this when:
- the codebase is local
- cost matters
- you want parallel help
- you still want one clean integrator

Do not use this when:
- multiple cheap models would be editing the same critical production logic unsupervised
- the task is mostly external SaaS automation
- architecture is still unclear and needs proper design first

---

## Fast setup

### Pattern
1. If task is big/unclear, ask Forge for architecture first.
2. Put Smith in charge of implementation.
3. Spawn 2-4 local qwen workers with narrow briefs.
4. Have Smith integrate outputs.
5. Run a diff review worker.
6. Verify locally.
7. Commit.

---

## Default worker set

### Minimal set
- Mapper
- Test Worker
- Diff Reviewer

### UI task set
- Mapper
- UI Worker
- Test Worker
- Diff Reviewer

### Documentation-heavy set
- Mapper
- Test Worker
- Docs Worker
- Diff Reviewer

---

## Non-negotiables
- Smith is the only integrator.
- Cheap workers suggest, Smith decides.
- No direct production merge from worker output.
- Verification before completion claim.

---

## Copy/paste kickoff brief for Smith

"Use the Smith Local Swarm pattern. You are the sole integrator. Use local qwen workers only for bounded subtasks like mapping, UI draft, tests, docs, and diff review. Do not delegate final authority on auth, routes, data writes, or integration logic. Verify all outputs against the real codebase before applying changes."
