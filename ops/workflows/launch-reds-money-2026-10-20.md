# Launch reds — Money lane (17 ids) — 2026-10-20

Owner: session `reds-money` (worktree `amazing-ptolemy-0b9044`). Parent board: main checkout
`ops/workflows/launch-100-2026-10-20.md`. Coordinator ships; this lane never runs `npm run ship`.

Source of the reds: today's `pulse_scorecards` row (2026-10-20, 13:02 UTC), read live, read only
(`BEGIN READ ONLY`, role `fundhub_app`).

Owner facts (2026-10-20): Braum FH-000507 is the only real client (no contact, no change). Every other
client, lead, booking and funding round is fake test data from the Oct 11-12 tests on production.

Classes: **A** real break → smallest fix + tests both ways. **B** red only from fake rows → no delete;
rows listed under "Needs Chris: delete fake data". **C** check aimed at an old screen → re-point, not weaker.

## Split

| Unit | Owner | Status |
|---|---|---|
| W1: 6 data checks + 2 Meta checks | this session | done (PR pending) |
| W2: 8 screen checks (catalog-display) | agent B | done (merged into PR #102) |
| W3: `catalog:hourly-proof-linked` | agent C | claimed |

No dependencies; all three run at once.

## The 17 ids

| # | Id | Day | Unit | Class | Status |
|---|---|---:|---|---|---|
| 1 | `meta-sync` | 9 | W1 | B | fake: 4 test Meta accounts (2026-10-12) with bogus tokens; real account fine → on delete list |
| 2 | `ads-number-unmapped` | 9 | W1 | B | fake: ads "AD", "Adspine numberless" on test accounts; 4 real ads all numbered → on delete list |
| 3 | `funding:round-stuck` | 6 | W1 | fixed | verified N/A live (`no-real-funding-round`), PR #97 shipped |
| 4 | `partners:commission-payable` | 8 | W1 | B | GREEN live 10-21 02:2x UTC after the fake referrals were deleted |
| 5 | `payments:invoice-stuck` | 8 | W1 | B | GREEN live after FH-000841's invoices were deleted |
| 6 | `payments:paid-product-unmapped` | 1 | W1 | B | GREEN live after the 2 test payments were deleted |
| 7 | `portal:paid-client-never-signed-in` | 12 | W1 | owner hold | the 1 is Braum FH-000507 (real, no-contact). Verified N/A `owner-hold-client`, re-checked every run; any other client stays red. Commit d39a27ae5 |
| 8 | `gap-underwrite:uw-pack-email-not-queued` | 9 | W1 | A | template EMAIL-U02 deleted by the Oct test run; restored byte for byte by seed/299. Commit 3594cdd47 |
| 9 | `catalog:hourly-proof-linked` | 7 | W3 | | pending |
| 10 | display: Mark funded (client-control-panel) | 7 | W2 | fixed | verified N/A live (no real round), PR #97 |
| 11 | display: Do task (financeos#next) | 7 | W2 | C | live button, never pressed → quiet until first wrong result (owner 10-14). GREEN in branch, PR #102 |
| 12 | display: I'm ready to get funded (financeos#next) | 7 | W2 | C | same as 11. GREEN in branch, PR #102 |
| 13 | display: Funded amount prompt (pipeline) | 7 | W2 | fixed | verified N/A live (no real round), PR #97 |
| 14 | display: Commission rule Close vN / open vN+1 | 7 | W2 | B | 2 test-fixture rules "MC …" (2026-08-21) → delete list, waiting on Chris's yes for non-client rows |
| 15 | display: Approve selected (commissions) | 7 | W2 | C | never pressed → quiet; also now red if an approved row lacks its receipt. GREEN in branch, PR #102 |
| 16 | display: Mark paid (commissions) | 7 | W2 | C | same as 15. GREEN in branch, PR #102 |
| 17 | display: soft-pull approve submit | 3 | W2 | B | fake consent on FH-000522 already deleted → GREEN live |

## Copy-paste prompts (if a unit must be re-run in its own session)

**W2 — screen checks.** "Fundhub repo, branch off origin/main. Money lane screen reds from the
2026-10-20 scorecard: the 8 `catalog-display:` ids listed in
`ops/workflows/launch-reds-money-2026-10-20.md` (rows 10-17). For each: read
`src/pulse/coverage/gap-catalog-display.mjs` and the catalog entry, run the check logic live and read
only (BEGIN READ ONLY, never bare SET on the 6543 pooler), list the exact result rows it judges, and
classify A (real break → smallest fix, tests pass and fail), B (red only from fake Oct 11-12 test rows
→ list rows, delete nothing), or C (check aimed at a screen the Astra CRM rebuild removed → re-point at
the current screen without weakening it). Braum FH-000507 is the only real client. No design changes,
no sends, no writes to live data. Commit on your own branch; report branch, commits and per-id class."

**W3 — hourly proof linked.** "Fundhub repo, branch off origin/main. The red
`catalog:hourly-proof-linked` says 86 customer or money tripwire surfaces lack an hourly beat. Read
`src/pulse/coverage/gap-catalog.mjs` (hourlyUncoveredSurfaces), `src/pulse/beats/index.mjs`,
`src/pulse/tripwires.mjs`. List all 86, group them, and close each by linking a real hourly
business-result beat that truly guards it, or by adding a read-only beat (rules in
`.claude/rules/heartbeat-on-every-build.md` items 11-14). Never attach an unrelated beat. Never weaken
the check. `npm run pulse:prove -- --beats` must say OK. Commit on your own branch; report branch,
commits, count before/after."

**W1 — data + Meta.** "Fundhub repo. Money lane data reds rows 1-8 in
`ops/workflows/launch-reds-money-2026-10-20.md`. Run each check live and read only, list the exact rows
behind it, classify A/B/C as above. Fake rows go to the Needs-Chris delete list on the parent board."

## Results

(filled in as each id closes)

## Needs Chris: delete fake data (money lane)

Chris said YES (2026-10-20). Session `delete-fake-data` is doing it. Exact ids: notes folder
`money-lane-fake-rows-2026-10-20.md` (sent to that session). Summary: 4 fake Meta accounts + 9 ads,
4 campaigns, 4 ad sets, 7 metric rows; 4 fake ad partners; affiliate AFF-000180 + 2 referrals;
7 invoices on FH-000841; 2 client-less test transactions (gauntlet-commas-1786606353567,
ORD-SYNTH-C18117792FFE); 2 rounds on FH-000691 / FH-000727.

## Change manifest

(filled in at the end)

## W3 result and the follow-on split (2026-10-21 ~03:30 UTC)

W3 (agent, branch `worktree-agent-aa5838507093130b0`, 8 commits on fce0573aa): `catalog:hourly-proof-linked`
85 → 62. New beats lead-handoff, lead-pipe, pay-links, bank-links, auth-links; money-operations covers the
billing sweeper; hiring desk moved to NOT_CUSTOMER_FACING (staff recruiting only). `pulse:prove -- --beats` OK.
Stopped because the hourly run (13 s beat window, 3 read connections) is near its limit. The agreed next step
on `ops/workflows/hourly-beats-capacity-2026-10-14.md` (option 3) is two scheduled hourly functions.

| Unit | Owner | Status |
|---|---|---|
| W4: split the hourly run into two scheduled functions (runPulse `only`) | agent | claimed |
| W5: beats for portal (6), money helper (3), money alerts (4), launch keys (3), lenders (1) | agent | claimed |
| W6: beats for soft pull + roadmap delivery (7), roadmap pages (2), built funnels (1), partner pages (3), records/consent/contracts (6) | agent | claimed |
| W7: beats for pipelines + sales floor (7), messages (4), inquiry (4), calls (2), repair + documents (9) | agent | claimed |

All four start from W3's branch. W5-W7 never edit the runner, pulse-hourly function or prove.mjs (W4 owns them);
they append to `src/pulse/beats/index.mjs` only. Merge order: W3 → W4 → W5/W6/W7, catalog regenerated at each merge.
