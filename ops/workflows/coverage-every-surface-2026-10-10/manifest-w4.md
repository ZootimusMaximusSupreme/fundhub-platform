# W4 Messages truth — manifest

Branch `cov/w4-messages`, in the folder `.claude/worktrees/cov-w4`. Not pushed. Not merged. The shared board was not edited.

## The short answer

- I built **10 new daily checks**. They read what customers actually got by text and email.
- All 10 are read only. They send nothing. They write nothing.
- On live data today, **none is red**. Nine are green. One says "nothing to judge" and is re-checked every morning.
- `npm run pulse:prove` says **OK**. The self-audit saw all 1037 expected checks and all 45 lanes.
- 17 surfaces left the "not sorted" list. The list went from 494 to 477.

## What each check asks

One yes-or-no question each. Lane file: `src/pulse/coverage/gap-msg.mjs` (9 checks) and `src/pulse/coverage/gap-alerts.mjs` (1 check).

| Id | The question | Red when | Looks back |
|---|---|---|---|
| `msg:sent-body-blanks` | Did a message that left, or is about to, have an empty spot? | a `$` with no number, two spaces where a value belongs, a leftover `{{ }}`, the words placeholder / lorem ipsum / [DRAFT], or `Hi ,` with no name. One row per template. | 24 hours |
| `msg:staff-template-to-client` | Did a message written for staff go to someone who is not staff? | one of 5 named staff templates, or any copy that says "internal alert", went to an address that is not on the staff list | 7 days |
| `msg:links-in-body` | Does every link in a sent message point at us, and open? | a blank link, a host not on the list, or one of our pages that answers 404, 410 or 5xx | 24 hours |
| `msg:per-template-path` | Does each template reach an inbox? Does each event make its email? | a template has 2 or more old rows and none delivered, or an event should have made an email and did not | 7 days |
| `msg:brakes` | Did a send go past the pause switch, past the daily cap, or twice? | a send after the switch was turned off, a day over the cap, or the same text to the same phone twice inside 24 hours | 3 days |
| `msg:dead-senders` | Did anything queue a template that nothing is supposed to send? | one of 158 listed templates was queued. Otherwise it says "nothing to judge" with the code `no-sender`. | 7 days |
| `msg:owner-alerts-unsent` | Is an owner alert text still queued with nobody to send it? | a row queued over 1 hour with no sender, or failed | all time |
| `msg:hiring-outreach-blocked` | Is candidate outreach stuck at the gate? | blocked as `recipient_unknown`, or queued over 1 hour | all time |
| `msg:help-reply` | Did a person who texted HELP get a text back? | a HELP older than 30 minutes with no text of ours to that number inside 24 hours | 7 days |
| `alerts:texts-went-out` | Did the file-protection alert text and the card-due reminder text go out? | a queued alert whose message is gone, failed, held or stuck; or a reminder the job owed with no text | 3 days |

Brief item 6 (dead senders) had three parts. I made them three rows so each has an honest status. `msg:dead-senders` is the templates. `msg:owner-alerts-unsent` and `msg:hiring-outreach-blocked` are the other two.

### How the check works, in plain words

- **Test traffic is left out.** Demo clients, synthetic clients and test addresses do not count. Same rule as `gap-sms.mjs`.
- **A read that fails is a skip.** It says why. It is never a PASS.
- **The link check is careful.** It only opens pages on `fundhub.ai`. It strips the person's token off first. It never opens an `/api/` door. It uses HEAD, and GET only if a page refuses HEAD. Cap: 30 pages, 6 at a time, 5 seconds each, 10 seconds in all.
- **Allowed link hosts:** `fundhub.ai` (and any subdomain), `fanbasis.com`, `meet.google.com`. To allow another, add it to `ALLOWED_LINK_HOSTS` in `gap-msg.mjs`.
- **The dead list is data**, in `src/pulse/coverage/msg-dead-templates.mjs`. 118 have no sender, 23 are doc-source copy, 17 are retired. When someone builds a sender for one, remove the key from that file in the same change.
- **Lane time:** `gap-msg` about 1.9 seconds, `gap-alerts` about 0.4 seconds on live data. Limit is 20.

