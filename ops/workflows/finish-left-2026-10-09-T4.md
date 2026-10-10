# T4 — climate page copy test and edit-ops tests (2026-10-09)

Builder: T4. Branch: `fix/T4-2026-10-09` (cut from `main` at e58704577). Not pushed. Not shipped.

## Result in one line

2 of 3 tests fixed (a stale test number). 1 of 3 is a BLOCKER for Chris: the
fix is an edit to a live page file, and the rules say a live page is not
edited before Chris sees a marked draft.

| # | Test | Status |
|---|---|---|
| 1 | `src/http/climate-match.test.mjs` "climate page: no approval odds, no promised amount, no guarantee" | STILL RED. Blocker. Exact change proposed below. |
| 2 | `src/repo/edit-ops.test.mjs` "registry_add_ad" | FIXED (stale test number) |
| 3 | `src/repo/edit-ops.test.mjs` "dispatch and checks" | FIXED (same cause as 2) |

## 1. Climate page — what is wrong, and the exact change for Chris

**What the test catches.** The page at `/climate/` shows the words
"Approval Odds". The owner's rule (written in
`docs/journeys/climate-lead-magnet-intended.md`, "What this page must never
say") bans a percentage chance of being approved, and the test enforces it.

**Where the words are.** One place only. Every other banned phrase passes.

- File: `public/climate/_next/static/chunks/375-9c2ed26a6c945538.js`
  (a built Next.js file, one line, the "States" table).
- Only `public/climate/index.html` and `public/climate/index.txt` load it.
- It is a live public page file, so I did not edit it
  (`.claude/rules/page-edits-marked-draft.md`).

**Why it is there.** The Darwin dashboard shipped on 2026-09-18
(`8547bb72a`, rebuilt in `f8919781c`) with a "States" table that has an
"Approval Odds" column. That column is not new: it was in the first shipped
file too (`375-633165e8a69d3882.js` in `8547bb72a`). The test has been red on
purpose since 2026-10-05 (see the comment above the test) and the boards
already call it "owner call" (`ops/workflows/marketing-machine-2026-10.md`,
`ops/workflows/e2e-marketing-machine-2026-10-06-scorecard.md`). No recent edit
introduced it.

