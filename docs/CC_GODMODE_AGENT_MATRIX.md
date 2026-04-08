# cc-godmode Agent Model Matrix

## Purpose
Map the preferred models for each cc-godmode agent so orchestration is consistent and low-friction.

---

## Recommended Mapping

| Agent | Model | Primary Use | Not Best For |
|---|---|---|---|
| Forge | Claude Sonnet 4.6 | Architecture, coordination, handoff specs, system design | Cheap quick one-off tasks |
| Smith | GPT-5.4 | Implementation, integration, final code owner | Very cheap trivial tasks |
| Flashbot | GPT-5.4 mini | Fast lightweight helper work | Deep architecture or long reasoning |
| Ledger | DeepSeek Reasoner | Finance, SQL, reconciliation, numerical reasoning | Fast UI drafting |
| Orbit | Kimi 2.5 | Onboarding, workflow-heavy reasoning, long context | Tiny throwaway tasks |
| Warden | Kimi 2.5 | Email/calendar/ops-heavy reasoning, inspections, long context | Deep infra coding |
| Jess | Kimi 2.5 | Leasing/Flatmates, lead classification, long conversation context | Infrastructure changes |
| Thor | Claude Sonnet 4.6 | Infrastructure, bots, bridges, service logic | Cheap quick one-offs |

---

## Shared Support Layers

| Layer | Model / Tool | Use |
|---|---|---|
| Cheap helpers | Local qwen models | Code search, boilerplate, draft tests, diff review, bounded subtasks |
| Fallback planner | GLM5 | Balanced fallback orchestration when primary planner is unavailable |
| Long-context analyst | Kimi 2.5 | Large context passes, detailed workflow analysis |
| Main implementation brain | GPT-5.4 | Final implementation control and integration |
| Deep architecture brain | Claude Sonnet 4.6 | Hard planning, design, infra reasoning |

---

## Rules of Use
- **Smith** owns final integration.
- **Forge** owns architecture when scope is broader than one file or one flow.
- **Flashbot** handles cheap bounded tasks only.
- **Local qwen workers** may assist Smith but never own final authority.
- **GLM5** is the fallback planner, not the default.
- **Kimi 2.5** is preferred for long-context roles.

---

## Summary
- Forge = Sonnet 4.6
- Smith = GPT-5.4
- Flashbot = GPT-5.4 mini
- Ledger = DeepSeek Reasoner
- Orbit = Kimi 2.5
- Warden = Kimi 2.5
- Jess = Kimi 2.5
- Thor = Sonnet 4.6
- Cheap helpers = local qwen
- Fallback planner = GLM5
- Long-context analyst = Kimi 2.5
