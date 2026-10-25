---
description: Standing engineering guardrails for scope, branches, reuse, and conventions.
alwaysApply: true
---

# Guardrails

**The stuck rule.** Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - two failed attempts at the same fix mean change the fix; never try the same fix a third time. For a required check or approved work, keep going with a different fix until a stop reason in that file applies.

**Scope discipline.** Touch only what the task requires. No drive-by refactors, no renaming things you happened to notice, no "while I was in there." If you find something worth fixing, write it down and move on. Law: owner-scope-minimal-diff (.ai/rules/owner-scope-minimal-diff.md).

**Frustration is not a work order.** Venting, a competitor link, "this is why you need to work harder", swearing — none of it is a task. It is information about how Chris feels, not an instruction about what to build. Answer what was actually asked and stop. If there is no question in it at all, ask what he wants. Producing an unrequested deliverable to look busy is the failure mode this rule exists to stop.

**Scope creep check.** Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - if the work grows past roughly double what the plan estimated, stop and re-scope. A required build, verification or release check never counts toward 'double the estimate'. New product scope still stops.

**Reuse before you build.** Search for an existing implementation before writing a new one. Two functions doing the same thing is a bug that takes months to surface.

**Commit working states.** Commit whenever the suite is green and a unit is complete. Small commits mean a bad build costs minutes to undo instead of a day.

**Delete your branch when it lands (owner-set 2026-08-31).** A branch whose work is merged is finished. Delete it in the same breath as the merge — `git push origin --delete <branch>` — and delete the local copy too. Nobody has ever come back to one.

On 2026-08-31 there were **fifteen** branches sitting on the remote with nothing open against them. Ten were a week stale. Three carried real work nobody could see, because a branch with no pull request is invisible to everyone but the agent that made it. That is the actual cost: not clutter, but work that quietly never ships.

So, every time:

* **Merged → delete it.** Both remote and local, immediately, no exceptions.
* **Not merged and you are done with it → say so and delete it.** Name what was on it in your task report first, so the decision to drop it is Chris's and not a silent one.
* **Not merged and still live → open a pull request now.** An unmerged branch with no pull request is not "in progress", it is lost. If it is not ready, it still gets a draft PR so it exists somewhere a human looks.

Before you report a task complete, run `git branch -r --no-merged origin/main` and account for every line it prints. An unexplained branch in that list is an unfinished task, not a housekeeping detail.

**Deleting branches (looked up 2026-10-24).** From the Mac, `git push origin --delete <branch>` works now; it no longer returns 403. Delete merged branches from the Mac. From the hosted (cloud) environment it returned `HTTP 403` from the egress proxy (measured 2026-08-31) — a policy denial, the same class as `api.netlify.com` in §11 — and the GitHub MCP server has no delete. There, record safe-to-delete branches with a one-line verdict each in the task report, do not retry the 403, and do not route around it.

**Checkpoint when context fills.** If a session is long or has gone sideways, write current state to the workflow file and keep going from there. Never tell Chris to start a fresh session (owner-set 2026-10-24; context reminders are off since 2026-10-21). Quality drops well before you run out of room, so keep the board current.

**Conventions.** Simplest thing that works, no speculative abstraction. No new dependencies without asking. Match existing patterns in the file you are editing over your own preference. Never commit secrets — no keys, tokens, or PII in code, fixtures, or logs. Delete dead code you create.

**Annotated screenshots (owner-set 2026-08-19).** Law: audit-screenshot-markups (.ai/rules/audit-screenshot-markups.md) - numbered red circles and yellow arrows on the exact control, with a legend. An unmarked screenshot is an incomplete deliverable. Do not send it, embed it in review docs, or treat it as evidence. Applies to all audits, review sheets, and fixer before/after proof.
