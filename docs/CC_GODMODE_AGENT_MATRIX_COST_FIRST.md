# cc-godmode Agent Model Matrix (Cost-First)

## Principle
Use the cheapest model that can reliably do the job.
Reserve expensive models for cases where the extra quality is worth the cost.

---

## Recommended Mapping

| Agent | Preferred Model | Use | Avoid Using For |
|---|---|---|---|
| Forge | GLM5 | Architecture drafts, coordination, handoff specs, planning | Deeply ambiguous or high-stakes design when cheaper passes fail |
| Smith | GPT-5.4 | Implementation, integration, final code owner | Tiny trivial tasks better handled by Flashbot |
| Flashbot | GPT-5.4 mini | Fast lightweight helper work | Deep architecture or long reasoning |
| Ledger | DeepSeek Reasoner | Finance, SQL, reconciliation, numerical reasoning | UI drafting |
| Orbit | Kimi 2.5 | Onboarding, workflow-heavy reasoning, long context | Tiny throwaway tasks |
| Warden | Kimi 2.5 | Email/calendar/ops-heavy reasoning, inspections, long context | Deep infra coding |
| Jess | Kimi 2.5 | Leasing/Flatmates, lead classification, long conversation context | Infrastructure changes |
| Thor | GLM5 or GPT-5.4 | Infrastructure, bots, bridges, service logic | Cheap simple text tasks |

---

## Shared Support Layers

| Layer | Model / Tool | Use |
|---|---|---|
| Cheap helpers | Local qwen models | Code search, boilerplate, draft tests, diff review, bounded subtasks |
| Fallback planner | GLM5 | Balanced fallback orchestration when primary planner is unavailable |
| Long-context analyst | Kimi 2.5 | Large context passes, detailed workflow analysis |
| Expensive specialist | Claude Sonnet 4.6 | Only when the task is complex enough to justify the cost |

---

## Sonnet Policy
Claude Sonnet 4.6 is **not** the default.
Use it only when:
- architecture is genuinely hard
- a wrong decision would be expensive
- cheaper models have already been tried and are not good enough
- you need high-confidence system design or review

Otherwise, prefer GLM5, GPT-5.4, GPT-5.4 mini, Kimi 2.5, or local qwen.

---

## Rules of Use
- **Smith** owns final integration.
- **Forge** uses GLM5 by default, Sonnet only by exception.
- **Flashbot** handles cheap bounded tasks only.
- **Local qwen workers** may assist Smith but never own final authority.
- **GLM5** is the normal fallback planner.
- **Kimi 2.5** is preferred for long-context roles.
- **Sonnet** is a specialist exception, not the baseline.

---

## Summary
- Forge = GLM5 (Sonnet only by exception)
- Smith = GPT-5.4
- Flashbot = GPT-5.4 mini
- Ledger = DeepSeek Reasoner
- Orbit = Kimi 2.5
- Warden = Kimi 2.5
- Jess = Kimi 2.5
- Thor = GLM5 or GPT-5.4
- Cheap helpers = local qwen
- Fallback planner = GLM5
- Long-context analyst = Kimi 2.5
- Sonnet = expensive specialist only
