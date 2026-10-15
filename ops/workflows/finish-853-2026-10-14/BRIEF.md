# Finish the 853 — shared brief (read this first)

Owner order, 2026-10-14: every one of the 853 rows that still say NOT_PROVED gets a real check, ranked money first.
Chris wants LIVE DEEP CHECKS: a check that reads the real saved result on the live server and goes red when a real
customer's result is wrong. A practice test with fake data is the second best thing. Never call a practice test
"deep" or "proof" in what you hand back. Say "live check" or "practice test".

## The four lanes (offline, one function each: `gapChecks`)

| Lane file | Rows | A row leaves NOT_PROVED when |
|---|---|---|
| `src/pulse/coverage/gap-catalog-display.mjs` | screen controls | it has a contract (see "Display rows") |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | routes | a real handler test is attached through `src/pulse/catalog/proofs/door-proof.mjs` |
| `src/pulse/coverage/gap-catalog-flow.mjs` | message / journey flows | a flow recipe or inactive-template read judges it |
| `src/pulse/coverage/gap-catalog-reads.mjs` | page reads | a safe result probe or attached read test judges it |

Measure: `node scripts/pulse/count-not-proved.mjs out.json` prints `{total, byLane}` and writes the open ids.
It runs offline (no database, a stub fetch). Your batch is done when your ids no longer appear, or each one
left is a justified `not-attachable`.

## Display rows: two ways, prefer the first

1. LIVE CHECK. Add a query contract to the registry `src/pulse/catalog/proofs/display-saved-result.mjs`
   (`DISPLAY_RESULT_CONTRACTS`, keyed by the exact `control` text; it must be unique). The SQL is read only, takes
   `$1::uuid` (the company) and returns `sample_count` and `bad_count`: how many saved results exist and how many
   are wrong. Read real tables: `events`, status columns, receipts, the rows the control writes.
   A control nobody has used yet has no results. For these set `emptyAs: "quiet"` on the contract: with 0 results
   the row is green "no saved results yet, none are wrong" and it goes red on the first wrong one. The base
   branch already supports `emptyAs` (see `judgeDisplayResult`). Money controls that MUST have results (a funded
   round, a payout) may leave `emptyAs` off, so a missing result is red.
   Never write SQL that cannot go red. Never count rows without judging a field of them.
2. PRACTICE TEST. Attach a fake-data test through a proof file like
   `src/pulse/catalog/proofs/display-contracts-money-2.mjs` and the chain in `display-proof-cases.mjs`. Same
   rules as the earlier rounds: read `ops/workflows/not-proved-slices-2026-10-14/manifest-s1.md` to `s5.md` first.
   They list the exact files, the shared lists to edit, the guard numbers, and the traps found.

After editing any source for the catalog run `npm run pulse:catalog` and commit the regenerated
`src/pulse/catalog/generated.json`. The integrator recompiles it after merging, so a conflict there is expected.

## Honest outcomes. Every row ends in exactly one:

- `live-check`: a query contract (or live GET read) that reads real saved data and can go red. Say which file.
- `practice-test`: a fake-data test attached and mutation-verified. Say which test.
- `na-verified`: genuinely nothing to judge (retired page, inbound-only). Needs a verified N/A code. Rare.
- `not-attachable`: you looked and it cannot be done without a product change (the control leaves no trace and
  has no readable result). Say exactly what is missing. This is a finding, not a failure. Do not fake it.
  A fresh agent will challenge your reason, so make it exact.

## Rules that never bend

- Work in your own worktree: `git worktree add .claude/worktrees/fin-bNN -b fin/bNN fin/base` (retry if git is
  locked by a sibling). Symlink `node_modules` from the main checkout, and delete that symlink before you commit.
  Never `git add -A`. Add named paths only. One or a few commits on your branch. Do not push. Do not merge.
- Never switch the branch of the main checkout. Never touch the main checkout's files. Everything happens in
  your worktree. The only things you may read from the main checkout are this folder and `ops/workflows/`.
- SQL is read only. Never run anything that writes to the live database. Never run `.pg.test.mjs` against
  `DATABASE_URL` from `.env` (production). Use stand-in rows. There is no local Postgres on this Mac.
- Never print, copy, or commit a secret, a key, an email or a phone number. Never build a secret-shaped string
  (no `sk_live_`, `re_...`, `AC...` literals) in a tracked file or test. Build such strings from parts at run time.
- Never weaken, skip, or delete a test. Never edit an applied migration. Never touch `.env` or `credentials/`.
- Never edit `docs/journeys/*-intended.md`. If you add a step to a flow, stop and say so.
- Do not fix product bugs you find. Write each one as one line in your manifest ("product finding").
- Spell the company Fundhub. Texts and emails are not yours to send. Nothing goes outside this repo.
- Shared lists (module lists, tripwire map, guard counts, `generated.json`, `door-proof.mjs` chain,
  `display-proof-cases.mjs` spreads, `na-conditions.mjs`): make the smallest possible edit and name every
  line in `sharedFiles`. Put all new logic in NEW files named `fin-bNN-*.mjs` next to what they extend.
- Every new check needs a test that is red when the product is wrong. Break the product (or the SQL) on
  purpose, see it go red, put it back. A test that stays green when the product breaks is not allowed.

## What to hand back

Commit a manifest at `ops/workflows/finish-853-2026-10-14/manifest-bNN.md` on your branch: the table of every
row id and its outcome, the files you added, the shared lines you touched, the product findings, the numbers
(`openBefore`, `openAfter` from the count script), and the commands you ran with their results.
