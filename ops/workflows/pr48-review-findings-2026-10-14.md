# PR #48 (hourly beat capacity) — Claude's test and an independent review, 2026-10-14

PR #48 tip: `71d7727ff` on `codex/heartbeat-tripwire-repair-2026-10-13`. Kept as tag `archive/pr48-hourly-capacity-71d7727ff` (the branch and the PR were closed in the 2026-10-14 cleanup: Chris ordered no branches and no open PRs). Start the fix from that tag: `git switch -c <new-branch> archive/pr48-hourly-capacity-71d7727ff`.

## Verdict: not ready. The measurements pass. An independent Opus reviewer found a real design weakness.

### What passed (measured by Claude, clean checkout)
- `npm run pulse:prove -- --beats`: OK three times; 15 beats, 0 cut, total run 8.7 to 11.7 s.
- With `--read-delay=120` and `--read-delay=250`: OK, 0 cut, 0 deadlines; slowest beats 3.9 s and 4.1 s.
- Lint clean, `tsc` 0 errors, suite 22,769 pass; the one failing test passes 2 of 2 alone.
- Diff: 8 files, no product code, no write, no send, no secret, no weakened test.

### What the reviewer found (read-only walls are intact; these are about behavior)

1. HIGH `src/pulse/runner.mjs` ~280-285: beats are split `index % 3` into three lanes and each lane runs its 5 beats one after another inside ONE 13 s phase. `apply-links` is first in lane 0 and can legitimately take up to 10.5 s (one hanging bank page). The 4 beats behind it then get about 2.5 s and are cut ("deadline"), all with damp 1, so the first red texts, and 4 reds at once trips the storm text. The laptop proofs only passed because `apply-links` took 1.5 s there.
   FIX: three workers, each owning one box, that pull the next beat from ONE shared queue. A slow beat then holds one worker, not a fixed row of four.
2. MEDIUM `runner.mjs` ~244 and ~318: `boxProblem` is the first problem found, so `dbDown` is true if ANY of the 3 boxes fails. One failed box then sends "the database is not answering".
   FIX: `dbDown: !dbUp || boxProblems.every(Boolean)`.
3. LOW `runner.mjs` ~232: the 5-minute outside watch runs 1 beat but opens 3 boxes. FIX: open `Math.min(READ_BOX_COUNT, list.length)`; update the box-count check in `prove.mjs` to expect the same.
4. LOW `runner.mjs` ~232-315: no try/finally around the boxes; a crash between open and close leaves up to 3 connections in an open read-only transaction. FIX: wrap the beats and close steps in try/finally that closes every opened box.
5. LOW `scripts/pulse/prove.mjs` ~551-553: `--read-delay` delays only the beat's own query, not the SAVEPOINT/RELEASE round trips, so it models about a third of a slow link. FIX: delay every round trip.

### Missing tests (add these)
- One of the three boxes fails to open: only its beats go red with an honest "db:" reason, and the text does NOT say the database is down.
- A slow first beat (a fake that takes 10.5 s): the other beats still run and finish, none is cut.
- A crash mid-run still closes every opened box.

### Acceptance for the next test
All of the above plus: `pulse:prove -- --beats` OK three runs in a row, and OK again with a fake 10.5 s `apply-links` and `--read-delay=120`. Pool worst case stays under 40 of 60 connections.