## Files

New:

- `src/pulse/coverage/gap-msg.mjs`, `gap-msg.test.mjs` (41 tests), `gap-msg.pg.test.mjs` (12 tests, real Postgres)
- `src/pulse/coverage/gap-alerts.mjs`, `gap-alerts.test.mjs` (13 tests), `gap-alerts.pg.test.mjs` (3 tests, real Postgres)
- `src/pulse/coverage/msg-dead-templates.mjs` (the 158 keys)

Changed (each one is a shared file, my lines only):

- `src/pulse/coverage/modules.mjs` — 2 lines (the two lanes).
- `src/pulse/tripwires.mjs` — 8 entries in `TRIPWIRES`, 9 in `NOT_CUSTOMER_FACING`.
- `src/pulse/tripwires-baseline.json` — 17 lines removed.
- `src/pulse/tripwires.test.mjs` — `BASELINE_MAX` 494 to 477.
- `src/pulse/na-conditions.mjs` — one new lane code, `no-sender`.
- `src/pulse/na-conditions.test.mjs` — the closed list is now ten codes, and `no-sender` is in each lane-code loop.
- `src/lib/no-unfenced-transmit.test.mjs` — `gap-msg.mjs` on `ALLOWED_RAW_FETCH` with the same reason the other gap lanes use (read-only HEAD and GET of our own pages).

