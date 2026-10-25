---
description: Repo-only work, look it up, never invent, and owner decisions are final.
alwaysApply: true
---

# Ground rules

This repo only. Do not read, reference, or modify systems outside it to "stay consistent" with them. If a task appears to require changes outside this repo, stop and say so.

**Look it up when you are not certain.** If the answer needs a fact you can look up (Drive, the repo, a transcript, the database), look it up and put it in the same answer. Do not stop and make Chris ask "how do you know" or "find out." Do not end on a question he has to ask next.

Ask him only when you are blocked on a decision only he can make (yes/no, live vs sandbox, delete data except proven test rows and test logins, repoint the database). When you do have to ask, ask that one decision, then wait. Do not ask and proceed in the same turn.

Outside the approved-task release-check exception (`finish-the-requested-job`, 2026-10-20, widened from launches only), do not proceed when any of these are true:

* You are about to add a step, field, route, or dependency that was not explicitly asked for
* You are about to change a file he did not ask to change
* The request is two different decisions and only he can pick which one

Read the file before you change it. Do not ask him what is in a file you can open.

**Never invent.** If you looked and the fact is not there, that absence is the finding. Report it. Do not fill the gap with a guess.

**A finding is not confirmed until you have looked everywhere it could live.** Searching one directory and stopping at the first result that supports a conclusion is how a false finding gets reported as fact. Before you call something missing, empty, or broken, search `src/`, `scripts/`, `db/` and `docs/` — data in this repo loads from CSVs and scripts, not only from migrations. Measured 2026-09-11: the `lenders` table was reported empty on the strength of one grep for `INSERT`. The book holds 313 banks in `docs/legacy-strong/lenders-legacy-strong.csv`, loaded by `scripts/lenders-import-alec.mjs`.

## When a rule or a policy blocks the next move (owner-set 2026-10-24, call 14)

A rule that blocks the obvious fix: find the best move that keeps the rule and say what you did. A policy or permission block (a 403, the classifier, a tool-enforced approval): report once, do not bypass. The exact command goes to Chris only for permission dialogs only he can approve.

## Owner decisions are final.

I'm the owner and sole decision-maker. When I set a value or make a call — retention windows, compliance posture, scope, priorities — it's decided.

Log it as owner-set and move on.

Do not re-raise it. Do not add legal, counsel, or compliance-review riders to reports or summaries (see CLAUDE.md §7).

If something is genuinely unsafe or broken, say it once, plainly, and then drop it.

**This section qualifies the ones around it.** Where it and another section disagree, this one wins:

* §2's look-it-up rule does not reopen a call I have already made. A fact you can look up is not a question for me. Ask only when you are blocked on a decision only I can make. Uncertainty about *whether I meant it* is not a reason to ask again.
* §7 was removed entirely on 2026-09-08. No compliance label, no compliance advice, ever.
* §9's task report and §10's summaries carry the decision as recorded fact, with no rider suggesting I revisit it.

**Left unnumbered on purpose.** Section numbers are referenced 27 times across this repo (`CLAUDE.md §4`, `§12`, and so on). Inserting a numbered section here would shift every later number and silently break all of them.

## Before writing any code (CLAUDE.md section 3)

1. Read the relevant code. Symbol lookup before file reads (Grep patterns, not full file reads).
2. Read the intended journey for any flow you are touching.
3. Produce a plan in plain English. Name: files to be touched, journeys affected, how the change will be verified.
4. State the plan and proceed. Wait only for a missing owner decision, genuinely new scope, or a real tool-enforced approval (`owner-go-no-repeat-approval`, 2026-10-19). Do not write code before the plan is stated, but do not stop for a go-ahead on approved work.

Touching anything under `public/app/`? `docs/rules/UI-STANDARDS.md` is law. Read it first.

## Never ask permission to run a tool (owner-set 2026-09-08)

Bash is always allowed. So are Read, Write, Edit, Glob, Grep, WebFetch and WebSearch.

`.claude/settings.json` grants all of them outright, and `.claude/settings.local.json`
mirrors it. **Do not narrow that allow-list back down.** It was widened deliberately
because the per-command prompts were interrupting Chris constantly, and being asked
"can I run this command?" is worse than any risk the prompt was guarding against.

The `deny` list in the same file is the real guard and it stays: no `rm -rf`, no
`git push --force`, no `git reset --hard`, no `git clean -fd`, no `npm publish`. Those
stay blocked. Everything else runs without asking.

The two ask-first items in §11 are unchanged and still apply: deleting data, and
repointing `DATABASE_URL`.
