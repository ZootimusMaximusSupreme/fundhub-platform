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

## 2026-10-21 — full morning ship proof (catalog-display Automation sidebar head) — pulse_false_alarm
- Cause: the same Linux ship runner road, one step later. The live `/app/shell.js` sent its headers in 83 ms and then no more of its body for 15 s, so the hidden-head check's own 4 s read timed out in one of the proof's two runs. The proof compares the app-role run with the staff-access run, saw "na" against "skip", and stopped every ship (run 39552478955). Not data and not a role: the check reads the live file over the web, not the database.
- Fix: `scripts/pulse/site-hedge.mjs` now also reads the whole body of a site GET. If the body is not complete 2 s after the answer started, it sends one more identical GET and keeps whichever full body arrives first; the stalled download is then cut off. The caller's own deadline still covers every request, and a body that never completes is still a failure. No check, gate or timeout changed. The live pulse is unchanged.
- Guard added: `scripts/pulse/site-hedge.test.mjs` (a stalled body gets exactly one more request and the full body comes from it; a body that never completes on either request still fails by the caller's deadline; a fast body is read once; a redirect keeps its status and location). Every proof run lists body hedges in "site requests that needed a second connection".
- Incident: none (caught by GitHub ship run 39552478955)  PR: claude/hedge-body-stall-2026-10-21

## 2026-10-20 — sales-floor Recording rows — code_bug
- Cause: the Drive sync read any UUID in a file name as a client id and saved it without checking the client exists. iPhone exports are named `<UUID>.mp4`, so 14 recordings pointed at clients that exist nowhere.
- Fix: `upsertExtractedFile` keeps a sniffed client id only when that client exists in the same company, else NULL (src/company-brain/store.mjs). Migration 499 clears the 14 saved rows (client_id to NULL only; no delete). The Drive files and links are untouched.
- Guard added: src/company-brain/store.test.mjs (kept both ways, non-UUID never queried) and src/company-brain/brain-client-id-migration.test.mjs (what 499 may touch). The check itself already goes red on a made-up client id.
- Incident: none (6:02 a.m. scorecard row, not an hourly incident)  PR: claude/w6-staff-fixes-2026-10-20

## 2026-10-20 — staff-reset-link — code_bug
- Cause: a new invite or reset link ended the person's earlier unused links with `used_at = now()` even when the earlier link had already run out, so it read as "used after it ran out".
- Fix: the three "end the earlier link" UPDATEs in src/auth/invite.mjs only touch links that are still live (`expires_at > now()`). Old rows age out; nothing was rewritten.
- Guard added: src/auth/invite.test.mjs (live link ended, expired link left alone, for invite, staff reset and affiliate reset) and a real-database case in src/auth/auth.pg.test.mjs.
- Incident: none (6:02 a.m. scorecard row, not an hourly incident)  PR: claude/w6-staff-fixes-2026-10-20

## 2026-10-20 — sales-floor Flag belief — code_bug
- Cause: the writer saved a belief flag with an outcome count of 0 and no lead source or setter ("pain this period 0 vs last 0"). Such a flag can never match a real call.
- Fix: `createMarketingFlag` (src/sales/call-outcomes.mjs) refuses it with a plain 400: "There are no calls behind this belief yet, so there is nothing to flag." The page shows it through its existing error alert; its look did not change.
- Guard added: src/http/marketing-flags-handler.test.mjs (nine refused shapes, one stored).
- Incident: none (6:02 a.m. scorecard row, not an hourly incident)  PR: claude/w6-staff-fixes-2026-10-20

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
- Fix: the proof's own fetch to the site sends one more identical GET or HEAD after 1 s of silence, and one more after 2 s, and uses whichever answers first (`scripts/pulse/site-hedge.mjs`). One extra try was not enough: the silence comes in clumps (74 of 700 handshakes at once, often 5 or 6 in the same instant; Netlify's ordinary edge road 3 of 700; one at a time 0 of 150), and ship run 39522194091 lost GET /roadmap on both of its two connections. No deadline, no half-deadline rule and no probe timeout changed. The live pulse-probe is unchanged. A door that answers none of the requests is still red. On the runner (run 39524495899): plain fetch 17 of 840 hung, hedged 0 of 840; the real proof passed 6 of 6, one of them only on the third request.
- Guard added: `scripts/pulse/site-hedge.test.mjs` (asked once when the site answers; at most two more requests, a hedge time apart, while it is silent; still fails when none answer; fast errors, 5xx, other hosts and other methods untouched). Every proof run prints "site requests that needed another connection".
- Incident: none (caught by GitHub ship runs 39486073918, 39496970203, 39501099350, 39502479109, 39505729133, 39511244534, 39522194091; with the one-retry version on main, 39526344188, 39527582000, 39532137188, 39542103433 and 39558443237 still lost a door on both connections; diagnosis runs 39508925935, 39513051795, 39516992055, 39523413721, 39524495899).  PR: https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/93 and its follow-up

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
