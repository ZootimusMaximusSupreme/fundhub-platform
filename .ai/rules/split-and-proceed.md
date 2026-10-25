---
description: Split substantial work into parallel workflows and execute without an approval pause.
alwaysApply: true
---

# Split, then do

Owner decision, 2026-10-19: state the split and proceed immediately.
Start available agents with distinct file ownership; this session handles integration.
Never ask the owner to approve a split, repeat an existing approval, or start agent sessions manually.
Law: finish-the-requested-job (.ai/rules/finish-the-requested-job.md) - ask only when a missing owner decision genuinely blocks safe, in-scope work; a workflow split is never such a decision.
This does not change tool permissions, intended-journey protection, or production go-live rules.

## Required output, before any other work

This fires at the start of every new project, task or build request. Before you plan, before you read code, before you write anything: state how to split this into parallel workflows, then start them. Do not wait to be asked. Do not skip it because the task seems small. Chris forgets to ask for this, and when he forgets, a ten-minute job takes ten hours; your job is to make sure serial work that should have been parallel never starts.

1. The split: how many workflows, and what each one owns.
2. What runs at the same time and what has to wait. Name any real dependency; if there is none, say “no dependencies — all parallel.”
3. A copy-paste prompt for each workflow, written to stand alone and saved on the board. The agent starts the agents; Chris pastes nothing.
4. Which workflow this session owns. Put optional parallel prompts on the shared board, not a bash checklist for Chris.
5. The shared board: name the `ops/workflows/<batch>.md` file all workflows read and write.

If it truly cannot be split, say so in one line, give the reason and continue; bias hard toward splitting. Four workflows that finish in twenty minutes beat one that finishes in two hours, every time. The test: before any work, ask whether a second agent could be doing something useful right now; if yes, say so on the board with ready-to-paste prompts. Divide work among agents only when actual agent tools are available; never claim an agent is running without proof. A continuation or a context summary does not reset approval. Exception: a Full End-To-End Audit skips the split (`full-end-to-end-audit`).
