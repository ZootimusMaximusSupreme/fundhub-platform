# Customer messages reds — 2026-10-20

Owner of this board: the reds-messages session (worktree `nice-borg-89d060`, branch `claude/nice-borg-89d060`).
Parent board: `ops/workflows/launch-100-2026-10-20.md` (coordinator). Source list: the 6:02 a.m. scorecard, Customer messages section (22 ids).

Split: one lane, this session. Two read-only helper agents dug the message rows and the calls/consent rows; this session owns every fix. No dependencies on other lanes except the fake-data delete (session `delete-fake-data`) and the coordinator's ship.

Every result below was read live, read-only (`BEGIN READ ONLY`, role `fundhub_app`, staff actor like the pulse), on 2026-10-20 evening Arizona time.

## Result per id

| # | Id (short) | Class | Live now | Why / proof |
|---|---|---|---|---|
| 1 | `email:sending-stuck` | B, already cleared | GREEN | The stuck email was a test row; the Set B delete (2026-10-20) removed it. Lane run: "no outbound email on sending longer than 15 minutes". |
| 2 | `gap:sms-sending-stuck` | B, already cleared | GREEN | Same delete. Lane run: "No customer or staff text is stuck on sending". |
| 3 | `email:provider-fail` | C, fixed in this PR | GREEN with PR | Both bounces were sign-in links to the App Store review login FH-000844 (client@fundhub.ai, no mailbox, Resend blocks it). Check now skips that one login. |
| 4 | `msg:per-template-path` | C, fixed in this PR | GREEN with PR | Same two bounces were the only email in 7 days. Same fix. |
| 5 | `handoff:lead-first-touches-missing` | A + B | GREEN (after delete) | Real: 7 lead templates were deleted on live (finish-application email + 6 never-booked chase messages). Restored on live by migration 497 (PR #112, 2026-10-21 03:44 UTC), byte for byte the same words this lane had prepared, so this PR no longer carries its own copy. The red row itself is fake lead FH-000843 → delete. |
| 6 | `consent:dispute-required` | Needs Chris | red | The 1 row is Braum (FH-000507): repair program active since 10-05, no signed agreement of any kind, no consent row. Braum is no-contact / no-change. |
| 7 | `calls:booked-no-join-link` | C, fixed in this PR | GREEN with PR | Set A (PR #97, live) saves the Google Meet link on new bookings. The check still judged old bookings, which can never carry a link (19 August ClickFunnels bookings with real-looking emails stay; the delete session kept them). Owner: "Old bookings do not matter. Only new bookings." The feed now counts from the fix's ship (2026-10-21 01:38 UTC); a call ahead with no link is still red. Live: PASS. |
| 8 | Closer desk: Send contract button | fixed by Set A | GREEN | Migration 493 (PR #97) put the real Funding and Credit Repair agreement words live. 12 wordings, 0 bad. |
| 9 | Closer desk: Contract panel blanks | fixed by Set A | GREEN | Demo client contract no longer counted. 0 results, quiet. |
| 10 | Closer desk: Contract panel Send | fixed by Set A | GREEN | Same. |
| 11 | Chat widget launcher (desks-b) | fixed by Set A | GREEN | Owner-ops text left out. 3 results, 0 bad. |
| 12 | Consent: call_recording | fixed by Set A | GREEN | Judges the signed agreement (owner rule). 1 result, 0 bad. |
| 13 | Consent: marketing_use | fixed by Set A | GREEN | Same. |
| 14 | Consent: history / Withdraw | fixed by Set A | GREEN | Quiet until the first withdrawal. |
| 15 | Chat widget on every desk (desks-c) | fixed by Set A | GREEN | Same as 11. |
| 16 | Messaging: Send button | C, fixed in this PR | GREEN with PR | The one bad row was an owner-ops text to Chris's own phone (2026-10-07). Staff-reply check now skips `owner-ops:` like the widget check. |
| 17 | Pipeline: New Client | B | GREEN (after delete) | Fake lead FH-000843 (made 10-17 from the New Client button; no welcome because the templates were gone). |
| 18 | Pipeline: pipeline-clients (server) | B | GREEN (after delete) | Same row. |
| 19 | Chat widget: Message > Client | C, fixed in this PR | GREEN with PR | Same as 16. |
| 20 | Present deck: Send contract | fixed by Set A | GREEN | Real agreement words live; the fake Sim contract is not counted. 1 result, 0 bad. |
| 21 | Social Studio: Queue it | B | GREEN (after delete) | Queued row `60735863-198a-402e-9cf7-5204bef5c93f` of "DEMO Partner — Northlight Capital" (marked demo). |
| 22 | Social Studio: Approve it | B | GREEN (after delete) | Post `ca70eef7-d5e4-431f-b61b-309240342b03`, one of 10 test posts made 2026-10-12 18:12 UTC for test partners clean/blocked/croa/unscreened/hold/holddue/holdgate/nohold/publish/failing. |

Count (re-read live 2026-10-21 ~02:30 UTC, after the fake-data delete removed FH-000843, its events and the social test rows): 16 green now · 5 green once this PR ships (3, 4, 7, 16, 19; each reads green live with this branch's code) · 1 Needs Chris (6).

## Needs Chris: delete fake data (rows behind my reds)

Owner said yes (2026-10-20). Handed to session `delete-fake-data`. Do NOT delete FH-000844 (App Store review login; ship.yml fails without exactly one).

- FH-000843, client `04057188-872a-4351-8a7c-92fa64711978`: events `bca9d567-2266-41a3-b9b4-b3486d49a541` (entry.captured) and `fe796caf-940a-4076-b97e-3be0d81d605c` (message.queued) first, then its Sales card, then the client.
- Fake booking events (ClickFunnels, Aug 12–22, and FH-000567's two from 10-10). 24 of 26 have no client id.
- Social: the 10 Fundhub `social_posts` rows from 2026-10-12 18:12 UTC and their test partners; `marketing_content_queue` `60735863-198a-402e-9cf7-5204bef5c93f`.
- Keep: messages row `5c413fad-40d0-40af-ba9d-128eab2e97aa` (real owner text to Chris).

## Needs Chris (one decision)

- `consent:dispute-required`: Braum's repair file has no signed agreement. You said leave Braum alone. Keep this one red as a known Braum item, or get his signature? (No skip code exists for "owner left this client alone".)

## Leftovers (not fixed here)

- URGENT, reported to the coordinator: 5 timed jobs stopped at 01:20 UTC and had not run by 01:55 — message-dispatch-sweeper (sends every queued text and email), meet-transcript-sweeper, blake-lead-watch, next-action-catch-up, pulse-instant-watch. Other timed jobs ran. 0 messages were queued.
- client@fundhub.ai (App Store review login) is on Resend's block list. An email sign-in link to it can never arrive. If App Review signs in by email link, it fails.
- CONTRACT-REMIND-EMAIL is also gone from live (same delete). Not on my list.

## Change manifest (this PR)

- `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs`: STAFF_MESSAGE_SQL skips `owner-ops:` texts.
- `src/pulse/catalog/proofs/fin-b04-display-fixtures.mjs`: ignored case for it.
- `src/pulse/coverage/gap-msg.mjs`: `ROLE_TEST_CLIENT_KEY`; `real()` skips the review login.
- `src/pulse/coverage/gap-email.mjs`: PROVIDER_FAIL_SQL skips the review login.
- `src/pulse/coverage/gap-msg.test.mjs`, `gap-msg.pg.test.mjs`: tests both ways.
- `src/pulse/coverage/gap-calls.mjs`: `JOIN_FEED_SINCE`; the feed question counts bookings from the link fix's ship. `gap-calls.test.mjs`: tests both ways.
- `src/pulse/catalog/generated.json`: regenerated.
- `docs/lessons/pulse-lessons.md`: 3 entries.
- No route, job, page, money rule or journey changed.
