---
description: Finish approved work through required checks without premature PR handoff or repeat approval requests.
alwaysApply: true
---

# Finish the requested job

Owner rule, 2026-10-20. Applies to every approved execution task, not only launches.

Launch form (owner law 2026-10-17, now part of this rule): if Chris approved a launch, said “ship,” or said “go live after checks pass,” each failure in the required release checks is part of that named task. Do not ask again whether to repair it, even if the failing code or test is in an adjacent file.

- Deliver the original requested outcome. A plan, commit, PR or passing test count is a checkpoint, not completion.
- Required build, verification, dependency and release failures remain approved work, even in adjacent or pre-existing code. Diagnose, make the smallest justified fix and rerun; do not ask to expand scope just to repair a required check. Reproduce the failure first and keep the failing evidence until the check genuinely passes. A new file, route, field or test fixture needed for that repair is included in the approval if it preserves the approved behavior.
- Before ending, compare the request, delivered state and remaining work. If an authorized next step can advance the result, take it instead of handing the job back.
- A status question or rule update does not cancel unfinished work or reset approval. A delivery deadline is not a substitute reminder or follow-up task.
- Keep failed proof red. Never weaken, skip or delete checks, rerun blindly until green, or mock production to claim success.
- Stop only when the requested outcome is verified, the user explicitly pauses, or a genuine owner-only decision/input, tool-enforced confirmation or unavailable external prerequisite remains after safe in-scope alternatives are exhausted. Explain the evidence, attempts and one needed decision.
- Unrelated warnings, optional improvements and backlog work stay on the shared board as leftovers. Existing go-live approval, customer/money protection, credential, deletion and database-repointing rules remain unchanged. This rule does not approve changes to live customer data, money, credentials, or a new product decision. Routine in-scope account access follows `owner-authorized-account-ops`; ask only for truly missing authority or information.
- After approved go-live and passing checks, finish the release and verify the live result. Never call an unverified release live. Law: owner-go-no-repeat-approval (.ai/rules/owner-go-no-repeat-approval.md) - an approved release is never asked about twice.

Example: dashboard built + required health check fails → diagnose and repair the check, not “Should I expand the job to fix that?”

Example: a browser check for the approved app fails in another screen. Repair that failure and rerun the check; do not send Chris “May I fix this other test?”

## Stuck rule

Two failed attempts at the same fix mean change the fix. Never try the same fix a third time, and do not start rewriting surrounding code to make the problem go away. Thrashing is the most expensive failure mode there is. For a required check or any approved work, keep going with a different fix until one of the stop reasons above applies. When you do stop, report what you tried, what happened and your best guess at the cause.

## Scope creep

If the work grows past roughly double what the plan estimated, stop and re-scope. A required build, verification or release check never counts toward 'double the estimate'. New product scope still stops. Do not push through a task that turned out to be three tasks. The orchestrator's quota checkpoint stays: at about 80% of remaining quota, checkpoint the board and stop cleanly.

