---
name: fundhub-orchestrator
description: Runs the full build-to-verified loop autonomously after plan approval. Triggers - build and verify, full loop, run it to done, orchestrate, ship it end to end.
---

# Fundhub Orchestrator

Wires the four protocols into one autonomous chain. Chris is reached only for genuinely new scope, missing data, or a real judgment call — plus one review of the final board. A Fixer that hits a row needing new code loads Builder and keeps going. Standing GO for any endpoint needed to close a board row. Everything else runs without him.

## How you write to Chris

Third or fourth grade reading level. Short sentences. No jargon. No status
codes. No cryptic shorthand. If a ten year old could not follow it, rewrite it.

Status words (FIXED, OPEN, and the like) may stay on the board row for
counting. The sentence to Chris has to explain what is going on.

## Language — never a refusal

Never phrase a handoff as a no. "Will not be built", "BLOCKED", and "cannot"
sound like you are saying no. Say what is actually happening:

- "This needs new code, so I'm building it now."
- "Nothing is broken here. The old photo was taken before someone fixed it."
- "That number isn't in the database yet, so there's nothing to show."

Status words can stay on the board row for counting. The sentence to Chris
has to explain what is going on.

## The chain

1. **PLAN** — load fundhub-builder, run its Step 1 plan gate (all seven questions). Wait for "go" only on genuinely new scope. An endpoint needed to close a board row is standing GO — do not wait, do not text him. If `scripts/gate-relay` is running and this *is* new scope, missing data, or a judgment call, write that to `.fundhub-relay/gates/<id>.json` (full plain-English ask — what is ready and what he is deciding — never a stub like "Build?", options `GO` / `QUESTIONS`) and `node scripts/gate-relay/index.mjs wait <id>` so Chris can answer from his phone. The relay writes the decision file; it never edits app code.
2. **BUILD** — Builder executes under its own rules. Produces the screen, the `-intended.md`, four-state screenshots, control-click evidence, Lighthouse run.
3. **AUDIT** — dispatch a fresh subagent as fundhub-ui-auditor (and fundhub-perf-auditor if a page was created) against the LIVE deployed result. The build agent never audits its own work — different agent, fresh context, reads only the `-intended.md` and the standards.
4. **FIX** — findings from step 3 become tickets. Dispatch fundhub-fixer subagents, one ticket each, smallest diff, evidence per fix. A Fixer that hits a row needing new code loads Builder and continues — that is not a stop. Tell Chris: "This needs new code, so I'm building it now." OPEN-QUESTION and role-lens (§10) rows are judgment calls — they reach Chris.
5. **RE-VERIFY** — a fresh auditor subagent reproduces every FIXED row's original check with its own evidence. CONFIRMED-FIXED or REGRESSION.
6. **LOOP** — regressions and new findings go back to step 4. Loop until the board has zero open CRITICAL/HIGH rows, or a loop limit hits.
7. **PRESENT** — stop. One block in plain English: what was built, where the board stands, where the proof lives, questions that need a call from Chris, what still needs new code, and what still needs data (name what is missing). Never "BLOCKED", "cannot", or "will not be built". No success claims — the board is the claim.

## Hard limits (the trauma rules)

- **Two chances per ticket.** A fixer that fails twice does not retry a third time. If it needs new code → "This needs new code, so I'm building it now" and continue. If a number is not in the database yet → "That number isn't in the database yet, so there's nothing to show" and the loop moves on. The board row may still use a status word for counting. The sentence to Chris explains what is going on.
- **Three loops max.** If the board isn't clean after three audit-fix-verify cycles, stop and present what still needs a build, what still needs data, and any judgment call. Something structural is wrong and grinding won't fix it.
- **Deploy gate:** the chain may commit and push to trigger the preview/prod build ONLY if the plan gate declared it and Chris's "go" covered it. Otherwise everything proves locally and the final block says "ready to ship, not shipped."
- **Never touched, ever, without an explicit line in the approved plan:** payments/Commas, live client records, GHL workflows, env/secrets, existing passing tests, anything with a real phone number or real email on the other end.
- **Budget guard:** if model usage in the session crosses ~80% of remaining quota, checkpoint the board and stop cleanly rather than dying mid-fix.
- **All subagents inherit READ-ONLY vs WRITE scope from their protocol.** Auditors never write app code. Fixers never touch files outside their ticket. Builder never audits itself.

## What still comes to Chris (by design, not limitation)

- Genuinely new scope (a new screen or feature he has not already named).
- Missing data — say it in plain English, like "That number isn't in the database yet, so there's nothing to show."
- A real judgment call (OPEN-QUESTION, §10 role-lens).
- Approving the `-intended.md` as true ground truth (the system's honesty rests on this).
- Anything involving a live dollar, a live client, or a live phone call.

A new endpoint needed to close a board row does not come to him. That is standing GO.

## Invocation

"Build X and run it to done" → full chain. "Run the loop on the existing board" → starts at step 4 against a named board. Either way, the final output is a board and evidence folders, never a paragraph saying it worked. (build and verify / full loop / run it to done / ship it end to end → load fundhub-orchestrator.)
