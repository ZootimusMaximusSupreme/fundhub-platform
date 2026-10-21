# Pulse lessons

Every break the hourly pulse finds teaches the next build. When a break is fixed, add one entry here and fill the same four fields on its `pulse_incidents` row (`cause_category`, `cause_note`, `fix_summary`, `guard_added`). Read this file before writing a new fix guide or a new beat.

Newest at the top. One entry per break. Short lines, 4th grade English.

```
## YYYY-MM-DD — <beat id> — <cause_category>
- Cause: <one line>
- Fix: <one line, or "not code: <what Chris must do>">
- Guard added: <test file / beat step / tripwire id, or "none: <reason>">
- Incident: <pulse_incidents id>  PR: <url>
```

The cause categories are the list in `db/migrations/475_pulse_beats_incidents.sql`: code_bug, missing_route, config_or_env, migration_not_applied, schema_or_data, deploy_or_bundle, vendor_down, vendor_changed, bank_site_changed, timeout_or_capacity, pulse_false_alarm, unknown.

What keeps breaking, and is it guarded now (plain SQL, no AI):

```sql
SELECT cause_category, beat_id, count(*) AS breaks,
       count(*) FILTER (WHERE guard_added IS NOT NULL AND guard_added NOT LIKE 'none:%') AS guarded,
       round(avg(extract(epoch FROM closed_at - opened_at) / 3600)::numeric, 1) AS avg_hours_broken
FROM pulse_incidents
WHERE closed_at > now() - interval '90 days'
GROUP BY 1, 2 ORDER BY breaks DESC;
```

## 2026-10-20 — consent:dispute-required — schema_or_data
- Cause: the only repair client with no dispute authorization and no signed repair agreement is Braum (FH-000507). The owner put him on a no-contact, no-change hold, so nobody may chase his signature. The row stayed red with nothing a person may do.
- Fix: the check names the clients it counts. When every one is on the owner's hold (`src/pulse/owner-hold.mjs`), the row is "nothing to judge" with code `owner-hold-client`, and the consent lane re-reads it every morning (`naVerify`). Any other client keeps it red.
- Guard added: `src/pulse/coverage/gap-consent.test.mjs` (held client alone is nothing to judge; any other client, a mixed list, or a count the names do not match stays red; the re-check is false the day anything changes).

## 2026-10-20 — calls:booked-no-join-link — pulse_false_alarm
- Cause: the check judged the 5 newest bookings at any age. Nothing kept a join link before 2026-10-21 01:38 UTC (ship d1de88a1), so every older booking can never have one, and the check stayed red with no new booking to judge. Owner: "Old bookings do not matter. Only new bookings."
- Fix: the feed question counts bookings only from that moment (`JOIN_FEED_SINCE`). The "call still ahead with no link" question is not cut, so the first new booking with no link is red 10 minutes after it lands.
- Guard added: `src/pulse/coverage/gap-calls.test.mjs` (old bookings say nothing; 3+ new ones with no link still red; a call ahead is never hidden).