Not touched: `gap-keys.mjs`, `self-audit.mjs` (the ids ride on each lane's `CHECK_IDS`, which the audit already reads), `beats/index.mjs`, the board.

## What I sorted off the baseline (17)

Money or customer, with a deep check:

| Surface | Checks that go red on its break |
|---|---|
| `route:messages-outbound` | `msg:brakes`, `msg:per-template-path`, `msg:sent-body-blanks`, `msg:links-in-body` |
| `desk:messaging.html` | `gap:msg-inbound-unmatched`, `gap:sms-sending-stuck`, `msg:brakes`, `msg:staff-template-to-client` |
| `desk:ops-admin.html` | `msg:brakes`, `msg:per-template-path`, `msg:sent-body-blanks` |
| `route:money/alerts`, `desk:money-alerts.html`, `job:blueprint-finance-os-alerts`, `job:finance-os-card-due-reminders` | `alerts:texts-went-out` |
| `send:src/metro2/delivery/send.mjs` | `pipeline:repair`, `repair-case-stuck` (the paper letter has no read of its own; a file stuck at ready-to-send or in transit is the closest tripwire) |

Not customer facing, with a written reason: the Chris-only sends (`teleprompter-live-text`, `ad-videos/notify-fanout`, `pulse/instant-watch`, `pulse/notify`, `staff/blake-lead-watch`, `workflows/ad-video-sweeper`), the staff-only sends (`auth/staff-mail`, `staff/comp-alerts`), and `push/send.mjs` (dead today: only a test script calls it).

## What was proved

- `node --test` on the files I touched: gap-msg 41, gap-alerts 13, tripwires 7, na-conditions 35, modules 4, self-audit and gap-sms pass, fence tests pass. **0 failing.**
- Real SQL on Postgres, read only, shadow tables, rolled back: gap-msg 12 of 12, gap-alerts 3 of 3. Run with `DATABASE_URL` set. Without it they skip, like every `.pg.test.mjs`.
- I broke the code on purpose 9 ways (dollar rule, HTML spaces, minimum rows, 24-hour window, staff exemption, cap compare, 404 rule, "always true" nothing-to-judge, own-line HELP). Tests caught all 9.
- `npm run lint`: 3232 files parse clean.
- `npx tsc --noEmit`: 1 error, `src/marketing/filmed-receive.mjs(159,75)`. Not mine. Same on main.
- `npm run pulse:prove`: **OK**. 48 steps, none over 20 seconds, no SQL error, nothing tried to write, no row read differently by the app role and staff scope.
  - `audit:expected-present`: all 1037 checks that should run showed up.
  - `audit:lanes-ran`: all 45 lanes answered.
  - `audit:na-verified`: all 62 "nothing to judge" rows are still true. That includes `msg:dead-senders`, re-read through the real lane door.
- `npm test` (whole suite, no database): 3 failures, none from my change.
  - `fence: nothing reaches the network...` was mine. Fixed with the `ALLOWED_RAW_FETCH` line.
  - `climate page: no approval odds...` fails on `main` too. Not mine.
  - `registry: every registry row names a real handler or desk file` fails only in a fresh worktree. A git-ignored page (`public/leads/...`) is missing there. It passes on `main`.

## Live reds found

None red today, on live data, inside the windows.

Looking back past the window (not red now, written here so it is not lost):

- `EMAIL-S02-FINISH-APPLICATION`: 8 queued, 0 delivered (3 sent with no receipt, 5 failed), Sep 27 to Oct 1.
- `EMAIL-PORTAL-MAGIC-LINK`: 4 queued, 0 delivered (1 sent with no receipt, 3 bounced), Sep 28.
- `https://fundhub.ai/eeo-survey.html` answers **404** right now. The EEO invite email links to it. `msg:links-in-body` goes red the first day one is sent. (The board already lists this page as missing.)

No message in the whole table has an empty spot (377 messages scanned). Nothing was ever queued from a dead template. No staff template ever went to a non-staff address.

## Choices I made

- **158 dead templates, not 192.** The board says 141 have no sender and 51 are retired. I could not get 192 from `messages.json`. Its trigger lines say "no sender" for 118, "doc source copy" for 23, and "retired / dormant" for 17. That is 158, and it matches the board's own "158 dead message templates" line. I listed a key only when its row says one of those three things. A template that has a sender is never called dead.
- **Per-template path is two reads.** (1) For every template: 2 or more old rows and none delivered is red. This covers every template that sent mail, with no hand list. (2) Five event steps that make one email every time (welcome, booking confirm x2, round submitted, round approved) are checked event by event. The text twins of those steps are already read by the gap-sms journey row, so I did not read them twice.
- **Pause time is the settings update time.** The app keeps no history of the switch. If someone changes the cap while paused, the time moves forward and a send before that is not counted.
- **A silent channel is said once.** If a whole channel has zero delivered in 7 days, the row says so one time. It does not list every template.

## Known limits (said plainly)

- `EMAIL-COMMISSION-PAID` goes straight to Resend and writes no `messages` row. The staff-template check cannot see it. The text half (`SMS-DEAL-CLOSE-WIN`, `SMS-S04C-STAFF-BOOKED`) is seen.
- If the phone company answers HELP by itself, that reply is not in our table, so the HELP row would go red for it. Nothing in our code answers HELP today, so I read the red as true.
- A conditional email (the no-show chase, the offer emails) is judged only by "queued and never delivered". Its "trigger fired and nothing queued" half needs the stop conditions of each workflow. I did not guess them.
- No hourly beat. The brief did not ask for one. The daily lane reads once at 6 a.m.

## For whoever merges

- `tripwires.test.mjs` `BASELINE_MAX` is a single number. Every workflow lowers it. After the merge set it to the real length of `tripwires-baseline.json` (494 minus every removed line).
- `na-conditions.test.mjs` has an exact list of codes in three places. If another workflow adds a code, keep both.
- `modules.mjs`, `tripwires.mjs` and `tripwires-baseline.json` are lists. Take both sides.
- The two new lane files own their ids. They do not touch `route:pipeline-cards`.

## Board card candidates (do not fix here)

These already sit on the board. I only note which check now watches each one:

- Staff alert emailed to the client (`EMAIL-DPC05-NO-PROGRESS-72H`) → `msg:staff-template-to-client`.
- Blank merge spots in live emails (funding locked, ID link, no-show time) → `msg:sent-body-blanks`.
- `src/messaging/sms-dedup.mjs` never called → `msg:brakes` (repeat text).
- No HELP answer → `msg:help-reply`.
- EEO invite page missing → `msg:links-in-body`.
- Hiring outreach blocked at the gate → `msg:hiring-outreach-blocked`.
- Owner alert texts with no sender → `msg:owner-alerts-unsent`.
