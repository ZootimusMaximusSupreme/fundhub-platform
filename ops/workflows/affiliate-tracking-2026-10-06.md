# Affiliate tracking — make it solid (2026-10-06)

Chris asked: "We need to ensure that affiliate tracking is setup real well!"

Status: **waiting for Chris's go.** No workflow starts until he says go.

## The chain

An affiliate gets paid only if every link in this chain holds:

1. **Click** — someone clicks the affiliate's link. We save the click and remember who sent them.
2. **Credit** — that person signs up or buys. The sale is tied to the right affiliate.
3. **Money** — the right commission is worked out (rates, tier 2, success fee share) and paid.
4. **Report** — the affiliate sees their clicks, signups and money in their portal. Chris sees it too.

One workflow per link. No hard dependencies — all four run at the same time.
Each workflow makes its own test data, tagged `test-affiliate-tracking-2026-10-06`.

## Tasks

| # | Link | Owner | Status |
|---|---|---|---|
| W1 | Click — capture and remember | this session | pending |
| W2 | Credit — signup / purchase tied to the affiliate | open | pending |
| W3 | Money — commission math and payouts | open | pending |
| W4 | Report — affiliate portal and owner view | open | pending |

## Shared rules for every workflow

- Read `CLAUDE.md` first. Model: Opus.
- Work in your own worktree: `.claude/worktrees/affiliate-tracking-wN` (never switch the main checkout's branch).
- Claim your row above (`claimed`) before you start. Write your manifest below when done.
- Read `docs/journeys/affiliate-intended.md` first. If code needs a step that is not in it, STOP and ask.
- Own only your link. Found a break in another link? One leftover card below, then keep going on yours. Do not fix it.
- Proof is live: a real click / signup / number on the live site, not just green tests.
- Never delete data. Test rows stay tagged.
- Update `docs/journeys/affiliate-actual.md` + `docs/journeys/CHANGELOG.md` for any flow you change.
- Commit locally every session. Push with `node scripts/github-push-whole-repo.mjs`. Ship once with `npm run ship`.

---

## Copy-paste prompts

### W1 — Click (this session)

```
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Read CLAUDE.md first.
Board: ops/workflows/affiliate-tracking-2026-10-06.md. Claim row W1 before you start.
Work in worktree .claude/worktrees/affiliate-tracking-w1.

You own ONE link of the affiliate chain: the CLICK.
Goal: when anyone clicks an affiliate link, we save the click and remember who sent them,
all the way to the signup or checkout page — including the ClickFunnels pages on
apply.fundhub.ai, across fundhub.ai <-> apply.fundhub.ai, on phone and desktop,
and after they leave and come back days later.

Start with: docs/journeys/affiliate-intended.md, api/public/affiliate-click.mjs,
src/affiliates/share-link.mjs, db/migrations/235_affiliate_link_clicks.sql,
public/affiliates/index.html, marketing/landing-pages/** (how ref is carried),
src/http/affiliate-click.pg.test.mjs.

Prove it live: make a test affiliate tagged test-affiliate-tracking-2026-10-06, click its
link in a real browser, and show the click row and the ref still present on the
signup/checkout page. Fix only what breaks in the click link. Breaks in credit, money or
report go on the board as one leftover card each. Never delete data.
Done = CLAUDE.md §6, manifest on the board, commit, push, ship once.
```

### W2 — Credit

```
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Read CLAUDE.md first.
Board: ops/workflows/affiliate-tracking-2026-10-06.md. Claim row W2 before you start.
Work in worktree .claude/worktrees/affiliate-tracking-w2.

You own ONE link of the affiliate chain: CREDIT.
Goal: when a referred person signs up or buys (Fundhub app signup, ClickFunnels checkout
webhook, any other door), the client record is tied to the right affiliate — first touch
vs last touch per docs/journeys/affiliate-intended.md, no double credit, no lost credit,
and an affiliate can never claim a client who was already someone else's.

Start with: docs/journeys/affiliate-intended.md, api/affiliates/refer.mjs,
src/workflows/af-02-referral-ownership-capture.mjs, src/workflows/ds-01-repair-referral.mjs,
db/migrations/237_affiliate_referral_lookup_index.sql, db/migrations/340_client_light_affiliate.sql,
the ClickFunnels webhook handler (grep for it), src/http/affiliate-referral.pg.test.mjs.

Prove it live: a test affiliate tagged test-affiliate-tracking-2026-10-06, a test signup
through its link, and show the client row owned by that affiliate. Fix only what breaks in
the credit link. Breaks in click, money or report go on the board as one leftover card each.
Never delete data. Done = CLAUDE.md §6, manifest on the board, commit, push, ship once.
```

### W3 — Money

```
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Read CLAUDE.md first.
Board: ops/workflows/affiliate-tracking-2026-10-06.md. Claim row W3 before you start.
Work in worktree .claude/worktrees/affiliate-tracking-w3.

You own ONE link of the affiliate chain: MONEY.
Goal: once a client is credited to an affiliate, the commission is right — the owner-set
rates (migrations 260, 261, 272, 399), tier 2 chain, success fee share, refunds and
chargebacks — and payouts run with the right amount to the right person.
Money is integer cents via src/commissions/money.mjs; NULL means unknown, never 0.

Start with: docs/journeys/affiliate-intended.md, src/affiliates/economics.mjs,
src/affiliates/payouts.mjs, src/workflows/affiliate-payout-run.mjs,
src/affiliates/two-tier-chain.pg.test.mjs, src/affiliates/success-fee-share.pg.test.mjs,
e2e/affiliate-commission.spec.mjs.

Prove it: the pg tests green against a real database, and one live test client tagged
test-affiliate-tracking-2026-10-06 showing the right commission row. Do not send a real
payout. Fix only what breaks in the money link. Breaks in click, credit or report go on the
board as one leftover card each. Never delete data.
Done = CLAUDE.md §6, manifest on the board, commit, push, ship once.
```

### W4 — Report

```
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Read CLAUDE.md first.
Board: ops/workflows/affiliate-tracking-2026-10-06.md. Claim row W4 before you start.
Work in worktree .claude/worktrees/affiliate-tracking-w4.

You own ONE link of the affiliate chain: REPORT.
Goal: an affiliate logs in and sees true numbers — clicks, signups, sales, commission owed,
paid — that match the database row for row. The owner view of affiliates matches too.
An affiliate sees only their own data.

Start with: docs/journeys/affiliate-intended.md, docs/rules/UI-STANDARDS.md,
public/app/affiliate.html, api/read/affiliate-portal.mjs, api/read/affiliates.mjs,
src/http/affiliate-stats.pg.test.mjs, src/http/affiliates-self-read.test.mjs,
src/http/affiliate-screen.test.mjs.

Prove it live: log in as a test affiliate tagged test-affiliate-tracking-2026-10-06, compare
each number on screen to a database count, marked-up screenshot per CLAUDE.md §8.
Fix only what breaks in the report link. Breaks in click, credit or money go on the board as
one leftover card each. Never delete data.
Done = CLAUDE.md §6, manifest on the board, commit, push, ship once.
```

---

## Shared context brief

(empty — each workflow grounds its own link)

## Manifests

(none yet)

## Leftover cards

(none yet)

## Blockers / open questions

(none yet)
