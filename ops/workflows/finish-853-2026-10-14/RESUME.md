# Resume the 853 run after the Mac was shut down (written 2026-10-14 ~20:40 Arizona)

## State when it stopped
- Workflow run id: `wf_66a8c56a-6d6` (26 batches, builders -> checkers -> repair -> Opus oversight -> Opus integrator).
- Script: `/Users/chrisstanbridge/.claude/projects/-Users-chrisstanbridge-Developer-fundhub-platform/9979f0a3-2752-4913-9e77-2e181536eec6/workflows/scripts/finish-853-wf_66a8c56a-6d6.js`
- Journal (finished agent results): `.../subagents/workflows/wf_66a8c56a-6d6/journal.jsonl`
- Args: `{ "batches": <contents of ops/workflows/finish-853-2026-10-14/batches.json> }`
- Work lives in local branches `fin/bNN` (worktrees `.claude/worktrees/fin-bNN`) cut from `fin/base`. Nothing is pushed.
- At 19:33: 17 of 26 builders had written manifests; batches 20, 21, 24, 25, 26 were not built yet.

## To resume (same Claude session)
1. `ls .git/worktrees/*/index.lock` and remove any stale lock whose process is gone.
2. Make sure the old run is stopped (TaskStop), then:
   `Workflow({ scriptPath: <script above>, resumeFromRunId: "wf_66a8c56a-6d6", args: { batches: <batches.json> } })`
   Finished agents come back from cache; only the unfinished steps re-run.
3. If resume is refused (new session), start a new run with the same script and args. Builders continue in an
   existing worktree and branch, so finished work is kept. Delete nothing in `.claude/worktrees/fin-*`.

## Other open items
- PR #51 is merged on `origin/main` (`6961550b2`) but NOT live: the GitHub ship failed 3 times because a web GET from
  GitHub's machine to fundhub.ai timed out at 8 s (a different door each time; every database read was fast; the
  live site answers in under 1 s from the Mac). Re-run once in the morning: `gh run rerun 38675583295`.
- Local `main` is 3 commits ahead of `origin/main` (board notes + the Monday rule) and behind the PR #51 merge:
  `git pull --rebase origin main` then push after the ship passes.
- Email alerts to Chris are live (`PULSE_EMAIL_TO`); texts are dead until Twilio is reactivated.