## 2026-10-20 — email:provider-fail, msg:per-template-path — pulse_false_alarm
- Cause: the App Store review login (FH-000844, client@fundhub.ai) asked for sign-in links. That mailbox does not exist, so Resend blocked both emails as bounces. The message checks did not know it was a test login, so they read it as "email is not reaching people".
- Fix: the message checks leave out the one client with the review login's fixed key (FDH-TEST-CLIENT-ROLE-ACCOUNT), the same way they leave out demo clients. A customer's bounce still counts.
- Guard added: `src/pulse/coverage/gap-msg.test.mjs` (key held to the seed), `src/pulse/coverage/gap-msg.pg.test.mjs` (review bounces left out, a customer's bounce still red).

## 2026-10-20 — messaging Send button, Message > Client — pulse_false_alarm
- Cause: a one-off owner text (the teleprompter link sent to Chris's own phone, 2026-10-07) is saved as a staff text with no client. The staff-reply check read it as a reply that lost its client.
- Fix: the staff-reply check leaves out `owner-ops:` texts, like the chat widget check already did. The Send button never writes that marker.
- Guard added: `src/pulse/catalog/proofs/fin-b04-display-fixtures.mjs` (owner-ops row ignored, a client-less staff reply still bad).

## 2026-10-20 — handoff:lead-first-touches-missing — schema_or_data
- Cause: the 2026-10-11/12 test run on production also deleted the finish-application email and all six never-booked chase messages. Those steps had nothing to send.
- Fix: `db/migrations/497_restore_missing_sql_templates.sql` (PR #112) put all 125 missing templates back, these 7 included, byte for byte the repo words (checked live 2026-10-21).
- Guard added: `scripts/db/template-restore.test.mjs`; the template-deleting database tests now run only on a scratch database (PR #112).

## 2026-10-20 — bureau-config:complete — pulse_false_alarm
- Cause: the check read an empty CRM table. The AI caller never reads that table. Its numbers and phone menus live in its own call scripts (vendor/inquiry-remover/src/agents/*-prompt.js) and the *_DISPUTE_NUMBER settings.
- Fix: the check reads what the caller really dials (src/inquiry-ops/bureau-dial-plan.mjs). Red only when neither the script nor the table has a number and a menu.
- Guard added: src/inquiry-ops/bureau-dial-plan.test.mjs, src/pulse/coverage/gap-records.test.mjs (script plan PASS and FAIL).
- Incident: none (morning row, not an hourly beat)  PR: none yet

## 2026-10-20 — meta-sync, meta-server-events, Lendflow contract, AI bureau call job — pulse_false_alarm
- Cause: owner answers B6 and B8. Meta ad sync and AI bureau calling are future features, and Lendflow is paused. Their rows stayed red every day for features nobody uses yet.
- Fix: not turned off. Each row's real check still runs. It says "nothing to judge" only while src/pulse/parked-features.mjs reads, through the staff view, that the feature is still not in use (codes feature-not-set-up and owner-paused). The day it is in use, the real red is back.
- Guard added: src/pulse/parked-features.test.mjs, src/pulse/na-conditions.test.mjs
- Incident: none (morning rows, not hourly beats)  PR: none yet

## 2026-10-20 — hourly ship proof (doors-live, db-health, checkout-doors, money-checkout) — pulse_false_alarm
- Cause: from a GitHub Ubuntu runner, some connections to fundhub.ai's front door (Netlify's apex load balancer, 75.2.60.5 and 99.83.231.61) go silent. TCP connects, the server acknowledges our bytes, and then no answer ever comes. 59 of 1,120 TLS handshakes went silent with 14 at once, 3 of 600 one at a time. curl and Node both, with either TLS key share. DNS and TCP were clean. One GET stuck for the probe's full 8 s stopped every Linux ship on 2026-10-20 at the hourly bundle proof. The Mac and the live hourly pulse on Netlify (0 timeouts in 73 runs) do not see it.
- Fix: the proof's own fetch to the site sends one more identical GET or HEAD after 1 s of silence and uses whichever answers first (`scripts/pulse/site-hedge.mjs`). No deadline, no half-deadline rule and no probe timeout changed. The live pulse-probe is unchanged. A door that answers neither request is still red. On the runner: plain fetch 11 of 630 hung, hedged 0 of 630; the real proof passed 3 of 3.
- Guard added: `scripts/pulse/site-hedge.test.mjs` (asked once when the site answers; exactly one more request when it is silent; still fails when both are silent; fast errors, other hosts and other methods untouched). Every proof run prints "site requests that needed a second connection".
- Incident: none (caught by GitHub ship runs 39486073918, 39496970203, 39501099350, 39502479109, 39505729133, 39511244534; diagnosis runs 39508925935, 39513051795, 39516992055).  PR: this change

## 2026-10-12 — full catalog ship proof — timeout_or_capacity
- Cause: the full catalog added 1,762 honest red findings. The proof printed every red line, which overflowed the GitHub ship log. A dead old live site also made the rotating CRM file check take 45 seconds.
- Fix: the proof prints the first 80 findings plus the remaining count. Live red and not-checked results stay in the scorecard but do not pretend the proof engine crashed. CRM file reads stop after two seconds, and the 51-logo sample runs in batches of 20 so a slow GitHub network still leaves room for the rest of the lane.
- Guard added: `scripts/pulse/prove-policy.test.mjs`, `src/pulse/coverage/gap-crm-links.test.mjs`, and the full built-bundle `npm run pulse:prove`. The proof still fails for missing bundle files, thrown steps, slow lanes, SQL errors, writes, or sends.
- Incident: none (caught by GitHub ship runs `38293041665` and `38295693277`). PR: none

## 2026-10-10 — trip lanes — timeout_or_capacity
- Cause: the audit checks every "nothing to judge" row again, all together, inside 2.5 seconds. Three new trip rows that said "nothing to judge" each read the database again. That pushed the list past the deadline, and about 50 other rows after them (every workflow row) read "not true any more" with no real cause. Found by `npm run pulse:prove` before ship. A faster read and one shared read both helped and neither was enough in the proof.
- Fix: a trip nobody started is a plain green line ("Nobody started the funding trip in the last 60 days, so nobody is stuck"), not a "nothing to judge" row. It costs the audit nothing.
- Guard added: `trip-kit.test.mjs` (an empty trip is PASS and carries no `na`), each `gap-trip-*.test.mjs` (the same, per lane), and `audit:na-verified` in `npm run pulse:prove`. Lesson: a new "nothing to judge" row spends part of a shared 2.5 second budget, and the proof shows it on a laptop where each read costs three round trips. Say it green in words unless the row truly cannot be read.
- Incident: none (caught in the proof).  PR: none

## 2026-10-09 — brief-link — missing_route
- Cause: every morning and evening text ended with "Full report: <link>". The page behind it (`public/app/morning-brief.html`) was never built, so the link answered 404 for days and nothing noticed. The text was sent and logged, so every check said the text was fine.
- Fix: built the page and a public data route (`api/public/morning-brief.mjs`). The link now carries a secret code, so it opens with no sign-in and only for the exact report. If the secret is missing the text says "Full report: not available" and the new beat goes red.
- Guard added: beat `brief-link` (`src/pulse/beats/beat-brief-link.mjs`, tested in `beat-brief-link.test.mjs`). Every hour it reads the newest saved text, follows its real link, and checks the page opens (`link-saved`, `page-opens`, `report-loads`). Lesson: a check that proves "the text went out" does not prove "the link in the text works". Follow the link, the way a person would.
- Incident: none (found by hand, before the beat existed)  PR: none

## 2026-10-09 — tripwire map — pulse_false_alarm
- Cause: the tripwire map counted pages from the files on this Mac's disk. One page (`public/leads/…`) is git-ignored, so the test passed here and failed on GitHub for every branch since 2026-10-08.
- Fix: count pages and desks from `git ls-files --cached --others --exclude-standard`, so ignored files never count and a new unstaged file still does.
- Guard added: `src/pulse/tripwires.test.mjs` (a new unstaged page fails it; an ignored page does not). Lesson: a test that reads the disk can pass on the owner's Mac and fail in CI. Run a throwaway-branch CI check after adding a guard that scans files.

## 2026-10-09 — engine stall — pulse_gap
- Cause: the workflow engine (Inngest) stopped for 46 minutes (2:05 to 2:51 p.m. Arizona). Both 5-minute alarms saved no receipt, then ran a catch-up burst. Nothing live said so; the morning scorecard found it the next day. The engine cannot watch itself.
- Fix: a new hourly beat on the Netlify clock reads the two alarms' receipts, and goes red if either is over 20 minutes old or any gap over 20 minutes sits in the last 70 minutes.
- Guard added: beat `engine-alive` (`src/pulse/beats/beat-engine-alive.mjs`, `beat-engine-alive.test.mjs`). The Netlify clock ran straight through the stall, so it is the outside watcher. Same night: `netlify/functions/pulse-outside-watch.mjs` runs that one beat every 5 minutes through the hourly runner (no new text path), so a stall is texted about 20 minutes in, not up to an hour later. Its own heartbeat is job `pulse-outside-watch` (red after 15 minutes of silence).
- Incident: none (found in the 2026-10-09 evening full run). PR: none

## 2026-10-09 — outside:health-down-text — pulse_false_alarm
- Cause: the pretend dead-database half hour ran at the real time. When it crossed 10 p.m. (or began before 6 a.m.) the real alarm correctly held its text for texting hours, so the check read "nobody is told" and went red at night.
- Fix: the pretend half hour is moved to 6 a.m. when it would cross the texting window (`outageStartMs`).
- Guard added: `gap-outside-inngest.test.mjs` (passes at 9:50 p.m. and 5:30 a.m.; a watch that sends nothing still fails at night).

## Lessons carried in from before the pulse (2026-10-08)

## 2026-10-08 — pulse coverage — deploy_or_bundle
- Cause: the pulse found its check files with a folder scan. The live bundle carries no folder, so 0 of 70 check files ran and nothing said so.
- Fix: every file is a literal import (`src/pulse/coverage/modules.mjs`, `src/pulse/beats/index.mjs`) and a test fails when disk and list differ.
- Guard added: `src/pulse/coverage/modules.test.mjs`, `src/pulse/beats/beats.test.mjs`, `npm run pulse:prove` builds the real bundle.

## 2026-10-08 — daily pulse — timeout_or_capacity
- Cause: all checks ran in one Inngest step (61 s). Netlify cuts a step at 26 s, so no morning text would have gone out.
- Fix: one step per lane, a fallback text if the pulse or the brief dies.
- Guard added: `npm run pulse:prove` fails any step over 20 s; `src/workflows/daily-pulse.test.mjs`.

## 2026-10-08 — pulse checks — deploy_or_bundle
- Cause: checks that read repo files at run time passed on the laptop and went red on the server.
- Fix: no repo files read at run time; use the route map, the database or the live site.
- Guard added: `npm run pulse:prove` runs from the built bundle.

## 2026-10-08 — heartbeat — code_bug
- Cause: the 5-minute alarm read the database before it texted, and the 6 a.m. pulse threw on a dead database. When the database dies the heartbeat went quiet.
- Fix: a dead database is one red row; the alarm texts at most twice an hour without a database; the job sends a plain text if the brief or the pulse dies.
- Guard added: `src/pulse/instant-watch.test.mjs`, `src/pulse/daily-pulse.test.mjs`, `src/workflows/daily-pulse.test.mjs`, `outside:*` lane.


## 2026-10-13 — display-result lane — deploy_or_bundle
- Cause: `gap-catalog-display.mjs` loaded map files under `ops/workflows/` and imported proof builders that also read those files. Its retired-page verifier read `netlify.toml`. Those checkout files are absent on the live server.
- Fix prepared for review: compile the exact result and tracking cases into the existing `src/pulse/catalog/generated.json`; the live lane imports only that saved data. Check the retired page and active menu with read-only live GETs.
- Guard added: a display-lane test imports a copy containing only shipped pulse data, with no work folders or Netlify config. Redirect tests keep wrong targets, a dead menu, and unread pages red or unchecked. The saved-result tests also require all 18 missing exact receipts to stay red.
- Release: not deployed. No incident records changed; this task authorized read-only production access.

## 2026-10-13 — catalog proof shards — code_bug
- Cause: proof shards asserted each selected row was `red` in `generated.json` "when selected". Once the compiler marks a row proved it carries no `proofVerdict`, so 20+ shard tests failed on `undefined !== 'red'`, plus hard-coded counts (338 route rows, 254 targets, 7 final jobs) that moved when rows were proved.
- Fix: shards assert the compiled state (`wired`, no `proofVerdict`, the proof file linked in `proof.tests`). Counts follow the catalog (316 red route rows, 242 targets, 6 red final-job monitors). The job lane drops `hiring-outreach-cadence`, which `door-contracts-routes-23` proves. `run-slices` accepts `na` only when it carries its na-conditions code.
- Guard added: the shard tests themselves; a bare `na` or a row still marked red after its proof compiled still fails.

## 2026-10-13 — production deploy — deploy_or_bundle
- Cause: a hand-run `netlify deploy` (title "Publish private leads referrer sorting", 19:15 UTC) published an API function bundle with no `pg` package. Every `/api/*` door answered 502 for about 7 minutes, and the ship's live proof failed on the 502s.
- Fix: restored the last good ship deploy (`ship 4cf77a78`) through the Netlify restore call, then re-ran the ship.
- Guard added: none yet. Publish through `npm run ship` or GitHub. A manual deploy must build the function bundle where `node_modules/pg` resolves, and check `/api/health` before and after.
