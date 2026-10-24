# Audit vs Fix

**Owner law (2026-08-16):** Auditing and fixing are two doors. An agent never walks through both in the same pass.

## Router

| Chris said something like… | Load this skill | Do |
|---|---|---|
| Full End-To-End Audit, full e2e audit, full end to end | `.claude/rules/full-end-to-end-audit.md` | Gate (two questions), then walk every **live** path in order, then beta every-button. Dictator checklist is mandatory (five horsemen, fulfillment, AI call, doc chase, FTC upload, Meet → context). Agent proves Gmail + agent phone + on-screen data. Do not ask Chris to click. **Not** read-only `fundhub-auditor`. |
| audit, verify, discover, "what's broken", journey ground truth | `fundhub-auditor` | Find and prove. **Read-only.** |
| ui audit, design audit, "check the dashboard", screen review, slop check | `fundhub-ui-auditor` | Score screens against `docs/rules/UI-STANDARDS.md`. **Read-only.** |
| perf audit, speed audit, load time, lighthouse, page speed, core web vitals | `fundhub-perf-auditor` | Score pages against `docs/rules/PERF-STANDARDS.md`. **Read-only.** |
| fix, ship, repair, wire, "make X work", unblock | `fundhub-fixer` | Change **only** what he named. Then prove. |
| build, create, add a screen, new dashboard, new feature, scaffold, make me a | `fundhub-builder` | Not for fixing (`fundhub-fixer`) or auditing (`fundhub-auditor`). No trigger matched → normal dev under existing rules. |
| agent test / roleplay the AI / did the agent follow its prompt | `fundhub-agent-tester` | Two AIs talk. Score prompt + intended journey. |
| before any PASS / e2e-done / "we tested it" claim | `fundhub-system-map` | Discovery only. Read it before claiming PASS. |

Skill paths:

- `.claude/rules/full-end-to-end-audit.md` (Full End-To-End Audit — not a skill; this door wins)
- `.cursor/skills/fundhub-auditor/SKILL.md`
- `.cursor/skills/fundhub-ui-auditor/SKILL.md`
- `.cursor/skills/fundhub-perf-auditor/SKILL.md`
- `.cursor/skills/fundhub-fixer/SKILL.md`
- `.cursor/skills/fundhub-builder/SKILL.md`
- `.cursor/skills/fundhub-agent-tester/SKILL.md`
- `.cursor/skills/fundhub-orchestrator/SKILL.md` (full loop after plan approval)

Read the matching skill **before** any other work on that request.

## Both in one message

If he said **Full End-To-End Audit**, that door wins. Do **not** run read-only `fundhub-auditor` first and skip sends. Full End-To-End Audit beats CLAUDE.md §0 — gate first; do not dump a split.

Otherwise: run **Auditor** first. Stop with findings. Wait for Chris to name what to fix. Do not start Fixer in the same turn. (If Chris already asked for the audit, the Auditor writes the board and goes on; it stops only for a missing owner decision.)

## Ambiguous "test"

- If he said **Full End-To-End Audit**, that is this door — gate, then walk. Not “audit or fix?”
- If he pasted a named hole → that chat does VERIFY then FIX then FINISH (`three-step-repair.md`).
- If a fix already landed this session **and he did not name a hole** → Fixer prove path (suite → live Playwright 100 → human click).
- Otherwise → ask one question: "audit or fix?" Wait.

## Named-hole repair (owner-set 2026-08-26)

One issue per thread (`.claude/rules/one-issue-per-thread.md`). Verify → Fix → Finish in **one paste, one chat** (`.claude/rules/three-step-repair.md`). Each named hole is one task with one owner chat; the agent starts it from the board prompt. Chris does not copy anything.

## Never

- Audit-and-fix in one pass
- "While I was auditing I also fixed…"
- Turning a red test green by editing the test, baseline, or hook during an audit
- Skip VERIFY on a named hole

## How to sequence (owner-set 2026-08-24)

Day work = **Skills + Orchestrator + `ops/workflows/` boards**. Manual sequences. Do not invent a new agent per chore. Do not merge Hygiene + VC into one skill.

Default loop: **Audit → stop → Chris names the fix → Fixer.** Full build-to-done chains load `fundhub-orchestrator` after plan approval.

Parallel work: CLAUDE.md §0 boards. The agent starts available agents itself and puts copy-paste prompts on the board. Agents coordinate only through the shared board.

**Cursor Automations:** only if Chris explicitly asks for a schedule or event job. Never use Automations for ad-hoc A→B handoffs.