**What the column shows today: nothing real.** On 2026-09-16 the data feed
stopped sending per-state approval odds on purpose (`35273b92`;
`src/climate/engine.test.mjs` "state score is macro only — no fake approval
rollup" holds that). Live check, a GET of `https://fundhub.ai/api/climate`
today: 51 states, none has `avg_approval_odds`. So the page code falls to its
"—" branch and every row of that column is a dash. The "Issuance" column next
to it is also all dashes (leftover below).

**The exact change (a removal, no new words).** In the one file above, delete
these two strings, each appears once:

1. the header cell
   `(0,n.jsx)("th",{children:"Approval Odds"}),`
2. the matching row cell
   `(0,n.jsx)("td",{children:void 0!==e.avg_approval_odds?"".concat(Math.round(100*e.avg_approval_odds),"%"):"—"}),`

The table goes from 6 columns to 5 in both the header and the rows, so it
stays square.

**Proof the change works (run on a COPY in the scratchpad, repo untouched).**

- Both strings found exactly once. 156 bytes removed.
- `node --check` on the changed file: parses clean.
- The test's own 10 banned patterns, run over `index.html` plus every script
  it loads: 0 matches after the change. Before the change: 1 match
  (`/approval\s+(odds|chance|probability)/i`).
- States table cell counts after: 5 header, 5 row.

**The decision only Chris can make** (the test file itself says "the owner's
call, not a test edit"):

- A. Take the dead column off the page (the change above). The test goes
  green. Nothing real is lost. Needs a marked draft first, then push, then
  proof of the live page.
- B. Keep the column. Then the compliance test has to change, and the owner's
  own "never say" list has to change with it. I do not recommend this.

I have not touched the test or the page for #1.

## 2 and 3. edit-ops tests — what was wrong

**Root cause: a stale test number, not a code bug.**

The `registry_add_ad` tests add a "new" ad to the REAL
`marketing/ads/registry.json` and typed in ad number `91`, `92` and `93` by
hand. On 2026-10-08, commit `ae3c014cd` ("marketing: ad registry entries...")
put a real ad 91, "The Conveyor Belt", lane `sorting`, into that file. After
that, the code did the right thing and refused:
`ad 91 is already in marketing/ads/registry.json with a different lane or title`.

That one cause failed 4 sub-tests:

- `registry_add_ad` > "adds the ad with gate, entry and offers..."
- `registry_add_ad` > "the same ad twice is a no-op; a different ad under a used number is refused"
- `registry_add_ad` > "refuses invalid JSON and a registry that fails parseRegistry"
  (it got the "already in" error where it wanted "would not load")
- `dispatch and checks` > "pure: the same input gives the same output..."

**Proof which side is stale (code or fixture).** Same call, `registry_add_ad`
id 91, run through the real `applyEdit`:

- on the registry as it was before `ae3c014cd` (ids 16 to 83, no 91): added fine
- on the registry now (has 91): refused with the message above

The code refusing to overwrite a real ad is the behavior the test itself
asserts. So the code is right and the test number is stale.

## What changed

One file: `src/repo/edit-ops.test.mjs`.

- Three constants, `NEW_ID`, `NEW_ID_2`, `NEW_ID_3`, always one, two and three
  past the highest ad number in the live file. A comment says why.
- Every typed `"91"`, `"92"`, `"93"` in the `registry_add_ad` tests and in the
  "pure" test now uses them. The `"9a"` (bad id on purpose) is unchanged.
- No assertion removed, skipped or loosened. Same checks, a number that cannot
  collide. 92 and 93 were next in line to collide the same way.

No source file changed. No test deleted, skipped or weakened.

## Proof

- `node --test src/repo/edit-ops.test.mjs`: 41 tests, 41 pass, 0 fail
  (was 37 pass, 4 fail).
- Test still bites: I made `registryAddAd` quietly accept a duplicate id, the
  suite failed on "the same ad twice is a no-op; a different ad under a used
  number is refused", then I put the file back (`git checkout`). Final diff
  touches the test file only.
- Neighbours that import what I touched, all green, 156 of 156:
  `src/repo/*.test.mjs`, `src/ads/registry.test.mjs`,
  `src/marketing/funnel-paths.test.mjs`, `scripts/ship.test.mjs`,
  `scripts/netlify-ignore-machine-only.test.mjs`,
  `src/messaging/providers/github-repo.test.mjs`.
- `npm run lint`: 3217 files parse clean.
- `src/http/climate-match.test.mjs`: 1 red (#1), the other tests in that file
  still pass.

## Risk

None for #2 and #3 (test file only). For #1 nothing changed in the repo.

## Leftovers (seen, not touched)

1. The same "States" table has an "Issuance" column that is all dashes today
   (the feed also stopped sending `issuance_velocity`). It is in the same
   file and rendered by the same row code. Not a test failure. Chris may want
   it off the page in the same marked draft as the "Approval Odds" column.
2. The same page has a call-to-action, in the same chunk file: heading "See
   Your Personalized Funding Odds", text "Upload a credit report to get
   tailored approvals and appetite signals." Its button points to `#`. The
   test's banned list does not match it (it says "Funding Odds", not
   "approval odds"), so it passes. It is the same kind of claim the owner
   banned, so it belongs in the same marked draft.
3. `docs/journeys/climate-lead-magnet-intended.md` and
   `src/http/climate-match.test.mjs` cite an offer brief
   `marketing/ads/climate-lead-magnet-offer-2026-09-18.md` (or under
   `docs/ads/`). That file is not in the repo, and no commit ever added a
   file by that name. The ban list is in the intended journey doc instead, so
   I used that.

## Next

Chris picks A or B for #1. If A: the marked draft, then push, then prove the
live page.
