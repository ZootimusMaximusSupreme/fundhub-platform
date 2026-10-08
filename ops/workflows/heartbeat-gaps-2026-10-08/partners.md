# Partners gap checks — lane 14

Lane: affiliates, white-label, commission payouts.

File: `src/pulse/coverage/gap-partners.mjs`  
Test: `src/pulse/coverage/gap-partners.test.mjs`

Read-only. Does not pay anyone. Does not create a partner. Does not edit a page.

Tripwire is the existing Recon agent (AG-07). No second watchdog.

## What this does not repeat

Slice 17 (`slice-17-affiliates.mjs`) and slice 31 (`slice-31-affiliate-wl.mjs`) already watch the morning list and whether a monthly job has gone quiet. This lane does not check the registry, the machine list, or cron silence again.

## The four breaks

| Check | Pass | Fail |
|---|---|---|
| `partners:referral-link` | In the last 30 days no click that carried a live affiliate code went uncredited, every active affiliate has a code, and the start page (read from the live site) still records the click. A click with a code nobody holds is counted in the line and is not a fail. | A click carried a code an affiliate already held and was credited to nobody, an active affiliate has no code, the start page no longer records the click or is gone, or the click door is not routed. |
| `partners:commission-payable` | No one is stuck with earned money the payout rules say is payable. | Converted commission, signed license, tax form on file, at least $50, period already closed, and it is not on a pending, processing, or paid run. Held money with a missing license or tax form is allowed. Under $50 is allowed. |
| `partners:login-door` | `auth/login` is routed, and each active partner can sign in or there is no active partner. | Login route is gone, login no longer accepts a partner (when the source can be read), or active partners exist and none can sign in. Whether `/api/auth/login` answers on the site is already pinged by the pulse registry (`auth/login`), so it is not asked again here. |
| `partners:payout-stuck` | No affiliate or partner payout has sat in processing for more than 7 days. | A run is still processing after 7 days. |

No database or no org id in the run: each check is `skip` (the line says which), unless the click door or the login door is already missing. That is a fail with no database. A live site that cannot be reached is a `skip`, never a pass, and a real fail still wins over it.

A fail says to tell Recon. It does not pay the run and it does not mint a partner.

## Review — Claude, 2026-10-08

What was wrong:
- `partners:referral-link` was red in production: "2 referral clicks matched no affiliate". They are two test clicks (codes `AFF-TEST-20261006` and `TESTCODE`). The click door records an unknown code on purpose (its own header says so), because a typo or a probe is not a dead link. A check that fails on every unknown code is red for nothing and teaches Chris to ignore it. False alarm.
- The start page (`public/start.html`) and the login handler (`api/auth/login.mjs`) were read from disk. The shipped function has neither file. I built the lane the way the server ships it (one bundled file, no source tree). Result with Cursor's version: `referral-link` FAIL "the referral start page is missing" and `login-door` FAIL "the login handler is missing", every morning, while both work. The live site answers `GET /start.html` 200 with the click call in it.
- Demo affiliates were not left out of the commission check.
- The skip line said "no database" even when the org id was missing.

What changed:
- `referral-link` now counts a click only when it has no affiliate AND an affiliate already held that code when it landed (same `upper()` match the click door uses). Unknown codes are named in the PASS line ("2 clicks used a code nobody holds"). Blank codes on active affiliates still fail.
- The start page is read from the live site (`GET /start.html`) for what is in it. The pulse registry already pings `start.html`, `auth/login` and `public/affiliate-click` for uptime, so the login door is not asked a second time. The disk reads are only a fallback for a run with no site to ask. A site that cannot be reached is a skip, not a pass. A real database fail still wins.
- `commission-payable` leaves demo affiliates out.
- Skip lines say which piece is missing.
- 9 new tests. The 14 old tests were not touched and pass.

Not changed, written down: the commission and payout checks have nothing to look at in production today (3 referrals ever, 1 paid payout). The SQL runs clean against the real tables. `login-door` passes on "10 of 13 active partners can sign in"; the 13 are almost all test partners (`e2e-`, `sim-`, `principalread-`).

Live result after (read only, production): prod 4 PASS / 0 FAIL / 0 skip. Same lane from a bundle with no source tree: 4 PASS (Cursor's version in the same bundle: 2 PASS / 2 FAIL).

Tests: `node --test src/pulse/coverage/gap-partners.test.mjs` runs 23 tests, 23 pass, 0 fail.
