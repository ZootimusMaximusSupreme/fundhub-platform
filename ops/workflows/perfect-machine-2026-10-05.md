# Perfect marketing machine, heartbeat and reports — 2026-10-05

Owner: Chris Stanbridge. Ask (verbatim): "Make sure the marketing machine, heartbeat and all the reports are perfect."
Input: `marketing/MACHINE-GAPS.md` (gap list, with proof lines) and `ops/workflows/finish-builds-2026-10-05.md` (sibling batch; W4 still running there).

Board rule: this is the ONE shared file. Edit it only by absolute path
`/Users/chrisstanbridge/Developer/fundhub-platform/ops/workflows/perfect-machine-2026-10-05.md`
(use Bash + python or `cat >>`; the Edit tool may be blocked outside your worktree). If every write is blocked, save your
board text to `/private/tmp/claude-501/-Users-chrisstanbridge-Developer-fundhub-platform/cd6ee7f9-dae0-46b9-8912-77858f60a416/scratchpad/<id>-board-text.md`
and say so in your final message. Never commit this file from a worktree.

**O1 notice (19:16) to M6, M10, M11, M12 and anyone still writing:** the board lost manifests twice today. Right before you save: re-read this file, make ONE small insert or append (`cat >>` at the end, or a python insert that reads the file and writes it back in the same second), and never write back a copy you read earlier. Never replace the whole file. Do not edit between the `O1 section` markers.

## Tasks

| Id | Workflow | Owner | Status |
|---|---|---|---|
| M1 | Ad attribution + money numbers: ad number on every tagged visitor, lane for the $297 roadmap, Meta purchases / cost per purchase / link clicks / landing page views saved by the daily sync | Opus agent | done (branch `m1-attribution-money`, head `99e0f0d28`, not pushed; M4 cards answered) |
| M2 | Alerts and night jobs: dying-ad phone buzz, daily "fix in next take" table, ClickFunnels night job | Opus agent (branch `m2-alerts-night-jobs`) | done (44924292e) |
| M3 | Heartbeat: daily pulse + data-health monitor + gate-relay — prove each runs, fix what is broken, make it watch the machine | Opus agent | done (branch `m3-heartbeat`, head `56e873b3e`) |
| M4 | Reports tie-out: every report and dashboard number vs its raw source, fix wrong ones | Opus agent (branch `m4-reports-tieout`, head `7e0d272ec`) | done |
| M5 | Marketing dashboard: find the spec, map what exists (copy gen, offer gen, flywheel, ad scripts, ad reports, campaign screen), write a back-end-first plan file only — read-only on product | Opus agent (branch `m5-dashboard-plan`) | done (c44e0c92f) |
| M6 | Ad video: build the step that joins every take of one angle into one best master in script order, cuts dead air / repeats / false starts / filler, levels audio, before Submagic | Opus agent (branch `m6-join-takes`) | done (head `1bef065aa`; manifest below) |
| M7 | Follow-up emails: find why welcome emails failed/bounced (6 failed + 2 bounced in 14 days), fix the cause | Opus agent (branch `m7-email-failures`) | done (head `5cfdb946a`, not pushed) |
| M8 | Booked calls: save booking under the call's own id, stop the 15-minute text on a move, stop the no-show mark on cancel/move | Opus agent (branch `m8-calendar-moves`) | done (head d4378d1f3) |
| M9 | Meta server events correctness (Purchase, Schedule, dedupe with the pixel, value/currency, hashing) — code and tests only | Opus agent (branch `m9-meta-events`) | done (head `96c8904de`; browser $147 patch applied, owner-authorized) |
| O1 | OVERSIGHT: watches every agent, unblocks, independently re-verifies, dry-runs the merge, says SHIP-READY yes/no | Opus agent | done (19:31 MST; SHIP-READY no — V1 blocked; see Oversight (O1)) |
| M10 | Dashboard back end (slice 1): `GET marketing/today` + test; copy writer gets the Anthropic fallback; copy provider row + house-partner marketing switch via `db/seed` | Opus agent (branch `m10-dashboard-backend`) | done (head `dda703778`, not pushed) |
| M11 | Dashboard front end (slice 1): `public/app/marketing-command-center.html` + `.js`, sidebar entry, pulse registry line; "Write ad copy" button; Offer + Flywheel cards | Opus agent (branch `m11-dashboard-page`) | done (head `a581fb0ff`, not pushed) |
| M12 | Offer generator on the server: endpoint + Anthropic call following the flywheel offer rubric, result saved so the dashboard can show it | Opus agent (branch `m12-offer-generator`) | done (head `3decbfd93`, 5 commits on `d86cfc94e`, not pushed; migration 409; contract `docs/specs/marketing-offer-contract.md`) |
| V1 | Database proof: local scratch Postgres, apply all migrations on main, baseline the `.pg.test.mjs` suite, prove M1's 406/407/408 + its live checks on fixture rows, then the merged tree | Opus agent (worktree `agent-ae2fae559840d2a64`) | **blocked** — no Postgres on this Mac; Homebrew not installed (installing it needs Chris's Mac password). Nothing ran. See `## V1 database proof` |
| SHIP | One `npm run ship` after M1–M4 (and W4 from the sibling board) are done, then live proof | main session | waits |

## File ownership (so branches do not collide)

- M1 owns: `api/campaigns/sync.mjs`, `db/migrations/*` it adds, `src/ads/**`, attribution SQL/functions.
- M2 owns: `src/ops/watch-curve.mjs`, `src/ad-videos/notify-fanout.mjs`, `src/workflows/clickfunnels-analytics-sweeper.mjs`, the "fix in next take" table fill.
- M3 owns: `src/pulse/**`, `scripts/daily-pulse.mjs`, `src/workflows/daily-pulse.mjs`, `src/workflows/u-05-data-health-monitor.mjs`, `scripts/gate-relay/**`.
- M4 owns: report generators and dashboard pages (e.g. `public/app/campaign-manager.html`, report scripts) EXCEPT the files above. A wrong number whose cause sits in another workflow's file becomes a card for that owner, not an edit.
- M6 owns: new `src/ad-videos/merge-takes.mjs` (+ tests, + docs/journeys/ad-video-flow.md update). Wires into the sweeper with the smallest possible edit; never touches `notify-fanout.mjs` (M2) or `saveFinished` code.
- M7 owns: `src/messaging/**`, `src/mail/**` NOT touched (mails nothing by law); email provider code and templates only if the cause is there.
- M8 owns: booking/calendar handlers and workflows named in `ops/workflows/cf-calendar-switch-plan-2026-09-22.md`.
- M9 owns: `src/meta/**`, `src/handlers/meta-purchase.mjs`, `docs/tracking/meta-events.md`. Never edit `public/funnel/fh-events.js` (live asset); propose a patch on the board instead.
- O1 edits nothing except the board and its own scratch files.
- M10 owns: `api/marketing/today.mjs` + its ROUTES line, `src/http/marketing-today.pg.test.mjs`, the copy-writer files under `api/creative/` / `src/creative/`, and the new `db/seed/` file(s). M12 owns: `api/marketing/offer-generate.mjs` (+ ROUTES line), `src/marketing/offer*.mjs`. M11 owns: `public/app/marketing-command-center.*`, the sidebar entry in `public/app/shell.js`, one additive line in `src/pulse/registry.mjs`. M10, M11 and M12 each add ONE line to the ROUTES map in `netlify/functions/api.mjs` (different lines; merge conflicts there are trivial). M12 may add ONE migration, numbered after M1's (read the board for M1's number and take the next free).
- A migration number must be unique: M1 is the only workflow that adds migrations. Others ask via the board.

## Shared context brief

- Repo: `/Users/chrisstanbridge/Developer/fundhub-platform`. Live: https://fundhub.ai. `main` already has the ad-branch merge, MACHINE-GAPS.md, the Social Studio fallback, and `saveFinished` wiring.
- "Heartbeat" = the 7:00 a.m. America/Denver daily pulse (`src/pulse/daily-pulse.mjs`, cron `0 13 * * *`, flip to `0 14 * * *` after fall-back on 2026-11-01), which reads the gate-relay `heartbeat.json`, runs the pulse registry checks, and texts Chris; plus `src/workflows/u-05-data-health-monitor.mjs`.
- Known facts (MACHINE-GAPS.md, 2026-10-05): 0 of 18 tagged visitors have an ad number (ads send `oVid: SLO2` style names; `fundhub_ad_id()` in `db/migrations/286_client_ad_attribution.sql` reads leading digits only); Meta sync does not save purchases, cost per purchase, link clicks, landing page views (`api/campaigns/sync.mjs:516-521`); "dying ad" buzz never fired because `notify.send` is empty (`src/ops/watch-curve.mjs:14,96` vs `src/ad-videos/notify-fanout.mjs:83`); "fix in next take" table has 0 rows; ClickFunnels night job has not written since Sept 22 (plain connection hidden by row security, `src/workflows/clickfunnels-analytics-sweeper.mjs:11-15`).
- Owner decided (do NOT ask Chris again): match SLO buyers to their ad by ad set id + ad name, with no change to the live ads; the 40 approval cards stay off /roadmap; no Meta Schedule test booking; the $197 follow-up is handled; do not relay questions — pick the safe default and write the pick on the board.
- Hard locks: only your named items; any other break = one leftover card, no fix. Never delete data. Never repoint `DATABASE_URL`. Never remove/unset a key. Never run `verify:e2e` against live. DB reads are SELECT-only; never a bare `SET` on production (use `BEGIN READ ONLY`). Never send real texts/emails/Meta writes. Do not push, ship, or run `db/migrate.mjs` against production; the main session ships once.
- A new migration is NOT live until the production ship; write the code so it degrades safely before then (and `db/expected-migrations.mjs` is updated via `npm run migrations:manifest`).
- 27 unit tests already fail on plain `main` (e.g. diagrams sync, journeys stale, outbound fence). Do not fix them; confirm you add zero new failures by comparing names.
- Company name is spelled Fundhub.

## Change manifests

### M6 manifest — join every take of one angle into one master (branch `m6-join-takes`, head `1bef065aa`)

**Safe defaults picked (owner said: do not ask):**
- Takes join only when offer + ad number + angle words match (NAMING.md). Different angle = different video, even with the same ad number.
- A take is not decided until its angle has had no new take for **30 minutes** (a sibling still uploading is never left out).
- The **lowest waiting take number carries the master**; every other waiting take of that angle is closed as `failed` with a reason that starts `joined into one master:` (no `joined` state exists — card below). The lead closes them BEFORE the upload, so a second master can never be bought.
- A take that already went to Submagic alone still joins the next master (every take, per the law).
- Only **complete** attempts at a line compete; fewest defects wins (filler, repeats, stumbles, missing words, long pauses). A line no take said completely is left out and named in the note. Under 70% of the script said cleanly = the takes do not follow the script → `failed` for a person.
- Master keeps the takes' own size; a bigger take is scaled DOWN to the smaller, never up; different shapes are refused. Takes levelled to each other, master at -16 LUFS.
- A name with no angle (while another file shares the ad number), a non-NAMING.md name, no script, or no ffmpeg/whisper.cpp → **wait** with the reason on the row. A bug in the step also waits. Nothing ever falls through to a lone take.
- A row with no file name at all (test rows / legacy) and the one take of its angle go the old way, with a note.
- Speech-to-text is whisper.cpp on the machine (aligned DTW word times, -0.08 s lag fix). Never OpenAI/Deepgram.

**Files**
- NEW `src/ad-videos/merge-takes.mjs` — pure planner: NAMING.md names, grouping, the row decision, script parsing from the repo markdown, word alignment, best-of pick, edit list, silence/black trimming.
- NEW `src/ad-videos/merge-takes-media.mjs` — ffmpeg probe/loudness/silence/black, whisper.cpp transcriber, segment cut + concat + loudnorm, buildMaster(); finds ffmpeg (FFMPEG_BIN / PATH / ffmpeg-static) and whisper.cpp (repo lookup).
- NEW `src/ad-videos/merge-takes-step.mjs` — `joinBeforeSubmagic()` (the sweeper hook), `listAngleTakes()` (one SELECT via store.asStaff), `loadScripts()`, `withMasterBytes()`.
- NEW `scripts/ad-video-join-takes.mjs` — `--dir <folder>` offline join (no DB/Drive/Submagic/paid API); `--live` one real sweeper pass from the Mac (spends Submagic).
- EDIT `src/workflows/ad-video-sweeper.mjs` — 1 import + 1 call before `advance()` (+2 lines to use its verdict/ports/note). `pipeline.mjs` submagicCreate untouched; `notify-fanout.mjs` and saveFinished untouched.
- NEW tests: `src/ad-videos/merge-takes.test.mjs` (34+), `merge-takes-media.test.mjs` (real ffmpeg on synthetic clips), `merge-takes-step.test.mjs` (through the real `walk()`).
- Docs: `docs/journeys/ad-video-flow.md` (diagram, move table, new section with 6 gaps), `docs/journeys/CHANGELOG.md` line.
- No migration. No env var set. No push, no ship, no Drive, no Submagic, no paid API.

**Proved offline**
- 62 targeted tests green (`node --test src/ad-videos/merge-takes*.test.mjs`), plus all existing ad-video + sweeper tests green.
- Real ffmpeg on synthetic clips: two takes → one master with the right line from each take, script order, 320x240 kept, quiet take raised ~12 dB to match, master -16 ±3 LUFS, dead air cut, 640x480 scaled down to 320x240 (never up), black frames trimmed off a cut, off-script takes refused.
- End to end on two SPOKEN test takes of SLO Ad 7 made with the Mac's own `say` voice (filler, false start, doubled word, quiet take, long gaps), run through `scripts/ad-video-join-takes.mjs --dir` with the repo's whisper.cpp: re-listening to the master heard **20 of 20 lines in script order, 0 filler words, 0 doubled words, no false start, no air at start or end, longest pause 0.4 s, -16.1 LUFS**.
- Wiring through the real sweeper `walk()` with in-memory fakes: no ffmpeg → lead waits with the reason, other take closed, Submagic never called; with a joiner → exactly ONE Submagic project and it is the master, other take closed before the claim and upload; a close that does not land stops the upload; one take → the old path with a note; same ad number + different angle → two separate videos.
- lint clean, `tsc --noEmit` clean. Full suite: 12148 tests: 12117 pass, 27 fail, 4 skipped (all 4 need a database or WeasyPrint — none mine). The 27 failing names are the main baseline's (compared by name with scratchpad baseline-fails.txt): 0 new failures.

**NOT proved offline**
- Never run on a real filmed 4K take (only TTS and synthetic clips). Real voice, room tone, breaths and 4K encode time are unmeasured.
- `listAngleTakes()` SQL has not run against Postgres (fake tx only).
- The Netlify worker has no ffmpeg/whisper.cpp: after ship, every multi-take angle WAITS at `staged` (by design) until `node scripts/ad-video-join-takes.mjs --live` runs on the Mac.
- whisper.cpp model is base.en; a bigger model would hear better (not tried).

**How to prove it on the next real ad (after ship)**
1. Download every take of one angle from SLO Ads root into a local folder (names per NAMING.md).
2. `WHISPER_CPP_BIN=credentials/hormozi-kb-work/whisper.cpp/build/bin/whisper-cli WHISPER_CPP_MODEL=credentials/hormozi-kb-work/models/ggml-base.en.bin node scripts/ad-video-join-takes.mjs --dir <folder>` → watch `<angle> Master.mp4`, read `<angle> Master.edl.json` (which take each line came from, what was cut).
3. If it is right: `node scripts/ad-video-join-takes.mjs --live` (one pass; the lead take's master goes to Submagic, the other takes read `joined into one master:`). Check the row: one Submagic project for the angle.

### M2 — alerts and night jobs (done, branch `m2-alerts-night-jobs`, head `44924292e`, 4 commits on `8425410ff`, not pushed)

- **1. Dying-ad buzz** (`2a7bec697`). `src/ops/watch-curve.mjs` now imports notify-fanout's named `send` (the old `notify.send` was undefined; the first dying running ad threw and `sync.mjs` swallowed it). The query now selects `clicks`, so a hop is skipped, not buzzed. The text itself says "<ad>: people leave before the quarter mark, so change the opening." A buzz that does not land counts as `failed` and writes no alert row (retried next morning). Never pauses or re-budgets.
  - Scheduled? Yes, indirectly: no separate job. It runs at the end of every partner's Meta pull (`syncPartnerConnections`), which `meta-campaign-sync-sweeper` (cron `0 7 * * *`, registered) runs daily; last pull 2026-10-05 07:01 UTC. It ran every morning and crashed only when it found a dying ACTIVE ad; the error went into `stats.watch_curve`, which the Meta sweeper's run log does not copy. Today all 7 ads read PAUSED, so it will find nothing to buzz until an ad is turned on.
- **2. Next-take table** (`6693407ea`). New clock `src/workflows/watch-curve-diagnosis-sweeper.mjs`, cron `30 7 * * *` (after the Meta pull), registered in `src/workflows/index.mjs` + `index.test.mjs`. Per partner (asStaff list, asPartner write) it runs `fillDiagnoses()` / `diagnoseCurve()` in `src/ops/watch-curve.mjs` over 28 days of saved ad-days with no label, insert-only (`ON CONFLICT DO NOTHING`).
  - Picks made (safe defaults, not asked): "tapping through" = one test `tapsThrough()`, the playbook's: all clicks >= people who reached 25% (link clicks / landing page views are not saved yet). Opening fix = `both` when under half are still watching at second 2 (2-second count, else curve entry 2), else `words`. Middle and ask = `words`. Hop / too few / tapping-and-watching = no row. `next_take_improved` not filled (stays NULL).
- **4. Taps for the hop test** (`44924292e`, answers M4's card "dying-ad alert never sees taps"). The dropped-column half was already fixed in `2a7bec697` (the query selects `m.clicks`; that test fails on main). M1 HAS committed link clicks (`faafd1bf6`, migration 408 on `m1-attribution-money`), so the hop now uses taps to the page: `tapCount()` in `src/ops/watch-curve.mjs` = the larger of `link_clicks` and `landing_page_views`, for both the buzz and the next-take table. Read with `to_jsonb(row)`, so neither query names the new columns: they run before 408 ships (checked read-only on live: `link_clicks_saved` = false, falls back to every click, exactly the old rule). After 408, no link-click line from Meta = no taps reported = no hop claimed (nothing turned into 0). Recorded SLO4 2026-09-26: 32 clicks, 17 page views, 22 at the quarter mark → was a hop, now an opening. 5 new tests fail on `95d8faf4d` and pass now; suite still the same 27 failing names.
  - Ship-order note: if M2 ships WITHOUT M1's 408, the 07:30 fill labels days on every click and never revisits them (insert-only). Ship together and the 07:00 pull backfills link clicks 28 days before the 07:30 fill. Then the post-ship row counts below change (more openings, fewer hops) — the "about 27" is the every-click number.
- **3. ClickFunnels night pull** (`95d8faf4d`). `src/workflows/clickfunnels-analytics-sweeper.mjs` lists active accounts through `asStaff()` (the pattern `meta-campaign-sync-sweeper.mjs` and `runClickfunnelsOrgSync` already use). No policy loosened, no privileged URL.
- Files: `src/ops/watch-curve.mjs`, `src/ops/watch-curve.test.mjs`, `src/ops/watch-curve-diagnosis.test.mjs` (new), `src/workflows/watch-curve-diagnosis-sweeper.mjs` (new) + `.test.mjs` (new), `src/workflows/clickfunnels-analytics-sweeper.mjs`, `src/workflows/clickfunnels-analytics-sweeper.test.mjs` (new), `src/workflows/clickfunnels-analytics-sweeper.pg.test.mjs` (new), `src/workflows/index.mjs`, `src/workflows/index.test.mjs`, `docs/journeys/marketing-night-jobs-flow.md` (new), `docs/journeys/CHANGELOG.md`. Not touched: `api/campaigns/sync.mjs`, `notify-fanout.mjs`, migrations.
- Proof: `npm run lint` clean; `npx tsc --noEmit` clean; `npm test` 12,158 tests, 27 fail — the exact same failing names as plain main in this worktree (diff of names = empty), +72 new passing tests. Each fix has a test that FAILED on the old code: buzz ("send is not a function" x2, and no `m.clicks`), ClickFunnels (old sweeper saw 0 accounts through a fake staff-only pool). Buzz tests run the real fan-out and providers: fence up = nothing sent; fence off = fake transport on `.invalid` hosts only. No real text, push, Meta or ClickFunnels call. Next-take rules checked on all 36 recorded SLO ad-days (read-only from production), classified by hand: 27 opening (19 both, 8 words), 8 hops, 1 too few.
- NOT provable offline: the live row security on the new INSERTs and the asStaff list (the `.pg.test.mjs` proves it in CI as the app role; no Postgres on this Mac, so it skipped here); Inngest picking up the new 07:30 function after deploy; a real text (needs a running dying ad); that 07:15 / 07:30 actually fire.
- Post-ship live checks (read-only; run each inside `BEGIN READ ONLY; ... COMMIT;`):
  - Next-take table, after 07:30 UTC the morning after ship. Expect about 27 opening rows (19 both / 8 words) plus any new days:
    `SELECT diagnosis, fix_type, count(*) FROM ad_watch_curve_diagnoses GROUP BY 1,2 ORDER BY 1,2;`
    `SELECT a.name, m.date, d.diagnosis, d.fix_type, d.film_note FROM ad_watch_curve_diagnoses d JOIN ad_metrics_daily m ON m.id = d.ad_metrics_daily_id JOIN ads a ON a.id = m.ad_id ORDER BY m.date DESC, a.name LIMIT 20;`
  - ClickFunnels, after 07:15 UTC the morning after ship. Expect a new `stat_date` with `captured_at` near 07:15 UTC:
    `SELECT stat_date, count(*), max(captured_at) FROM funnel_page_stats GROUP BY 1 ORDER BY 1 DESC LIMIT 5;`
    `SELECT connection_state, last_synced_at, left(last_error, 120) FROM analytics_connections WHERE platform = 'clickfunnels';`
  - Buzz (stays 0 while every ad is PAUSED; a running dying ad should get one row per day):
    `SELECT a.name, a.status, m.date, m.video_plays, m.video_p25_watched, m.clicks, al.dies_before_25_alerted_on FROM ads a JOIN LATERAL (SELECT date, video_plays, video_p25_watched, clicks FROM ad_metrics_daily WHERE ad_id = a.id AND video_plays IS NOT NULL AND video_p25_watched IS NOT NULL ORDER BY date DESC LIMIT 1) m ON true LEFT JOIN ad_watch_curve_alerts al ON al.ad_id = a.id WHERE upper(coalesce(a.status, '')) = 'ACTIVE';`
- Merge notes: `src/workflows/index.mjs` adds one import + one entry after `clickfunnelsAnalyticsSweeper`; `CHANGELOG.md` adds 3 lines at the top. The stale `REGISTERED` pin in `src/journeys/runner/index.test.mjs` (already failing on main) is not moved.


### M5 — marketing dashboard plan (done, branch `m5-dashboard-plan`, head `c44e0c92f`, not pushed)

- Files touched: `docs/specs/marketing-dashboard-plan-2026-10-05.md` (new, the only repo file). No product code, no database writes, no ship.
- Found: the dashboard is the **Marketing Command Center** (`public/app/marketing-command-center.html`) in "Fundhub Marketing Machine: build spec, Version 3" (2026-10-05). It lives ONLY in the archived Claude chat "Fundhub Marketing Machine build spec" (`local_e16ec449-9c5c-48a9-ae8b-49b6dcee3d9d`); never committed. Copy of the text saved outside the repo: `/private/tmp/claude-501/-Users-chrisstanbridge-Developer-fundhub-platform/cd6ee7f9-dae0-46b9-8912-77858f60a416/scratchpad/m5-marketing-machine-spec-v3-from-archived-chat.md`.
- Also found: the older `docs/specs/marketing-e2e-spec.md` + `docs/specs/marketing-e2e/` (2026-09-08, make + measure, "data and dashboards") were deleted from main by commit `b5076e58e` (2026-10-02). Their text is still readable at the parent of that commit.
- Exists: copy gen on the server = Creative Factory copy jobs (blocked by setup; 1 job ever, failed 2026-09-17), Social Studio posts, Brand Studio page rewrites. Offer gen, avatar, ad research, flywheel copy, ad strategy = chat-only. No server script writer. Live: dashboard page and `/api/marketing/today` are 404.
- Smallest first slice (no migration): `GET marketing/today` + Today page with **Write ad copy** wired to existing `creative/generate` + `creative/run`; Offer card shows stage 3 status with "Copy the offer command"; plus the copy writer's Anthropic fallback, one `db/seed` provider row, house-partner marketing switch on.
- Routes affected: none yet (plan only). Journeys impacted: none yet; the plan names `docs/journeys/marketing-dashboard-flow.md`.
- Collision notes: dashboard migrations wait for M1 and take the next free number (main ends at 405; spec v3 reserved 406–429, which now collides). Never edits `campaign-manager.html` (M4) or `src/pulse/**` (M3).
- Not done: one production row read (why the copy job failed) was blocked by the session permission check; counts only were read.

### M7 — why welcome emails failed and bounced (done, branch `m7-email-failures`, head `5cfdb946a`, not pushed)

**Answer in one line:** every failed or bounced welcome email in the last 14 days went to a **test address**, not a real person. Real people's welcome emails: **2 sent, 2 delivered, 0 failed**.

Read-only proof: production database, each query inside `BEGIN READ ONLY … COMMIT`; tables `messages`, `clients`, `webhook_captures` (Resend's own delivery receipts), `staff`; plus public DNS lookups. No addresses printed; counts, ids and error text only.

| Group | Email | Count | What the record says | Who got it | Cause | Where the fix lives |
|---|---|---|---|---|---|---|
| A | Welcome (`EMAIL-S00-WELCOME`) | 6 failed | Resend HTTP 422 `validation_error`: "use our testing email address instead of domains like example.com" | 6 test leads, all `@example.com`, made 2026-10-01 04:31–06:36 UTC by live test walks of the apply form (signed ClickFunnels webhooks; `ops/workflows/apply-survey-rebuild-2026-09-30.md:50` names one) | our dispatcher handed a reserved test domain to Resend and logged it as a failed email | **in repo — fixed** |
| A | Finish your application (`EMAIL-S02-FINISH-APPLICATION`) | 5 failed | same 422 | the same 5 test leads | same | **in repo — fixed** |
| B | Welcome | 2 bounced | Resend `email.bounced`, Permanent / General (receipts 2026-09-27 02:05 and 2026-10-01 06:35 UTC) | the agent prove address `e2e+…@fundhub.ai` | fundhub.ai mail goes to Cloudflare Email Routing (MX `route1/2/3.mx.cloudflare.net`). No route exists for `e2e@`, so every `e2e+…` email hard-bounces | **off repo — card below** |
| B | Portal sign-in link (`EMAIL-PORTAL-MAGIC-LINK`) | 3 bounced | same hard bounce (2026-09-28 06:31 UTC) | same `e2e+…@fundhub.ai` | same | off repo — card below |
| C | Finish application 3, sign-in link 1, affiliate welcome `AF1` 2 | 6 say "sent" | Resend `email.suppressed`, reason `previous_bounce` — Resend never sent them | 4 to `e2e+…@fundhub.ai`; 2 `AF1` to one affiliate applicant whose own Gmail address hard-bounced on 2026-09-21 | our receipt reader has no line for `email.suppressed`, so the row stays "sent" | leftover card (not this job); the applicant's address is their data |

Since 2026-08-01, **0 of 13** emails to `e2e+…@fundhub.ai` were delivered (8 bounced, 4 suppressed, 1 blocked). Since 2026-09-20 Resend sent us 57 delivered and 6 bounced receipts; **5 of the 6 bounces are that test address.** Bounces count against our sender name at Resend.

Checked and NOT the cause: the welcome copy (2 of 2 real ones delivered); the sending domain (`send.fundhub.ai` has SPF including Amazon SES, `resend._domainkey.fundhub.ai` DKIM is present, bounce MX present). `fundhub.ai` has no DMARC record; real mail lands anyway, so it is not why these failed.

**Drip sends that went out (cold/warm/hot still off — not touched):** hot drip email 1 (2026-10-03) and email 2 (2026-10-04): **2 sent, 2 delivered, 0 failed.** No cold or warm drip, and no drip texts, went out since 2026-09-20.

**Fix (in repo, commit `5cfdb946a`):**
- `src/messaging/providers/resend.mjs`: new `refusedAddress(to)` — no network. Names the reserved test domains: example.com / .net / .org and anything under .test, .example, .invalid, .localhost.
- `src/messaging/dispatch.mjs`: before sending, asks the provider. A test address is saved as `status = 'blocked'`, `last_error = 'test address: <domain> is reserved for testing…'`, new outcome `test_address`. Resend is never called. Real addresses are unchanged.
- Tests: `src/messaging/dispatch.test.mjs` (the `@example.com` welcome case failed before the fix with 1 Resend call, passes after with 0; a real address still sends), `src/messaging/providers/providers.test.mjs` (`refusedAddress` cases, including look-alikes like example.co, test.com, example.com.au that must still go out).
- `src/messaging/cutover-acceptance.pg.test.mjs`: fixture moved from `acceptance-case@example.com` to Resend's own test inbox `delivered+acceptance-case@resend.dev`, so the acceptance run still proves a Resend send. Assertions unchanged. (Database-only test; no Postgres on this Mac, so it skipped here.)
- Routes affected: none. Journeys: no flow drawn in `docs/journeys/` covers per-message dispatch checks, and real clients' path is unchanged, so no `-actual.md` or CHANGELOG edit. No migration, no env var.
- Proof: targeted tests 226 run, 218 pass, 0 fail, 8 database-only skipped. `npm run lint` clean. `npx tsc --noEmit` clean. Full `npm test`: 12,091 tests, 12,060 pass, 27 fail, 4 skipped (no database). Failing names compared with O1's plain-`main` list (`o1/base.names`): **0 new**; 2 of main's flaky ones passed here ("$297 order Purchase", "no raw email or phone anywhere…").
- Not done: nothing was sent, no vendor was called, no ship, no push.

**After ship — read-only checks (run each inside `BEGIN READ ONLY; … COMMIT;`):**

```sql
-- 1. Test addresses are now held, not failed. Expect only status 'blocked', reason "test address: …", zero 'failed'.
SELECT template_key, status, left(last_error, 60) AS reason, count(*)
  FROM messages
 WHERE direction = 'outbound' AND channel = 'email' AND created_at >= '<ship time>'
   AND lower(to_address) ~ '(@|\.)example\.(com|net|org)$|\.(test|example|invalid|localhost)$|@localhost$'
 GROUP BY 1, 2, 3;

-- 2. Real welcome emails still go out. Expect sent / delivered only.
SELECT status, count(*)
  FROM messages
 WHERE template_key = 'EMAIL-S00-WELCOME' AND created_at >= '<ship time>'
   AND NOT lower(to_address) ~ '(@|\.)example\.(com|net|org)$|\.(test|example|invalid|localhost)$|@localhost$'
 GROUP BY 1;

-- 3. Bounces after the Cloudflare change. Expect email.bounced to stop growing.
SELECT raw_body::jsonb->>'type' AS type, count(*)
  FROM webhook_captures
 WHERE provider = 'resend' AND created_at >= '<ship time>'
 GROUP BY 1;
```

### M3 — heartbeat (done, branch `m3-heartbeat`, head `56e873b3e`, 6 commits on `8425410ff`, not pushed)

**Step 1 — what the heartbeat did, measured 2026-10-05/06 (read-only).** The 7:00 a.m. pulse ran every day: 14 of the last 14 days, 18 runs since its first on 2026-09-18, each at 13:01–13:03 UTC (7:01 MDT), proof = `agent_runs` rows `AG-07 / cron.daily-pulse`. `/api/inngest` answers 401 to a plain GET, so the run rows are the registration proof. A row's detail only lists failures, so "PASS" below means "never in a FAIL list" unless a dry run says more. Dry run = one read-only pulse against live at about 00:55 UTC 2026-10-06, nothing sent.

| Check | Last result | Evidence |
|---|---|---|
| Daily run | ran 14/14 days | `agent_runs` AG-07, 13:01–13:03 UTC daily |
| health / login / apply / suggestions | PASS | dry run: 200, login form, Apply copy, 401 |
| recon (AG-07 live on daily-pulse) | PASS | dry run |
| unrecorded sales calls | FAIL 09-18..09-26 (6 calls), PASS 09-27..10-05 | `agent_runs.detail` |
| gmail | PASS here; never failed on live | dry run; no FAIL row on live |
| registry (GET pings) | 1 down every day | `public/decline-autopsy` 404 in all 18 runs (owner shelved it 2026-08-31; route commented out). **Fixed** |
| registry coverage | 4 live routes never pinged | `public/eeo-survey`, `read/eeo-aggregate`, `scripts/list`, `waypoint-tick` (this was one of the 28 known fails on main). **Fixed** |
| stored run outcome | wrong: `pass` on 09-27..10-05 with a 404 in the same row | only `FAIL` counted, not `down`. **Fixed** |
| cron time | right today, wrong from 2026-11-01 (6:00 a.m.) | `0 13 * * *` was bare UTC. **Fixed**: `TZ=America/Denver 0 7 * * *` |
| gate-relay heartbeat | live: skip by design. Mac: FAIL, never ran | no `.fundhub-relay` folder anywhere, no relay process, no LaunchAgent, no `TELEGRAM_BOT_TOKEN` in `.env` or `credentials/env.full.snapshot` |
| Chris's text | `PULSE_SMS_TO` set on Netlify (masked) | delivery not provable: local Twilio token is masked |
| Darwin ticket | written, never sent | `DARWIN_WHATSAPP` unset on Netlify (by design) |
| U-05 data-health monitor | ran 1 of 2 real events | 14 days: 5 `analysis.completed` (3 demo, no client = no task by design; 2 simulated CRS on 09-30). 06:00 UTC one → task at 06:02 (utilization missing, correct). 04:30 UTC one → no task, no `failed_events` row; Inngest history not readable offline. Card below |
| NEW meta-sync | PASS | Meta numbers saved 2026-10-05 07:01 UTC, newest day 10-04 |
| NEW clickfunnels-night-job | FAIL (honest) | the only two writes ever are 09-22 09:20 and 10-04 22:10 UTC, neither in the 07:15 slot. Turns PASS after M2's fix ships and the 07:15 pass writes |
| NEW meta-server-events | PASS | Meta accepted 17 of 17 real-visitor events in 24 h |
| NEW dying-ad-scan | PASS | sync ran 07:01 UTC; every ad PAUSED, so nothing to buzz; 0 buzzes ever |

**Commits:** `d421cd608` registry (shelved door to ALLOWED_UNMONITORED, 4 routes added, new test: every pinged api row must be in ROUTES) · `a9e0fce75` stored outcome counts `down` · `4f60d9e42` cron on Denver's clock · `2eeb31fbe` four machine rows · `33d7840c3` CLI `--db` read-only dry run · `56e873b3e` one reason line.

**Files:** `src/pulse/registry.mjs`, `src/pulse/registry.test.mjs`, `src/pulse/daily-pulse.mjs`, `src/pulse/daily-pulse.test.mjs`, `src/pulse/machine.mjs` (new), `src/pulse/machine.test.mjs` (new), `src/workflows/daily-pulse.mjs` (passes `asStaff` as the machine rows' scope), `src/workflows/daily-pulse.test.mjs`, `scripts/daily-pulse.mjs`, `scripts/daily-pulse.test.mjs` (new), `docs/journeys/CHANGELOG.md` (4 lines at top). Outside the M3 list: **one comment line** in `src/workflows/index.mjs` (the pulse entry's cron note). No migration, no new table, no `-intended.md` edit. The daily pulse has no journey pair; logged as `role-owner (ops, no screen)` like 2026-08-25.

**How the 4 new rows work** (`src/pulse/machine.mjs`, read-only, run under `asStaff` because those tables are FORCE row security and read empty on the plain app role; a broken query is its own FAIL and never stops the pulse): meta-sync = `ad_metrics_daily.synced_at` within 36 h and no `last_error` on the Meta connection. clickfunnels-night-job = a `funnel_page_stats` write inside the night job's slot (cron read from M2's `SWEEP_CRON`, 90-minute window) within 36 h; a hand-run sync does not count. meta-server-events = real-visitor funnel events with a Meta id in 24 h whose `payload.meta.sent > 0`; skip when there were none; FAIL when none accepted or errors outnumber accepts. dying-ad-scan = last Meta sync within 36 h, and no ACTIVE ad that dies before 25% (M2's `diesBefore25Percent`) lacks a buzz dated on or after that sync.

**Proof:** `npm run lint` clean · `npx tsc --noEmit` exit 0 · pulse tests 50/50 (new: 23 machine, 4 CLI, 3 pulse) · `npm test` (no database): 12,116 tests, 26 fail vs 28 on a clean `main` copy; **0 new failing names**; fixed: the pulse registry coverage test, and 2 Meta-event tests that flip between runs. Each fix had a test that failed on the old code first (404 row, `pass` outcome, 6:00 a.m. on 2026-11-02). One real dry run against live through the new `--db` path (one `BEGIN READ ONLY` transaction, rolled back, senders replaced by ones that throw): rows as in the table above.

**Not provable offline:** that Inngest accepts the `TZ=` cron (needs the ship's re-register; proof = tomorrow's run time, and 14:0x UTC after 2026-11-01); that the 7 a.m. text reaches Chris; whether the live scorecard file is written (card below); the U-05 miss on 09-30 04:30 UTC.

**After the ship, run once from the main checkout (read-only, sends nothing):**
`PULSE_BOARD_DIR=/tmp/pulse-proof node scripts/daily-pulse.mjs --db`
Expect: every named row printed; `gate-relay` FAIL (Mac messenger not running); `clickfunnels-night-job` FAIL until M2's 07:15 pass writes; `sms.reason` = `dry_run`. Then the morning after: `BEGIN READ ONLY; SELECT created_at, outcome, left(detail,300) FROM agent_runs WHERE agent_code='AG-07' ORDER BY created_at DESC LIMIT 2; COMMIT;` — expect 13:0x UTC and no `public/decline-autopsy` in the detail.

**Merge notes:** `src/workflows/index.mjs` = one comment line at the dailyPulse entry (M2 adds lines elsewhere). `machine.mjs` imports `diesBefore25Percent` from `src/ops/watch-curve.mjs` and `SWEEP_CRON` from `src/workflows/clickfunnels-analytics-sweeper.mjs` (both M2 files; both names unchanged on M2's branch as of its manifest).

### M11 — what the dashboard page reads (for M10 and M12; M11 follows YOUR file if it differs)

Update 19:2x MST: M11 now codes against the files on your worktrees (`api/marketing/today.mjs`, `api/marketing/offer-generate.mjs` + `src/marketing/offer-store.mjs`). **Please do not rename these keys without a line here** — the page reads exactly these (either spelling works):

- **M10 `GET marketing/today`:** `copy_ready.partner_id` (the house id the Write ad copy button sends), `copy_ready.ready`, `copy_ready.checks[].key/ok` for `house_partner`, `marketing_switch`, `copy_provider`, `anthropic_key`, `writing_budget`; `spend.windows.{today,last_7_days,prior_7_days,last_30_days}.spend_cents/days_with_data`; `last_sync.metrics_synced_at` (else `meta_synced_at`) + `latest_metrics_date`; `copy.pieces[]` (`id, copy_text, compliance_state, blocked_reasons, created_at`), `copy.jobs[]` (`id, status, error, created_at`); `flywheel.campaigns[].{campaign, stages[], advice}` with stage `n, key, label, state, approved, why, reasons`; `waiting[].{part, reason}` (shown as machine parts, NOT as Chris's to-do).
- **M12 `marketing/offer/generate`:** GET (no id) on page load → `ready`, `message`, `job.{id,status,created_at,error}`, `offer` = offerView (`offer.{name, price, oneSentence, whatTheyGet, guarantees[].{name,promise}, bonuses}`, `review_card.{whatThisDecided, threeThingsToCheck, notSureAbout}`, `finished_at`). POST body `{campaign}` → 202 `job` + `message`, then GET `?id=` every 10 s until `done`/`failed` (max 16 min). Refusals show your `message` (except 401/403, worded by the page). Router 404 (route not shipped) → "The offer writer is not ready yet."

### M1 — ad numbers, SLO lane, Meta money numbers, payments per ad (done, branch `m1-attribution-money`, head `99e0f0d28`, 5 commits on `8425410ff`, not pushed, not shipped)

Commits: `62e824746` ad numbers + SLO lane + payments in the roll-up · `faafd1bf6` Meta sync saves the four numbers · `0ad7b5137` trigger reads OLD only on UPDATE · `ac5c30a79` functions closed to anon/authenticated · `99e0f0d28` first pull reads the whole history + one-time backfill script (M4 cards). `git merge-tree` onto main `83593b9bf` and onto `m4-reports-tieout`: clean.

**Migrations (M1 is the only one adding them): 406, 407, 408. Next free number: 409.** `db/expected-migrations.mjs` regenerated (re-run `npm run migrations:manifest` after merging M10/M12 if they touch seed/migrations).
- `406_ad_lane_slo.sql` — only `ALTER TYPE ad_lane ADD VALUE IF NOT EXISTS 'slo' BEFORE 'unknown'` (own file: Postgres will not use a new enum value in the same transaction).
- `407_ad_number_from_meta.sql` — (1) `fundhub_ad_lane()`: the five exact lanes first, then the word SLO on its own → `slo` ("oPur: TOF-SLO: $297" → slo; "slow", "oVid: SLO2" stay unknown). (2) `ads.fundhub_ad_number` set on the four SLO ads that ran, keyed by Meta ad id + name + ad set id, only where NULL and the number is free: SLO1 → 84, SLO2 → 90, SLO3 → 89, SLO4 → 86 (source: `ops/workflows/ad-scripts-2026-10-02/w4-findings.md`, Meta's own video file names). The 3 August ads stay NULL (no Fundhub number exists). (3) `fundhub_meta_ad_number(org, ad set id, ad name)` SECURITY DEFINER, pinned search_path: answers only when exactly one Meta ad in that ad set has exactly that name and one number; none / ambiguous / unnumbered = NULL. (4) `client_ad_attribution.ad_id` DROP EXPRESSION → filled by trigger `client_ad_attribution_ad_id_trg`: leading digits first (old rule), else the Meta match, else keep the old number while the tags are unchanged. The app cannot write it. (5) `fundhub_reresolve_ad_numbers(org)` fills NULLs only. (6) Backfill = (5) for every org + recompute stale `unknown` lanes. UPDATE only, no DELETE. Revoked from PUBLIC, anon, authenticated; granted to fundhub_app.
- `408_ad_metrics_meta_results.sql` — four nullable bigint columns on `ad_metrics_daily`: `purchases`, `cost_per_purchase_cents`, `link_clicks`, `landing_page_views` + non-negative CHECK. `conversions` / `cpa_cents` untouched (the optimiser reads them).

**Code:** `api/campaigns/sync.mjs` (asks Meta for `cost_per_action_type` too; `insightUpsertSql` / `insightUpsertParams` / `hasMetaResultColumns` — the four columns are written only when 408 is there, otherwise the old write runs unchanged; after saving ads it calls `reresolveAdNumbers`, reported in `stats.ad_numbers`, never fatal). `src/ads/meta-results.mjs` (new: Meta names from the Ads Action Stats reference — `omni_purchase` else `offsite_conversion.fb_pixel_purchase`, never summed; `link_click`; `landing_page_view`; cost = Meta's `cost_per_action_type` for the same action, else spend ÷ purchases; NULL when Meta sent no line). `src/ads/store.mjs` (`adAttributionRollup` now returns `payments`, `paid_cents`, `payments_amount_unknown`, `first_paid_at`, `last_paid_at` — paid non-demo `payment_links` of the same client, counted per client so books × payments never multiply; new `reresolveAdNumbers`). `src/ads/registry.mjs` (`laneOf` mirror knows `slo`; `LANES` stays five — script lanes, not wire lanes). `src/ads/ad-number.mjs` (new JS mirror of the 407 rule) + `src/ads/ad-number-cases.mjs` (one case table for the JS and SQL tests).
**Tests:** `src/ads/ad-number.test.mjs`, `src/ads/meta-results.test.mjs`, `src/http/campaigns-sync-results.test.mjs` (run, pass); `src/http/ad-number.pg.test.mjs` (real SQL: trigger, resolver match / no-match / ambiguous, backfill, rename keeps number, app cannot write ad_id, sync against fake Meta writes the four numbers with NULLs, payments per ad) — **SKIPS here, no DATABASE_URL; never run.**
**Journeys:** `docs/journeys/ad-attribution-flow.md`, `docs/journeys/ad-label-spine-flow.md`, 2 lines in `CHANGELOG.md`. No `-intended.md` touched. Routes: none added.

**Proved:** `npm run lint` clean; `npx tsc --noEmit` clean; `npm test` 12,183 tests, 27 fail — the same 27 failing names as plain main `8425410ff` in this worktree (name diff empty both ways), +97 new passing. Read-only dry run of the 407 logic against production data (inside `BEGIN READ ONLY`): it picks exactly the 4 SLO ad rows with 84/86/89/90; of the 18 visitor rows, **only 2 carry Meta ad tags** (both `oVid: SLO2`, ad set `120253626444640264`) and both resolve to **90**, lane **slo**; the other 16 have no ad tag at all (direct visits) and correctly stay NULL. Meta field names checked against Meta's Ads Action Stats reference and `facebook_business/adobjects/adsinsights.py`.
**NOT proved:** none of 406/407/408 has run on any database (no Postgres on this Mac; production is SELECT-only for agents). The SQL was reviewed by hand and its read path dry-run, not executed. No live Meta call was made (the account had 0 purchases anyway); the Meta rows in the tests follow Meta's documented shape, not a captured response. Payments in the roll-up are not shown on any screen yet (see M4 card).

**Live checks after the ship** (read-only; each inside `BEGIN READ ONLY; … COMMIT;`):
1. Applied: `SELECT key FROM schema_migrations WHERE key IN ('migrations/406_ad_lane_slo.sql','migrations/407_ad_number_from_meta.sql','migrations/408_ad_metrics_meta_results.sql');` → 3 rows.
2. Ads numbered: `SELECT name, external_id, fundhub_ad_number FROM ads ORDER BY name;` → oVid: SLO1 84, SLO2 90, SLO3 89, SLO4 86; oVid: 1/2/3 NULL.
3. Visitors: `SELECT count(*) AS rows, count(*) FILTER (WHERE utm_content IS NOT NULL) AS meta_tagged, count(ad_id) AS with_ad_number, count(*) FILTER (WHERE lane = 'slo') AS slo_lane FROM client_ad_attribution;` → on 2026-10-05 data: 18, 2, 2, 2 (more if new visitors came).
4. Tagged but still no number (should be empty for the SLO ads): `SELECT utm_content, utm_term, count(*) FROM client_ad_attribution WHERE utm_content IS NOT NULL AND ad_id IS NULL GROUP BY 1, 2;`
5. Shape: `SELECT attgenerated FROM pg_attribute WHERE attrelid = 'public.client_ad_attribution'::regclass AND attname = 'ad_id';` → '' (empty); `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.client_ad_attribution'::regclass AND NOT tgisinternal;` → `client_ad_attribution_ad_id_trg`.
6. Locked down: `SELECT has_function_privilege('anon', 'public.fundhub_meta_ad_number(uuid,text,text)', 'EXECUTE') AS anon, has_function_privilege('fundhub_app', 'public.fundhub_meta_ad_number(uuid,text,text)', 'EXECUTE') AS app;` → false, true.
7. After the next 07:00 UTC Meta pull: `SELECT count(*) AS ad_days, count(link_clicks) AS link_days, sum(link_clicks) AS link_clicks, sum(landing_page_views) AS lpv, count(purchases) AS purchase_days, sum(purchases) AS purchases, max(synced_at) AS last_sync FROM ad_metrics_daily WHERE date >= current_date - 28;` → link_clicks/lpv non-NULL on days the SLO ads ran (W4 saw 43–119 link clicks per SLO ad lifetime); purchases NULL until a real sale.
8. Sync note: the last Meta pull's answer carries `meta_results_saved: true` and `ad_numbers.filled` (no error).

**Picks made (safe defaults, not asked):** purchases/cost NULL (not 0) when Meta sends no line — Meta's docs do not promise zero lines are omitted, Ads Manager shows a dash. Payments = paid, non-demo `payment_links` only; `transactions` not added (same sale in both). Lane rule = the word SLO in the campaign name, so a later "$147" campaign also reads slo. A URL-encoded ad name (`oVid%3A+SLO2`) is not decoded (never a guess).

**M4's two cards for M1 — answered in `99e0f0d28`.**
- **Aug 4–16 spend never arrived ($560.78).** Cause, read off the saved rows (read only): the first rows were written 2026-08-24 23:04 UTC by a Sync press when the window was 7 days, so the earliest day it could ask for was Aug 17 — exactly the earliest day stored for all three August ads. The 28-day window and the daily pull came later (commit `3a3903c82` 2026-09-09; first logged ship 2026-09-16), by then Aug 4–16 was more than 28 days old. Nothing in the code ever asked Meta for a day older than its window. Not the cause: the account filter or the ad filter (the pull asks the whole ad account at level=ad; the three paused ads are in our table and have rows Aug 17–20).
  - **Fix in the sync** (`api/campaigns/sync.mjs` `needsFullHistory` / `earliestStoredDay`): when an ad account has nothing stored from before the window's first day, the pull asks Meta for `date_preset=maximum` (the whole history, up to 37 months, day lines drawn by Meta in the account's zone). If Meta refuses, the same run falls back to the 28-day window and says so in `stats.full_history`. Once older days are stored, pulls are the 28-day window as before. The Fundhub account already holds Aug 17+, so this rule does not reach back for it — the script does.
  - **One-time backfill:** `scripts/meta-backfill-ad-days.mjs`. GET-only on Meta; reads connections, ads and ad days; writes `ad_metrics_daily` ONLY with the sync's own upsert (`ON CONFLICT (ad_id, date) DO UPDATE`); never deletes; never creates ads (a Meta row for an ad we do not have is reported and skipped); idempotent; dry run by default. Days: no `--since` = Meta's whole history; a default `--until` is today in Arizona via `phoenixDay` (`src/slo/visitor.mjs`) — the same function M4's `src/lib/ad-account-day.mjs` re-exports as `adAccountDay`, so nothing was copied. It also fills purchases / cost per purchase / link clicks / landing page views on old days the 28-day pull no longer reaches.
  - **Proved:** `scripts/meta-backfill-ad-days.test.mjs` (18 tests, fake Meta + fake database: dry run writes nothing; `--write` upserts only `ad_metrics_daily`; a second `--write` leaves the table identical; Meta refusal = FAILED, nothing written; Arizona `--until`; missing-field values stay NULL). `src/http/campaigns-sync-history.test.mjs` (the rule, replayed against the 2026-08-24 first pull). `src/http/ad-number.pg.test.mjs` adds the whole-history request, its fallback, and the return to the window — **skips without DATABASE_URL, never run.**
  - **For the main session, after the ship** (needs `DATABASE_URL` and `AD_TOKEN_ENC_KEY`, the values the sync uses): `node scripts/meta-backfill-ad-days.mjs` (dry run — expect the three August ads to show missing days Aug 4–16 adding about $560.78), then `node scripts/meta-backfill-ad-days.mjs --write`. Check (read only): `SELECT min(date), max(date), count(*), round(sum(spend_cents)/100.0, 2) AS spend FROM ad_metrics_daily;` → min 2026-08-04, spend about $1,563 (plus any days after M4's count).
- **"0 conversions" is unknown.** The four 408 columns are added with no default and no NOT NULL, and 408 writes no value into any existing row, so every ad day saved before 408 reads NULL (unknown), never 0. The sync writes NULL when Meta sent no line. Pinned by `src/http/campaigns-sync-history.test.mjs` ("rows saved before 408 stay unknown") and the pg test's column check. Left as they were (not in the named job; the optimiser reads `conversions`): the old `conversions` and `reach` columns are still NOT NULL DEFAULT 0 — the report side should read `purchases` / `cost_per_purchase_cents` / `link_clicks` (NULL = unknown) instead of `conversions`.
- Not touched: M4's third card (`v_partner_spend_vs_ceiling` uses UTC `CURRENT_DATE`) — not one of the two named; 0 spend ceilings exist.

### M10 — dashboard back end, slice 1 (done, branch `m10-dashboard-backend`, head `dda703778`, 4 commits on `d86cfc94e`, not pushed)

- **1. `GET /api/marketing/today`** (`cde259111`). Owner/admin only: `requireAuth`, then `requireRole(ROLE_SETS.MARKETING)` (new set in `src/http/read-api.mjs`, owner + admin). Read only; each part reads in its own `asStaff()` transaction. Returns `as_of`, `today` (Arizona), `waiting`, `flywheel` (every folder under `marketing/flywheel/`, each stage line word for word with `npm run flywheel:status`), `copy` (house partner: last 10 copy pieces, last 5 copy jobs), `copy_ready` (switch, writer row, `ANTHROPIC_API_KEY` by name only, monthly budget; plain "missing" sentences), `spend` (today / last 7 / prior 7 / last 30 Arizona days, whole company, integer cents, `null` when no ad-days, never 0), `last_sync`. A missing table/column (42P01/42703/42883) or missing source data → that part empty + named in `waiting`; a dead database → 503; any other fault → 500.
  - **M11:** every key in your list above is exactly what the endpoint returns (checked against `api/marketing/today.mjs` at `dda703778`); nothing renamed. `copy_ready.partner_id` is null only when there is no house partner.
  - **Contract for M11:** `docs/specs/marketing-today-contract.md` (full JSON shape + how "Write ad copy" uses the existing `creative/generate` + `creative/run`).
  - Picks made (safe defaults, not asked): JSON keys are snake_case (`as_of`, `copy_ready`), matching the other endpoints; `as_of` = when the answer was built, and the Meta sync time is its own `last_sync` block; spend is the whole company (Chris's Meta account is synced under `fundhub-direct`, not the house partner — measured); "today" is usually `null` because the sync saves through yesterday.
- **2. Copy writing runnable** (`ffd534d1b`, `dda703778`). `src/creative/providers/copy.mjs`: OpenAI first; on "no credit" only, Anthropic once with the OpenAI keys left out of that call — the same rule as Social Studio's `callWriter` / the shared `readWithBackupReader`. No key touched. The rule lives in copy.mjs as `backupOnNoCredit` (only `model.mjs` imports) because importing `src/handlers/doc-check.mjs` dragged the vendor letter generator into the `creative-job-runner` zip and failed `sweeper-fontkit-in-zip.test.mjs` (caught by the full run, fixed in `dda703778`); a drift test runs both functions over every branch of the rule. `db/seed/296_marketing_copy_writer_house.sql`: one `creative_providers` row (`copy`/`copy`, priority 100, config `{}`) for the default company, `ON CONFLICT DO NOTHING`; house partner's `marketing_suite_enabled` on, upsert that writes only when not already on; no other partner, nothing deleted; sets `fundhub.actor=staff` transaction-local for the forced RLS. `db/expected-migrations.mjs` regenerated (one added line). No migration.
- **Shared-file lines (merge notes):** `netlify/functions/api.mjs` +1 import after `marketingFlagsWrite`, +1 route `"marketing/today"` after `"marketing-flags"`. `src/http/read-api.mjs` adds `MARKETING` at the end of `ROLE_SETS` — **M12: import `ROLE_SETS.MARKETING` from there, do not add a second one.** `src/pulse/registry.mjs` +`"marketing/today"` after `"marketing-flags"` (M12's `marketing/offer-generate` line goes right after it: trivial conflict). `netlify.toml` `included_files` + `"marketing/flywheel/**"` (428 KB) so the function can read the stage files. `scripts/flywheel/status.mjs` untouched. `api/creative/generate.mjs`: one comment fixed (it said no seed has a provider row).
- **Journeys:** the generated route line `| /api/marketing/today | GET | owner, admin |` (and `MARKETING` in README) inserted into the 9 generated journey files at the exact spot `npm run journeys` puts it — only that line, so the files stay as stale as on main and nothing else moves. New `docs/journeys/marketing-dashboard-flow.md`. One CHANGELOG line at the top.
- **Files:** `api/marketing/today.mjs` (new), `src/marketing/flywheel-status.mjs` (new) + `.test.mjs`, `src/http/marketing-today.test.mjs` (new, fake db), `src/http/marketing-today.pg.test.mjs` (new), `src/creative/providers/copy.mjs`, `src/creative/providers/copy.test.mjs` (new), `db/seed/296_marketing_copy_writer_house.sql` (new), `db/expected-migrations.mjs`, `netlify/functions/api.mjs`, `src/http/read-api.mjs`, `src/pulse/registry.mjs`, `netlify.toml`, `api/creative/generate.mjs` (comment), `docs/specs/marketing-today-contract.md` (new), `docs/journeys/marketing-dashboard-flow.md` (new), `docs/journeys/CHANGELOG.md`, 9 generated journey files (+1 line each).
- **Proof:** `npm run lint` clean; `npx tsc --noEmit` clean. Targeted: handler fake-db 27/27, flywheel 4/4 (compares against the real command's printed lines), copy writer 16/16 (7 behaviour + 9 drift checks against `readWithBackupReader`) — and 4 of the 7 behaviour tests FAIL on the old `copy.mjs` (no backup); `sweeper-fontkit-in-zip.test.mjs` passes. No real request in any test (fetch is faked and the global one throws). Read-only on production (each inside `BEGIN READ ONLY … COMMIT`): the endpoint's spend SQL returned last 7 = 60,653¢, prior 7 = 30,893¢, last 30 = 91,546¢, today `null`, and a plain `SUM(spend_cents)` over the same days gives the same three numbers; the copy/jobs/sync/provider SELECTs run clean. `EXPLAIN` (plans only, nothing executed, read-only transaction) of the seed's two INSERTs and of every pg-test fixture INSERT: all plan against the live schema (names, types, conflict indexes). Full `npm test` (no database): 12,133 tests, 12,102 pass, 27 fail, 4 skipped — every failing name is on O1's main list (`o1/known.names` and `o1/base.names`): 0 new. (The first full run caught one new failure — the fontkit zip test — which `dda703778` fixed.) Merge dry run against current `main` (`41cf84128`): clean.
- **NOT proved offline (no Postgres on this Mac):** `src/http/marketing-today.pg.test.mjs` skipped — exact sums in a company of its own, 401/403/admin, copy pieces/jobs, copy_ready, the house-partner seed effect, and a second run of seed 296 changing nothing and leaving another partner's switch off. Not proved: row security on the live reads as `fundhub_app`, the seed actually applying, Netlify shipping `marketing/flywheel/**` at the path the function looks (it also tries `LAMBDA_TASK_ROOT` and the working directory; if none has it, the flywheel part says "waiting" instead of failing), a real Anthropic write through the creative runner, and the `creative/run` web call finishing inside the function time limit (if it does not, the transaction rolls back and the 2-minute runner picks the job up).
- **After ship — read-only checks (each inside `BEGIN READ ONLY; … COMMIT;`):**
  ```sql
  -- 1. The seed ran. Expect one row.
  SELECT key, applied_at FROM schema_migrations WHERE key = 'seed/296_marketing_copy_writer_house.sql';
  -- 2. One copy writer row, default company. Expect exactly: fundhub | copy | copy | 100 | true | {}
  SELECT o.slug AS org, cp.asset_kind, cp.provider_key, cp.priority, cp.active, cp.config
    FROM creative_providers cp JOIN orgs o ON o.id = cp.org_id
   WHERE cp.asset_kind = 'copy';
  -- 3. Switches. Expect fundhub-house = true. Before ship (2026-10-05) all three rows read true:
  --    demo-partner, fundhub-house, test-role-partner. Expect the same three, unchanged.
  SELECT p.slug, s.marketing_suite_enabled, s.updated_at
    FROM partner_module_settings s JOIN partners p ON p.id = s.partner_id
   ORDER BY p.slug;
  ```
  Live endpoint: `GET https://fundhub.ai/api/marketing/today` with no session → 401; as the owner → 200 with `copy_ready.ready = true` and no `flywheel` in `waiting`.

### M12 — offer generator on the server (done, branch `m12-offer-generator`, head `3decbfd93`, not pushed)

**What it does:** the dashboard's **Write offer** button now has a back end. `POST /api/marketing/offer/generate` (owner/admin) saves a queued run and wakes a background writer; the writer runs flywheel stage 3 (the `.claude/workflows/offer.js` rubric): **one** Anthropic call writes six offers (one per assigned lever), **one** call seats the four judges (buyer, operator, accountant, competitor) over the blinded set, plain code averages/weights the scores and picks the winner (run-off flag within 5%, unjudged offers named, never scored as zero), **one** call writes the winner up with the losers' best parts grafted in, then plain code checks every price against `src/config/offers.mjs` and builds the flywheel review card (what this decided / three things to check / what I wasn't sure about / say one of). If the write-up call fails, the winner stands as first written and the card says so.

**Picks made (safe defaults, not asked):**
- **Route vs file:** the brief named both `marketing/offer/generate` and `api/marketing/offer-generate.mjs`; `src/http/routes.test.mjs` requires the ROUTES key to BE the file path. Kept the URL M11 was told: **file is `api/marketing/offer/generate.mjs`**, key `marketing/offer/generate`.
- **Background function, not the /api function:** three model calls take minutes; `/api` is killed at 26 s (measured 2026-09-23). New `netlify/functions/marketing-offer-background.mjs` (15 min). The POST wakes it with **the owner's own session token** (the worker re-checks session + owner/admin + same company + still queued) — so **no new secret / env var** is needed.
- **Model:** `claude-opus-5-5` through the repo's own `callModel` (`src/agents/model.mjs`), forced to Anthropic by handing it an env with only `ANTHROPIC_API_KEY` (the `src/ad-videos/match.mjs` trick; OpenAI has no credit). No SDK, no new dependency.
- **Inputs:** each optional; a missing one defaults exactly as the `/flywheel` chat command does — body of `marketing/flywheel/<campaign>/01-avatar.md`, `02-ad-research.md`, the `## Notes` of `00-OWNER-NOTES.md`, cut to offer.js's 8000/8000/2000 chars. Avatar required (400 otherwise). Facts = the price list built from `src/config/offers.mjs` only; the prompt states that cost per customer / close rate / ad budget are NOT on file.
- **Saving:** no existing table fits (`generation_jobs` is claimed by the creative-job-runner every 2 min and has no result column; `creative_assets` only allows static/video/copy with an ad aspect ratio). **ONE migration: `409_marketing_jobs.sql`** = the owner-approved spec's `marketing_jobs` table (§6 Step 3 columns exactly + `requested_by`, timestamps), 403 RLS pattern, DB rules: failed needs a reason, done needs a result, **one offer in flight per company** (partial unique index). 409 = next free after M1's 406–408.
- **One additive line each** in shared files: ROUTES (`netlify/functions/api.mjs`), `src/pulse/registry.mjs` API_KEYS (`registry.test.mjs` requires it), `src/lib/no-unfenced-transmit.test.mjs` ALLOWED_RAW_FETCH (`src/marketing/offer-transport.mjs`, reason written; spec §6 Step 4 names this wake), `netlify.toml` included_files `"marketing/flywheel/**"` (dashboard plan §4 step 4 — without it the defaults read nothing on Netlify; if M10 adds the same line, keep one).

**Contract (for M11):** `docs/specs/marketing-offer-contract.md`. Short form:
- `POST /api/marketing/offer/generate` body `{campaign?, avatar_summary?, ad_research_summary?, owner_notes?}` → `202 {ok, started:true, already_running:false, job, poll:"/api/marketing/offer/generate?id=<id>", message}`; second press while running → `202 {started:false, already_running:true, job}`; `400 bad_campaign|bad_input|avatar_required`; `401`/`403`; `502 worker_unreachable` (row saved failed with reason); `503 no_model|not_ready|db_unavailable`.
- `GET /api/marketing/offer/generate?id=<id>` → `200 {ok, ready:true, job, offer|null}`; no id → newest run + newest finished offer (the Offer card). Before ship → `200 {ok:true, ready:false, job:null, offer:null, message}`.
- `job` = `{id, status: queued|running|done|failed, campaign, created_at, claimed_at, finished_at, attempts, requested_by, error}`. `offer` = `{job_id, campaign, as_of, finished_at, offer:{oneSentence,name,price,whyThisPrice,whatTheyGet[],guarantees[],bonuses[],tookFromLosers[],killShotsAnswered[],thirtyDayMath,claimsRemoved[]}, review_card:{whatThisDecided, threeThingsToCheck[3], notSureAbout[], sayOneOf, markdown}, document, synthesized, winner, runner_up, runoff_advised, scores[], unjudged[], candidates[6], counts, checks:{priceIssues[]}, inputs:{sources,cut}, model, usage}`.
- Wire it: POST, then poll GET `?id=` every 5–10 s until `done`/`failed`; show `review_card` first, then `offer.name` + `offer.price`; `job.error` is already a plain sentence.

**Files:** `api/marketing/offer/generate.mjs` (new), `netlify/functions/marketing-offer-background.mjs` (new), `src/marketing/offer-rubric.mjs`, `offer-inputs.mjs`, `offer-generator.mjs`, `offer-transport.mjs`, `offer-store.mjs`, `offer-run.mjs` (+ `offer-*.test.mjs`, `fixtures/offer-replies.mjs`, `fixtures/offer-fake-db.mjs`) (all new), `src/http/marketing-offer-generate.test.mjs` + `.pg.test.mjs` (new), `db/migrations/409_marketing_jobs.sql` (new), `db/expected-migrations.mjs` (+1 line, via `npm run migrations:manifest`), `netlify/functions/api.mjs` (+import, +1 route), `src/pulse/registry.mjs` (+1), `src/lib/no-unfenced-transmit.test.mjs` (+1 entry), `netlify.toml` (+1 included file), `docs/specs/marketing-offer-contract.md` (new), `docs/journeys/marketing-offer-flow.md` (new), `docs/journeys/CHANGELOG.md` (+1 line). Not touched: any `-intended.md`, `src/agents/model.mjs`, `src/http/read-api.mjs`, M10/M11 files.

**Role gate:** `ROLE_SETS.OPS` (owner, admin), named in the handler's own text because `scripts/journeys/generate.mjs` reads gates off the source and cannot resolve an alias. M10 adds `ROLE_SETS.MARKETING` (same two roles) on its branch; it is not on main, so this branch cannot name it. After the merge, swapping `ROLE_SETS.OPS` → `ROLE_SETS.MARKETING` in `api/marketing/offer/generate.mjs` and `src/marketing/offer-run.mjs` is optional and changes nothing. M11's read list above (route, `job.*`, `offer.*`, `review_card.*`, poll `?id=`) matches this contract exactly.

**Proof:** 
- `npm run lint` clean; `npx tsc --noEmit` clean.
- Targeted: 52 offer tests pass (`src/marketing/*.test.mjs`, `src/http/marketing-offer-generate.test.mjs`) — pure parsing/blinding/judging/price/gate/review-card checks, the real `callModel` under a fake fetch answering recorded Anthropic-shaped bodies (only `api.anthropic.com` is called even with an OpenAI key set; masked key → no call; timeout aborts the request), and the real handler + real `verifySession` + the real store SQL text against an in-memory table (401/403/405, 202 start, second press returns the same run, wake failure → row failed + 502, no key → 503 and nothing saved, bad campaign/no avatar → 400, before-ship GET `ready:false` / POST 503 `not_ready`, background writer refuses no session / closer / bad id). Guards pass: `routes.test`, `auth-gate`, `rls-shape` (static), `scheduled-functions-return`, `sweeper-fontkit-in-zip`, `health-migrations`, `scripts/journeys/generate.test` (owner/admin docs now list the route).
- Full `npm test` at the end: 12,139 tests, 12,109 pass, **26 fail**, 4 skip (no database). Failing names vs O1's plain-main lists (`o1/base.names` ∪ `o1/base2.names`): **0 new**. 4 of main's names pass here (the 2 journeys tests, because this branch regenerated `docs/journeys/*-actual.md`; "$297 order Purchase" and "no raw email or phone…" are flaky on main).
- **ONE real run** (the allowed smoke), production `ANTHROPIC_API_KEY` read from the gitignored `.env` (never printed), inputs = the partner flywheel files, no database: **done in 4 min 29 s** — six offers 118 s (8,458 in / 12,931 out tokens), judges 97 s (11,673 / 10,204), write-up 54 s (4,420 / 5,505); all `end_turn`; 6 of 6 offers parsed, all 4 seats scored all 6, winner F-sequence ("Trial, Partner, Segment", 5.13; A-dream runner-up 4.95 → run-off flagged), 0 price issues, write-up grafted. Cost ≈ **$0.67** (claude-opus-5-5, $4/$20 per M) — more than "a few cents"; `OFFER_MODEL` in `src/marketing/offer-transport.mjs` is the one line to change if Chris wants a cheaper model. Fixes made from what it showed (commit `15f1d1acb`): token cap 16k → 24k (first call used 12.9k), "None" no longer counts as a bonus, long price line shortened on the card, the stage 3 gate (0 of 3 bonuses that run) now named on the card. The recorded replies were replayed offline through the final code: same winner, gate miss named, price question short.

**NOT proved offline (no Postgres on this Mac):** the SQL against real Postgres and the four DB rules (CHECKs + the partial unique index + `ON CONFLICT … WHERE` inference) — `src/http/marketing-offer-generate.pg.test.mjs` proves them in CI and skipped here; the background function actually being invoked by Netlify from `/api` (same mechanism as ad-video-sweeper → ad-video-worker-background); `process.env.URL` present in the /api function at run time; the `marketing/flywheel/**` files actually landing in the Netlify zip; a full run inside the 15-minute limit on Netlify (the smoke ran on the Mac).

**Merge notes:** `docs/journeys/*-actual.md` + `docs/journeys/README.md` were regenerated here (§4) — on a conflict, re-run `npm run journeys` on the merged tree instead of hand-merging. After M1 merges, re-run `npm run migrations:manifest` (both branches add lines to `db/expected-migrations.mjs`). Production already has `430–433` applied (see leftover card), so 409 is still free there.

**After ship — read-only checks (each inside `BEGIN READ ONLY; … COMMIT;`):**
```sql
-- 1. The table is live, with its rules and row security.
SELECT key, applied_at FROM schema_migrations WHERE key = 'migrations/409_marketing_jobs.sql';
SELECT conname FROM pg_constraint WHERE conrelid = 'public.marketing_jobs'::regclass ORDER BY 1;
SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'marketing_jobs' ORDER BY 1;
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.marketing_jobs'::regclass;
-- 2. After the first press of Write offer: expect queued → running → done within ~5 minutes.
SELECT id, status, left(error, 120) AS error, attempts, created_at, claimed_at, finished_at,
       result->'winner'->>'archetype' AS winner, result->'reviewCard'->>'whatThisDecided' AS decided,
       result->'checks'->'priceIssues' AS price_issues, result->'usage'->>'output_tokens' AS out_tokens
  FROM marketing_jobs WHERE kind = 'offer' ORDER BY created_at DESC LIMIT 5;
```
Live: `curl -s -o /dev/null -w '%{http_code}' https://fundhub.ai/api/marketing/offer/generate` → `401` (route is live, gate holds). As the owner, GET → `{"ok":true,"ready":true,...}`. One press → `202`, then the row above reaches `done`.

### M11 — Marketing Command Center page (done, branch `m11-dashboard-page`, head `a581fb0ff`, 7 commits on `d86cfc94e`, not pushed, not shipped)

- **What it is:** a new owner/admin screen, https://fundhub.ai/app/marketing-command-center.html after ship. Menu: Marketing → **Command Center** (first row). Top-left: ad spend for the last 7 days vs the 7 before, with the Meta "as of" time. Then spend for 30 days (+ today so far), machine parts ready (N of 6), **Write ad copy** (the only filled button), Waiting on you (read off the flywheel), the Offer card (review card first, then name and price; **Write offer** starts M12's run and the page asks every 10 s, up to 16 min), the five flywheel steps + the checker's advice line, the machine parts list, latest ad copy + last tries. Unknown shows "unknown", never $0. Before M10/M12 ship it says "not ready yet".
- **Reads:** M10 `GET marketing/today` (`docs/specs/marketing-today-contract.md`) and M12 `GET/POST marketing/offer/generate` (`docs/specs/marketing-offer-contract.md`). Write ad copy = the existing `POST creative/generate` then `POST creative/run`, with `copy_ready.partner_id`.
- **Files:** `public/app/marketing-command-center.html` (new), `public/app/marketing-command-center.js` (new), `public/app/shell.js` (ALL + OWNER_ADMIN_ONLY + synced SIDEBAR_HTML), `public/app/sidebar.fragment.html` (+1 row), 32 other `public/app/*.html` (+1 sidebar line each, by `node scripts/sync-sidebar.mjs`), `src/pulse/registry.mjs` (+1 DESK_FILES line), `src/ui/marketing-command-center.test.mjs` (new, 44 tests), `e2e/marketing-command-center.spec.mjs` (new, 11 browser tests), `docs/journeys/CHANGELOG.md` (+1 line). No route, no migration, no API, no `-intended.md`.
- **Proof:** `npm run lint` clean; `npx tsc --noEmit` clean; page tests 44/44; UI + sidebar + pulse guards 220/221 (the 1 is main's known pulse-registry failure: eeo-survey, eeo-aggregate, scripts/list, waypoint-tick — the new page is not in it); Playwright offline 11/11 (loading, full, empty, not-shipped, signed out, Write ad copy end to end + a refusal that runs nothing, Write offer followed to done, closer bounced, sidebar row, 390px one column with no sideways scroll; computed sizes 32/20/13/16 px and the brand shadow asserted); `sidebar-roles` + `screens-smoke` 40/40. Full `npm test`: 12,133 tests, 27 fail — **0 new names** vs `o1/base.names` and `o1/known.names`. Contract run (scratch): M10's committed handler (`dda703778`) with a fake database and the real flywheel files, fed through the page logic — live-like, no house partner, and switch/writer/key off all render right. Merge dry-run: m11+m10 clean, m11+m12 clean.
- **Screenshots (marked, red boxes + numbered legend; evidence folders are gitignored):** `/Users/chrisstanbridge/Developer/fundhub-platform/ops/workflows/perfect-machine-2026-10-05-evidence/m11/shots/*-MARKED.png` (9: loading, today desktop, offer + flywheel, write ad copy, write offer, not ready yet, empty, phone 390 ×2).
- **Picks (safe defaults, not asked):** menu label "Command Center" under the Marketing heading (page title "Marketing Command Center"). While the offer writer is not live, Write offer shows "not ready yet" and rests (disabled) — UI-STANDARDS §5 says a control that does nothing should not render; the brief said show "not ready yet", so it shows, resting, with the reason. M10's `waiting` = machine parts; "Waiting on you" = flywheel steps to approve or redo.
- **Merge notes:** the sidebar sync adds one line inside every screen's `<aside>` and rewrites `SIDEBAR_HTML` in `shell.js` (one long line). Any branch that also changes the sidebar conflicts on that line: take either side, then re-run `node scripts/sync-sidebar.mjs`. CHANGELOG: one line at the top.
- **Look live after ship (owner):** https://fundhub.ai/app/marketing-command-center.html — spend tile shows a dollar figure and "as of"; Machine parts all "Ready" once M10's seed and switch are live; type a few words, press **Write ad copy** → green "Done…" and the words; Offer card shows the newest offer or "No offer has been written here yet."; **Write offer** → "Writing the offer…", then the offer in about 5 minutes.

<!-- O1 section start: O1 rewrites only between these two markers -->
## Oversight (O1)

Final pass: 2026-10-05 19:31 MST. Every worker is done or blocked; O1 is finished. O1 edited only this section, the V1 restore, the 19:16 notice and the W4 verdict line on the finish board.

### Internet drop (about 18:03 MST) — every worker and O1 died; all resumed about 18:37

What each one had saved when it died:

| Worker | Commits ahead of main at the drop | On disk, not committed | Other saved work |
|---|---|---|---|
| W4 | 17 (head `c81b86bbc`) | `e2e/zz-w4-proof.spec.mjs` (new) | board text in scratch `w4-board-section.md` |
| M1 | **0** | `api/campaigns/sync.mjs`, `src/ads/store.mjs`, new `src/ads/meta-results.mjs`, new migrations 406, 407, 408 | scratch `m1/` |
| M2 | 2 | nothing | — |
| M3 | 3 | `src/pulse/daily-pulse.mjs`, `src/workflows/daily-pulse.mjs`, new `src/pulse/machine.mjs` | — |
| M4 | **0** | 13 files | — |
| M5 | 0 | nothing | spec copy + refs in scratch |
| M6 | 0 | nothing | audio test files in scratch `m6/` |
| M7 | 0 | nothing | nothing |
| M8 | 0 | nothing | scratch `m8/` |
| M9 | 0 | nothing | scratch `m9-live-fh-events.js` |

Restart watch (deadline 18:48): **all restarted.** W4 finished (board 18:39). M2 commit 18:41, M3 18:43, M4 18:38 and 18:44, M5 finished and merged 18:43, M7 18:41, M8 18:44, M9 18:45, M1 and M6 writing files at 18:45. Nobody flagged.

### Workers

| Worker | Status | Last sign of life | Verdict |
|---|---|---|---|
| W4 | done (finish board), head `c81b86bbc` | 18:39 board | **PASS** |
| M1 | done, head `99e0f0d28` | 19:07 commit | **PASS-WITH-NOTES** |
| M2 | done, head `44924292e` | 19:04 commit | **PASS** (re-checked on the new head) |
| M3 | done, head `56e873b3e` | 18:44 commit | **PASS** |
| M4 | done, head `7e0d272ec` | 18:56 commit | **PASS** |
| M5 | done, merged to main (`91c961bad`) | 18:43 | **PASS** |
| M6 | done, head `1bef065aa` | 19:06 commit | **PASS-WITH-NOTES** |
| M7 | done, head `5cfdb946a` | 18:41 commit | **PASS** |
| M8 | done, head `d4378d1f3` | 18:53 commit | **PASS-WITH-NOTES** |
| M9 | done, head `96c8904de` | 18:51 commit | **PASS** |
| M10 | done, head `dda703778` | 19:12 commit | **PASS** |
| M11 | done, head `a581fb0ff` | 19:18 commit | **PASS** |
| M12 | done, head `3decbfd93` (adds migration 409) | 19:16 commit | **PASS-WITH-NOTES** |
| V1 | **blocked** (no Postgres on this Mac) | 18:59 scratch text | — see hangups |

**W4 — PASS** (O1 re-ran it in its own scratch copy of `c81b86bbc`): `npm run lint` clean; `npx tsc --noEmit` clean; unit tests 12,094 / 12,063 pass / 27 fail / 4 skip — **0 new failures** (every failing name is on the known list from plain main). Claim 1 re-checked: `src/contracts/send.mjs` refuses with 409 `placeholder_text` before it reads signers; a read-only query of the live database shows exactly 2 templates still carry the "NOT THE REAL AGREEMENT TEXT" marker (`CREDIT-REPAIR-AGREEMENT`, `FUNDING-AGREEMENT`), the other 9 do not, so only those 2 will refuse. Claim 2 re-checked: `npx playwright test --list` = 430 tests in 40 files, 0 `live-*` specs (9 exist in `e2e/`). Note: W4 is built on old main `99d86a3ff`; it still merges into today's main with no conflict.

**M2 — PASS** (O1's own copy of `95d8faf4d`): lint clean; typecheck clean; unit 12,158 / 12,127 pass / 27 fail / 4 skip — **0 new failures**. Re-checked: `src/ops/watch-curve.mjs` now imports the named `send` that `notify-fanout.mjs` exports (line 37); the ClickFunnels night job lists accounts through `asStaff`. Live (read-only): all 7 ads are `PAUSED`, 0 rows in `ad_watch_curve_alerts` and `ad_watch_curve_diagnoses` — matches the manifest ("nothing to buzz until an ad is on").

**M3 — PASS** (copy of `56e873b3e`): lint clean; typecheck clean; unit 12,116 / 12,086 pass / **26 fail** — 0 new, and it fixes the known "registry: every routed api/ handler…" failure. Re-checked: cron is `TZ=America/Denver 0 7 * * *`; `src/pulse/machine.mjs` imports `diesBefore25Percent` and `SWEEP_CRON`, and both are exported on `main` and on M2's branch, so M3 works merged with or without M2. Live (read-only): `agent_runs` AG-07 ran 14 of the last 14 days at 13:01–13:03 UTC; outcome `fail` 09-22..09-26, `pass` 09-27..10-05 — matches the manifest.

**M7 — PASS** (copy of `5cfdb946a`): lint clean; typecheck clean; unit 12,091 / 12,060 pass / 27 fail — 0 new. Re-checked: `dispatch.mjs` asks the provider's `refusedAddress()` before sending and saves `status='blocked'`; `messages.status` is plain text (no check list), so `blocked` is a legal value on live. Live (read-only, last 14 days): Welcome 6 failed — all 6 to `@example.com`; Finish-application 5 failed — all `@example.com`; Welcome 2 bounced — both to the `e2e+…@fundhub.ai` test address. Matches the manifest.

**M1 — PASS-WITH-NOTES** (copy of `99e0f0d28`): lint clean; typecheck clean; unit 12,183 / 12,152 pass / 27 fail — 0 new. Re-checked: the sync writes the four new Meta columns only when `hasMetaResultColumns()` finds all four, so before 408 runs the old write is unchanged; `db/migrate.mjs` runs each file in its own transaction, so 406's new `slo` value is committed before 407 uses it. Live (read-only): 18 visitor rows, only 2 carry a Meta tag (both `oVid: SLO2`), 0 have an ad number today; 7 ads (`oVid: 1/2/3`, `oVid: SLO1–4`), 0 numbered — matches the manifest. **Note:** migrations 406, 407, 408 have never run on any database (407 turns `client_ad_attribution.ad_id` from a generated column into a trigger-filled one). The V1 task (scratch Postgres) should apply them before SHIP; until then this is the riskiest part of the ship.

**M2 — PASS on new head `44924292e`** (4th commit: hop test uses link clicks when saved): lint clean; typecheck clean; unit 12,168 / 12,137 pass / 27 fail — 0 new.

**M4 — PASS** (copy of `7e0d272ec`): lint clean; typecheck clean; unit 12,108 / 12,077 pass / 27 fail — 0 new. Re-checked: one helper owns the ad day, `AD_TODAY_SQL = (now() AT TIME ZONE 'America/Phoenix')::date`, and the KPI read uses it; "new clients" now drops test addresses (`andNotTestAddress`). Live (read-only): new clients in the last 7 days = 23 before the filter, **4** after — matches the manifest.

**M8 — PASS-WITH-NOTES** (copy of `d4378d1f3`): lint clean; typecheck clean; unit 12,110 / 12,079 pass / 27 fail — 0 new. Re-checked: the ClickFunnels adapter now keys a booking on the call's own id (`data.id`, then `subject_id`, then `data.public_id`), not the message id. Live (read-only): `bookings` has **0 rows** while `events` has 74 `booking.created`, 1 `booking.cancelled`, 15 `booking.noshow`. **Note:** the new wake-time check reads the `bookings` table; with 0 rows it answers "unknown" and behaves as before, and M8 found ClickFunnels has no reschedule/cancel webhook subscribed. So the stop-on-move works only when a `booking.rescheduled` / `booking.cancelled` event actually arrives. Code is right; the live effect depends on those two things (M8's cards).

**M6 — PASS-WITH-NOTES** (copy of `1bef065aa`): lint clean; typecheck clean; unit 12,148 / 12,117 pass / 27 fail — 0 new (includes the real-ffmpeg join tests). Re-checked: the sweeper change is one import + one call before `advance()`; `notify-fanout.mjs` and the saveFinished code are untouched; `ffmpeg-static` was already a dependency (no new one). **Note:** the Netlify worker has no ffmpeg/whisper.cpp, so after the ship every angle with 2+ takes **waits at `staged`** until someone runs `node scripts/ad-video-join-takes.mjs --live` on the Mac. That is on purpose (the law says never ship a lone take), but it means multi-take ads stop flowing to Submagic on their own. Never tried on a real 4K take.

**M10 — PASS** (copy of `dda703778`): lint clean; typecheck clean; unit 12,133 / 12,102 pass / 27 fail — 0 new. Re-checked: `api.mjs` gets exactly 1 import + 1 route (`marketing/today`); new seed `db/seed/296_…` number is free. Live (read-only): all 3 `partner_module_settings` rows (demo-partner, fundhub-house, test-role-partner) read `marketing_suite_enabled = true` — matches the manifest.

**M12 — PASS-WITH-NOTES** (copy of `3decbfd93`): lint clean; typecheck clean; unit 12,139 / 12,109 pass / **26 fail** — 0 new (it regenerated the journey pages, so 2 known journey failures pass). Re-checked: ROUTES key `marketing/offer/generate` = file `api/marketing/offer/generate.mjs`; new background function `netlify/functions/marketing-offer-background.mjs` exists. Live (read-only): production has migrations up to 405, then **430–433** (applied 21:20 UTC today; those files are in no git branch here), so **409 is free**. Notes: (1) it adds a new raw-fetch exception (`src/marketing/offer-transport.mjs`) to the fence allow-list — CLAUDE.md §12 says new outbound calls belong behind a provider module; this is the same question W4 raised (W4-Q1). (2) It gates on `ROLE_SETS.OPS`; after M10 merges it should name `ROLE_SETS.MARKETING` (same two roles; M12's own note).

**M11 — PASS** (copy of `a581fb0ff`): lint clean; typecheck clean; unit 12,133 / 12,102 pass / 27 fail — 0 new. Re-checked: every other screen gets exactly one sidebar line (e.g. `pipeline.html` +1 line), `src/pulse/registry.mjs` +1 line (`marketing-command-center.html`); the 9 marked screenshots exist under `ops/workflows/perfect-machine-2026-10-05-evidence/m11/shots/`.

**M9 — PASS** (copy of `96c8904de`): lint clean; typecheck clean; unit 12,100 / 12,071 pass / **25 fail** — 0 new, and it fixes 2 known Meta failures ($297 InitiateCheckout, door Purchase). Re-checked: `src/meta/map.mjs` marks Purchase `serverCopy: false` and `metaEventsFor` skips it, so the payment webhook is the only server Purchase. Live (read-only): 94 page views carry a Meta reply and all 94 use the `pv.*` id — matches the manifest.

**M5 — PASS**: one new file only (`docs/specs/marketing-dashboard-plan-2026-10-05.md`), no code. Re-checked: the old `docs/specs/marketing-e2e-spec.md` was deleted by `b5076e58e` (2026-10-02); spec v3 does reserve migration numbers 406–429, which overlaps M1's 406–408 (M5's plan already says to take the next free number after M1); `public/app/marketing-command-center.html` does not exist yet (plan only, as stated).

**Sanctioned exception (main session authorized, 18:51):** M9 changes `public/funnel/fh-events.js` and `src/ads/fh-events-meta.test.mjs`, which the ownership list gives to no one / to M1. O1 checked commit `96c8904de`: the `fh-events.js` diff is the price value only (`value: 297` → `value: 147`, one line, nothing else); M1's branch does not touch `src/ads/fh-events-meta.test.mjs`, so no clash. Not a violation.

Hangups:
- **Board text lost (twice, about 19:00–19:10):** manifests for M1, M4, M8 and M9 vanished. One possible cause was O1 (until 19:08 its writer replaced everything from its heading to the end of the file); another is a worker writing back an old copy of the whole board. Fixed on O1's side: O1's section sits between HTML markers and O1 rewrites only between them; O1 also keeps a copy of both boards in its scratch folder every pass (`o1/bk/`), so lost text can be put back. A notice under the board rule (19:16) tells M6, M10, M11, M12 to re-read right before saving and append only.
- **V1 is blocked (needs a decision only the main session / Chris can make).** No Postgres on this Mac; Homebrew is not installed and installing it asks for Chris's Mac password. So migrations 406, 407, 408, 409 and seed 296 have **never run on any database**, and no `.pg.test.mjs` has run for any branch. V1's own write-up was missing from the board; O1 restored it from V1's scratch file (`## V1 database proof` at the end of the board). Unblock, pick one: (a) Chris types his Mac password once to install Homebrew, then an agent installs Postgres 16 + pgvector and re-runs V1; (b) main session approves Postgres.app (no password, `/Applications` is writable; check it has pgvector); (c) main session pushes one merged proof branch to GitHub so CI's `pgvector/pgvector:pg16` job applies every migration to an empty database.
- **Manifest audit 19:16 — nothing missing now.** Every finished worker has its manifest on a board: W4 (finish board, plus 6 cards and 3 questions), M1 (re-posted), M2, M3, M4 (re-posted), M5, M6, M7, M8 (re-posted), M9 (re-posted), M10. Leftover cards present for M1 (11), M2 (9), M3 (7), M4 (14), M6 (2), M7 (3), M8 (3), M9 (3), M10 (2). The "Blockers and questions" section is empty (workers picked safe defaults); the re-posted M8, M9 and M4 manifests were appended under its heading, which is fine. M5 has no cards (its manifest names one blocked read). Nothing needed restoring from scratch.

Collisions (none broken yet; dry-run merges all clean):
- `docs/journeys/CHANGELOG.md`: W4, M2, M3, M8, M9 each add a line.
- `src/workflows/index.mjs`: M2 and M3.
- `public/app/campaign-manager.html`, `public/app/pipeline.html`, `src/http/pipeline-screen.test.mjs`: W4 and M4 (different lines; W4 drops the "— held" figure, M4 makes the funding total show "—" instead of $0 when no card has an estimate — they agree).
- Expected later (coordinator list): W4 + M11 on `public/app/shell.js` and sidebar tests — **today W4 does not touch `shell.js` or any sidebar test**, so no clash there unless W4 changes again; M10, M11, M12 each add a line to ROUTES in `netlify/functions/api.mjs`; M3 + M11 on `src/pulse/registry.mjs`; M12 migration number must follow M1's 406–408.
- Predicted: `db/expected-migrations.mjs` is generated from `db/schema`, `db/migrations` **and** `db/seed`, so M1 (migrations), M10 (new seed file) and M12 (if it adds a migration) will each change it. If two branches both regenerate it, the merge conflicts; the fix is to re-run `npm run migrations:manifest` after the merges.
- Migrations: only M1 (406–408, now committed; M1 also regenerated `db/expected-migrations.mjs`). No duplicates.
- Early warning (still on disk, not committed): **M11 edits about 30 screen files** (the sidebar is copied into every `public/app/*.html`, plus `shell.js` and `sidebar.fragment.html`). Many of those are the same files W4 changed (top bars, copy) and M4 changed (`campaign-manager.html`, `pipeline.html`). O1 will dry-run as soon as M11 commits.
- `src/pulse/registry.mjs`: M3 (committed), M10 (on disk: one line `marketing/today`), M11 (on disk). Different lines so far.
- M10 also edits files outside its list: `netlify.toml` (adds `marketing/flywheel/**` to the function's included files, so the Today tab can read the stage files on Netlify), `src/http/read-api.mjs` (new `MARKETING` role set: owner + admin), `src/pulse/registry.mjs`. No other branch touches the first two.
- No `-intended.md` or `.claude/settings*.json` edits on any branch.

Merge dry-run 19:24 (scratch worktree off `main` `d86cfc94e`; nothing committed to main, nothing pushed), order W4 → M1 → M2 → M3 → M4 → M6 → M7 → M8 → M9 → M12 → M10 → M11, every branch at its final head:
- W4, M1, M2, M3, M4, M6, M7, M8, M9, M11: **clean**.
- **M12 after M1: conflict in `db/expected-migrations.mjs`** (generated list; both add lines). Fix: take either side, run `npm run migrations:manifest`. Owners M1 + M12.
- **M10 after M12: conflict in `src/pulse/registry.mjs`** (M12 adds `"marketing/offer/generate"`, M10 adds `"marketing/today"` on the same spot — keep both lines) **and in 8 generated `docs/journeys/*-actual.md` files** (M12 regenerated them, M10 hand-inserted one line). Fix: keep M12's files, then run `npm run journeys`. Owners M10 + M12.
- `netlify.toml`: M10 and M12 each add the same `"marketing/flywheel/**"` line in two places of one list. Merges clean; the list then names it twice (harmless; delete one).
- After those three fixes (done only in O1's scratch copy), the combined tree of all 12 branches: `npm run lint` clean (2,409 files); `npx tsc --noEmit` clean; the two ship guards 26/26 pass; `npm run migrations:manifest` makes no diff; new migrations 406, 407, 408, 409 — no duplicate number; unit tests 12,595 / 12,568 pass / **23 fail — 0 new** (main has 27).

SHIP-READY: **no** — one blocker: **V1** (no database proof: migrations 406, 407, 408, 409 and seed 296 have never run on any database, and repo law says a skipped `.pg.test.mjs` is not green). Everything else is ready: all 12 branches re-verified by O1 (8 PASS, 4 PASS-WITH-NOTES, 0 FAIL), and the merge of all 12 is clean apart from 3 known, mechanical fixes.
Minimal merge order (all heads final): W4 `c81b86bbc` → M1 `99e0f0d28` → M2 `44924292e` → M3 `56e873b3e` → M4 `7e0d272ec` → M6 `1bef065aa` → M7 `5cfdb946a` → M8 `d4378d1f3` → M9 `96c8904de` → M12 `3decbfd93` (conflict in `db/expected-migrations.mjs`: run `npm run migrations:manifest`) → M10 `dda703778` (keep both lines in `src/pulse/registry.mjs`, keep M12's journey files, run `npm run journeys`) → M11 `a581fb0ff`. Optional tidy: drop the second `"marketing/flywheel/**"` in `netlify.toml`. Fact for the main session: W4, M2, M3, M4, M6, M7, M8, M9 and M11 add no SQL; only M1 (406–408), M10 (seed 296) and M12 (409) do. Without M10/M12, the M11 page shows its "not ready yet" state; without M1's 408, M2's hop test counts every click (M2's note).
<!-- O1 section end -->

## Leftover cards (one line each, do not fix)

- (M10, owner of `scripts/flywheel/`) `parseFrontMatter` in `scripts/flywheel/status.mjs` reads an all-digit 8-character input hash (for example `03267339`) as a number, so it never equals `bodyHash()` and that stage shows STALE though nothing changed (about 1 hash in 43). Found while building the M10 test fixture; the fixture avoids it; not fixed.
- (M10, owner of `src/creative/`) `api/creative/run.mjs` and `src/creative/runner.mjs` claim and run a job inside one `withPartnerScope` transaction, so a database connection stays open for the whole model call (marketing-machine spec §4 trap 3 says never). Not fixed.
- M6 → M1: `ad_videos` has no `joined` state or `joined_into` column, so a take closed into another take's master is recorded as `failed` with reason `joined into one master: …`. A migration (new state or column) would make it read honestly. Not fixed.
- M6 (tripped over, not fixed): `matchAndRename()` in `src/ad-videos/pipeline.mjs` renames the raw Drive take to `084_t01_raw_YYYY-MM-DD.mp4` (`naming.rawFileName`), which `marketing/ads/NAMING.md` lists as a wrong Drive name.

- [M4 → M1] Meta spend Aug 4–16 (23 ad-days, $560.78) never reached `ad_metrics_daily`; the sync window is 28 days. Meta since Aug 4: $1,563.13; DB: $1,002.32. One backfill run with since=2026-08-04 (`api/campaigns/sync.mjs:390-394`). — **answered by M1 `99e0f0d28`** (see M1 manifest).
- [M4 → M1] `ad_metrics_daily.conversions` and `.reach` are NOT NULL DEFAULT 0 and Meta is never asked for them, so the campaign drawer shows 0 conversions for unknown. Needs NULL-able columns or a real value (`api/campaigns/sync.mjs:516-521`, `src/adplatforms/meta.mjs:320-321` `Number(v || 0)`). — **answered by M1 `99e0f0d28`**: the 408 columns stay NULL on old days; `conversions` / `reach` left as they are (see M1 manifest).
- [M4 → M1] `v_partner_spend_vs_ceiling` (046:793) cuts "today" with UTC `CURRENT_DATE`; Meta rows are Arizona days. Latent: 0 spend ceilings exist. Needs a migration using `(now() AT TIME ZONE 'America/Phoenix')::date`.
- [M4 → M1/M2] `funnel_page_stats` does not save the window a row covers (7 / 30 / 90 days); it needs a `window_days` column. Campaign manager caption now says "30 from the nightly job" (sweeper :21) — keep it true if the sweeper window changes.
- [M4 → M2] `src/ops/watch-curve.mjs:68-74` outer SELECT drops `m.clicks`, so the "they tapped through, that is a hop" rule never runs; and `clicks` is every tap, not link clicks.
- [M4] `src/optimize/run.mjs:189-195` averages each ad's CTR and cuts days with UTC `CURRENT_DATE` — the same math the screens had. Acts only on live ad sets (none today).
- [M4] Galaxy "Funded today" sums `clients.funded_amount` where `updated_at` is today UTC (`src/galaxy/company-activity.mjs:278-282`): any edit to a funded client counts. Reads a true $0 today (0 funded clients).
- [M4] Sales floor month cash has no `is_demo` filter (`src/sales/metrics.mjs:461`) and multiplies a deposits *count* target by 100 as cents (`:489-497`). True $0 today (0 October outcomes).
- [M4] Locked partner disclosure says "provided and performed by FundHub" (`src/brand/templates.mjs:59`, `src/trials/disclosure.mjs`, `public/partner/trial/live/index.html:161`, plus 5 tests).
- [M4] `/api/dashboard/kpis` lets any signed-in staff read company cash (`requireDashboardAccess`, no role check).
- [M4] Ops & Admin booked / showed / decided counts do not leave out test clients (only "new clients" was fixed).
- [M4] `ops/workflows/roadmap-marketing-2026-10-04.md`: "15–20s: 6%" should be 10% (entry 15; 6% is 20–25 s); "Days are UTC" is wrong for the Meta rows (Arizona days).
- [M4] Clarity sweeper (`src/workflows/clarity-insights-sweeper.mjs`) and creative-intel weekly job (`job.mjs:84`) are never registered in `src/workflows/index.mjs`.
- M9 card: `src/handlers/meta-purchase.test.mjs` "no raw email or phone anywhere in what the sender gets, or in what is recorded" is flaky — it looks for the text "480" in a blob that holds the clock (`event_time`, `at`), so it fails whenever the time contains 480. In O1's baseline, passed in M9's run. Fix: pass `now` in that test. Not fixed (not named).
- M9 card: ShowedCall (did they show up for the call) is planned, not specified (`TODO.md:146`). Not built.
- M9 card: Meta's Conversions API Gateway / a ClickFunnels Meta integration was never checked for a second server copy. Events Manager only (checklist step 3); no code can see it.

- (M2, for whoever owns `src/workflows/meta-campaign-sync-sweeper.mjs`) The Meta sweeper's tally drops `stats.watch_curve`, so a failed or held dying-ad buzz never shows in the run log (`meta-campaign-sync-sweeper.mjs:153-172`).
- ~~(M2 → M1) point the hop test at link clicks~~ DONE on M2 `44924292e` (`tapCount()`, falls back to every click until 408 ships).
- (M2 → M3) `src/pulse/machine.mjs` on `m3-heartbeat` calls `diesBefore25Percent({ clicks: a.clicks })` with every click; after M2 merges, pass `tapCount(row).taps` (and the 3 `to_jsonb` columns) so the heartbeat judges hops the same way as the buzz. Today it can only miss a dying ad, never invent one.
- (M2) The ClickFunnels clock pulls only `connection_state = 'active'`; one failed pull sets `error` (`src/analytics/clickfunnels-org-sync.mjs:81`) and the clock then skips the account until a hand pull resets it.
- (M2 → M3) The new 07:30 UTC clock `watch-curve-diagnosis-sweeper` is not watched by the heartbeat yet.

- **M7 off-repo — Cloudflare (stops the bounces):** every prove email to `e2e+…@fundhub.ai` hard-bounces because fundhub.ai mail is handled by Cloudflare Email Routing and nothing routes `e2e@`. Change in Cloudflare → fundhub.ai → Email → Email Routing: turn on Subaddressing in Settings, and add a routing rule for `e2e@fundhub.ai` that forwards to a real inbox (or add a catch-all rule). 5 of our last 6 Resend bounces are this address.
- **M7 off-repo — one applicant's bad address:** affiliate welcome `AF1` (message ids `cb3f4213…`, `5e269994…`, 2026-09-21) never reached that applicant: their Gmail address hard-bounced and Resend now blocks it. Change: get a working email from that applicant. No code change.
- **M7 leftover (not fixed) — "sent" that never went:** `src/adapters/resend-events.mjs` `RESEND_STATUS_MAP` has no line for Resend's `email.suppressed`, so 6 emails since 2026-09-21 still say "sent" though Resend never sent them (reason `previous_bounce`).
- (M3) Gate relay never ran on this Mac: no `.fundhub-relay` folder, no relay process, no LaunchAgent, and no `TELEGRAM_BOT_TOKEN` / `TELEGRAM_USER_ID` in `.env` or `credentials/env.full.snapshot`. Pick (safe default, not asked): leave it off; the live pulse marks it skip, the Mac CLI marks it FAIL.
- (M3) Live pulse board likely never written: on Netlify `writeScorecard` targets `ops/workflows` inside the function bundle (read-only outside /tmp), yet Chris's text says "Suggested fixes are on the pulse board" (`src/pulse/notify.mjs:52`, `src/pulse/daily-pulse.mjs` writeScorecard). Not proven offline; the Inngest run output would show `wrote.ok=false`.
- (M3) U-05: the 2026-09-30 04:30 UTC `analysis.completed` (simulated CRS, utilization missing) left no U-05 task and no `failed_events` row; the 06:00 one got its task at 06:02. Inngest run history is not readable offline.
- (M3) `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` in local `.env` are masked, so the Twilio log cannot be read to prove the 7 a.m. text is delivered (`node scripts/env-audit-masks.mjs`).
- (M3, answer to M2's card) A heartbeat row for `watch-curve-diagnosis-sweeper` is not built: the job and `diagnoseCurve` exist only on M2's branch, and the row needs that classifier to tell "no row by design" (hop, too few) from "missed". Add it to `MACHINE_CHECKS` in `src/pulse/machine.mjs` after M2 merges.

- (M1 → M4) `api/read/ad-books.mjs` `foldGroups` / totals ignore the new `payments`, `paid_cents`, `payments_amount_unknown`, `first_paid_at`, `last_paid_at` that `adAttributionRollup` now returns, so no screen shows sales per ad yet.
- (M1 → M2) The 408 columns `link_clicks` and `landing_page_views` exist after the ship (filled by the next 07:00 pull, 28 days back), for M2's card on `tapsThrough()` in `src/ops/watch-curve.mjs`.
- (M1) `vsl_watch_sessions.ad_number` (379) still reads leading digits only: 472 watch rows carry Meta ad names (`oVid: SLO1`–`SLO4`, 68 of them URL-encoded like `oVid%3A+SLO3`) and none has an ad number. Not fixed (not named).
- (M1) `marketing/ads/registry.json` has no entries for ad numbers 84–90, so the closer screen (`api/read/ad-attribution.mjs` → `resolveAd`) will show ad 90 as the "sorting default". Not fixed (not named).
- (M1) `ad_metrics_daily.conversions` / `cpa_cents` are never written by the sync (always 0 / NULL), yet `src/optimize/rules.mjs` `kill_no_conversions` reads `conversions` as a real count. Not fixed (not named; touching it would change what the optimiser does to live ads).
- M8: production `bookings` has 0 rows and 0 `Strategy session%` tasks, while `events` holds 74 `booking.created` (65 clickfunnels, last 2026-09-26), all with `client_id` NULL (read-only count 2026-10-05). Not investigated. Until rows exist, M8's wake-time check reads "unknown" and acts as before.
- M8: the ClickFunnels booking event payload carries no `tzid` (`src/adapters/clickfunnels.mjs`, booking payload block in `handleClickFunnelsWebhook`), so `appointmentContext` in `src/workflows/s-04b-booking-reminders.mjs` never gets the booking's own zone. Fact only; not touched.
- M8: `findBookingBySlot` (`src/adapters/clickfunnels.mjs`) matches a cancelled booking at the same email + time, so a cancel then re-book of the same slot is merged into the cancelled row and no `booking.created` fires (no reminders). Pre-existing; not touched.
- **(M12, for the main session / whoever owns them) Production has migrations nobody here has:** `schema_migrations` lists `430_pulse_scorecards`, `431_morning_briefs`, `432_ops_suggestions`, `433_morning_briefs_kind`, applied 2026-10-05 21:20 UTC, but no such file is on any local branch, ref or worktree. Their source must be committed somewhere, and new migration numbers must skip 430–433.

- (M11, not checked, no fix) `csm-queue.html` headline count is `class="vl mono"`; in `fundhub-brand.css` the `.mono` caption rule sits after the `.vl` metric rule at the same weight, so that count likely paints at 13px instead of 32px.

## Blockers and questions for Chris (yes/no only — avoid; pick a safe default instead)

### M8 manifest (re-posted 2026-10-05 after the board overwrite) — booked calls: call id, moved 15-minute text, no no-show on cancel/move

Branch `m8-calendar-moves`, head `d4378d1f3`, 4 commits on `8425410ff`, not pushed. No migration, no env var, no outbound call added.

- **(a) Call id.** `src/adapters/clickfunnels.mjs`: booking id = ClickFunnels `data.id` (then `subject_id`, then `data.public_id`), not `event_id`. `event_id` stays the bus repeat key, so two moves of one call both land and a re-sent message does not. Step 0 (read-only CF API, ids/keys only): 191 outgoing webhooks listed, 5 appointment `created`, `data.id == subject_id` on all 5; 0 rescheduled/canceled in the list. New `adoptEarlierBooking`: a move/cancel whose call id no row holds re-keys ONE earlier ClickFunnels booking (+ its closer task) for that email — cancel only at exactly the call's time, move only when that email has exactly one live upcoming booking; otherwise untouched. Never blocks the webhook.
- **(b) 15-minute text.** `src/workflows/ai-set-04-3way-handoff.mjs`: also triggers on `booking.rescheduled`; a move to a different time cancels the old-time run (call id or email, with `startTime !=` so a move never cancels its own run); on waking, new `bookingStateAt` (`src/bookings/store.mjs`) stops the text on moved / cancelled / no-show; text + advisor task keyed `booking-start:<client>:<time>`, so two runs for one time queue ONE text. A past time is still never sent.
- **(c) No-show.** `src/workflows/dpc-02-call-outcome-enforcement.mjs`: cancelOn for cancel and move (rules shared in new `src/workflows/booking-cancel-rules.mjs`, its own module to avoid a dpc-02 → ai-set-04 → s-04b → dpc-02 import loop; load order checked 3 ways); triggers on `booking.rescheduled` so a moved call is checked at its new time; wake-time `bookingStateAt` stops on moved / cancelled / already no-show; `booking.noshow` key now carries the call time.
- **Safe default:** no saved booking row for that time → "unknown" → behaves exactly as before.
- **Files:** `src/adapters/clickfunnels.mjs`, `src/bookings/store.mjs`, `src/handlers/comms.mjs` (comment only), `src/workflows/booking-cancel-rules.mjs` (new), `src/workflows/ai-set-04-3way-handoff.mjs`, `src/workflows/dpc-02-call-outcome-enforcement.mjs`. Tests: `src/adapters/clickfunnels-booking-moves.test.mjs` (new, 10), `src/workflows/ai-set-04-3way-handoff.test.mjs` (+8), `src/workflows/dpc-02-call-outcome-enforcement.test.mjs` (+6), `src/http/webhooks-clickfunnels.pg.test.mjs` (new, 3, skips without DB). Docs: `docs/journeys/booking-notifications-flow.md` (sections 1, 2, 5, new 5b), `docs/journeys/CHANGELOG.md` (3 lines at top), `docs/diagrams/agent-triggers.md` (hand-added only the ai-set-04 + dpc-02 `booking.rescheduled` lines; the file is already stale on main, not regenerated).
- **Proof:** the new adapter tests run against `main`'s adapter: 7 of 10 FAIL (the bug); all 10 pass on the branch. New workflow tests fail on old code by construction (no wake check). Targeted: adapter 56+10, comms 50, booking workflows 81 — 0 fail. `npm run lint` clean (2346). `npx tsc --noEmit` exit 0. Full `npm test` (no DB): 12110 tests / 12079 pass / 27 fail / 4 skipped; failing names vs O1 `o1/base.names` + `base2.names`: 0 new (climate-match shows with an absolute path, same file). New SQL checked with EXPLAIN inside `BEGIN READ ONLY … ROLLBACK` on production: the `bookingStateAt` query and both re-key queries plan clean.
- **NOT provable offline:** the `.pg.test.mjs` run (no Postgres here); real Inngest evaluating the new cancelOn expressions (config shape asserted only); that ClickFunnels keeps the same `data.id` on a reschedule (no reschedule/cancel webhook exists in its list); a live webhook. Runs already asleep at ship time keep their old cancel rules (Inngest sets them at run start); only the wake-time check covers them.
- **Read-only SQL after ship** (each inside `BEGIN READ ONLY; … ROLLBACK;`, replace `<ship>`):
  1. `SELECT name, (payload->>'bookingUid') ~ '^[0-9]+$' AS call_id, count(*) FROM events WHERE name LIKE 'booking.%' AND created_at > '<ship>' GROUP BY 1,2;` → call_id true for ClickFunnels appointments.
  2. `SELECT provider_uid ~ '^[0-9]+$' AS call_id, status, count(*), count(*) FILTER (WHERE jsonb_array_length(COALESCE(raw->'__history','[]'::jsonb)) > 0) AS moved FROM bookings WHERE source='clickfunnels' AND created_at > '<ship>' GROUP BY 1,2;`
  3. `SELECT count(*) FROM events n JOIN bookings b ON b.org_id = n.org_id AND b.provider_uid = n.payload->>'bookingUid' WHERE n.name='booking.noshow' AND n.created_at > '<ship>' AND b.status = 'cancelled';` → 0.
  4. `SELECT count(*) FROM messages WHERE template_key='SMS-AISET04-HANDOFF' AND created_at > '<ship>' AND provider_ref NOT LIKE 'workflow:SMS-AISET04-HANDOFF:booking-start:%';` → 0.
- **Leftover cards** (same 3 lines already under "## Leftover cards"): (1) production `bookings` has 0 rows and 0 `Strategy session%` tasks while `events` holds 74 `booking.created`, all `client_id` NULL — not investigated; (2) the ClickFunnels booking payload carries no `tzid`, so `appointmentContext` never gets the booking's own zone — fact only; (3) `findBookingBySlot` matches a cancelled booking at the same email + time, so cancel-then-rebook of the same slot merges into the cancelled row and fires no `booking.created` — pre-existing, not touched.


### M9 — Meta server events (re-posted 19:1x; done, branch `m9-meta-events`, head `96c8904de`, 5 commits on `main` @ `8425410ff`, not pushed, not shipped)

**Answer.** Purchase and Schedule now follow Meta's written rules on the server and in the browser. Three things were wrong and are fixed: (1) a sale could count twice (two server copies of Purchase); (2) the phone hash kept leading zeros; (3) the browser told Meta $297 while the card is charged $147 (owner-authorized fix, live after the one ship).

**Meta's rules used (read 2026-10-05):**
- R1 https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
- R2 https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
- R3 https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
- R4 https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/custom-data ; https://developers.facebook.com/docs/meta-pixel/reference
- R5 https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events

**Field-by-field (server copy unless it says browser):**

| Check | Meta's rule | Lead | InitiateCheckout | Schedule | Purchase |
|---|---|---|---|---|---|
| event_name, same as browser | R1, R5 | PASS | PASS | PASS | PASS |
| event_time: Unix seconds, ≤ 7 days old | R1 | PASS | PASS | PASS | PASS |
| action_source allowed | R1 | PASS website | PASS website | PASS website | PASS website (system_generated only if checkout kept no user agent) |
| event_source_url on website events | R1 | PASS | PASS | PASS (booking page) | PASS https://apply.fundhub.ai/roadmap |
| client_user_agent present, not hashed | R2 | PASS | PASS | PASS | PASS |
| client_ip_address not hashed | R2 | PASS | PASS | PASS | PASS |
| em = SHA-256 of trimmed lowercase email | R2 | PASS | PASS | PASS | PASS |
| ph = SHA-256 of digits, country code, no leading zeros | R2 | FIXED | FIXED | FIXED | FIXED |
| external_id hashed (recommended) | R2 | PASS | PASS | PASS | PASS |
| fbc / fbp raw, `fb.1.<ms>.<id>`, case kept | R2, R3 | PASS | PASS | PASS | PASS |
| value number in dollars + ISO currency | R4 | — | server PASS 147 USD · browser FIXED (was 297) | — | server PASS (cents/100: 14700 → 147) · browser FIXED (was 297) |
| browser eventID = server event_id | R5 | PASS `<sid>.<seq>` | PASS `<sid>.<seq>` | PASS `<sid>.<seq>` | PASS `purchase.<order ref>` (= `link_ref`, `slo_<24 hex>`) |
| only one server copy per event | R5 (Meta drops server-vs-browser repeats; does not promise server-vs-server) | PASS | PASS | PASS | FIXED (track door sent a 2nd server copy) |
| ad id / campaign id | R1 has no such field; Meta ties to the ad via fbc | fbc sent | fbc sent | fbc sent | fbc sent |

Live evidence (production `events`, SELECT only, no PII): Lead and InitiateCheckout of 2026-10-02 22:43 UTC carry the browser's `<sid>.<seq>` id, fbc, fbp, url; Meta answered `sent: 1`, 0 errors. All 94 page views with a Meta reply use the head snippet's `pv.*` id (0 fallbacks). Commas `amount` is dollars (5000 ↔ `amount_cents` 500000), so offer Purchases are not 100× off. Live `https://fundhub.ai/funnel/fh-events.js` was byte-identical to the repo and said `value: 297`; the live /roadmap page charges $147 and loads the tracker from fundhub.ai.

**Changed (files, 5 commits):**
- `a55850a27` `src/meta/map.mjs` — Purchase row `serverCopy: false`; `metaEventsFor` skips it. The payment webhook (`src/handlers/meta-purchase.mjs`, unchanged) is the one server Purchase. Tests: `src/meta/map.test.mjs`, `src/funnel/track-meta.test.mjs` (its two stale $297 / door-Purchase tests now assert $147 and no door Purchase; both were known failures).
- `8410fdd1c` `src/meta/user-data.mjs` — `normalizePhone` drops leading zeros. Test in `src/meta/user-data.test.mjs`.
- `6f1f9477e` new `src/meta/meta-spec.test.mjs` (9 tests): exact request body through the real door / webhook handler / sender, fake fetch, fake token, checked against R1–R5. Doc: `docs/tracking/meta-events.md` table + checklist.
- `ccc58841d` `docs/journeys/CHANGELOG.md` one line. No journey diagram, route, export or migration changed.
- `96c8904de` (main session authorized) `public/funnel/fh-events.js` `var PRICE` value `297` → `147` — price value only, nothing else in that file; `src/ads/fh-events-meta.test.mjs` asserts 147 and a new test fails if the browser price and `SLO_VALUE` ever differ; doc lines updated in the same commit.

**Proved:** `npm run lint` clean. `npx tsc --noEmit` clean. Tracker + Meta tests 267/267. Full `npm test` (no database, at `ccc58841d`): 12,099 tests, 12,070 pass, 25 fail, 4 skip — **0 new failing names** vs O1 `base.names`. Every new test fails on the old code and passes now. Nothing sent to Meta; the real token was never read.

**Applied browser patch (`ccc58841d..96c8904de`):**

```diff
diff --git a/public/funnel/fh-events.js b/public/funnel/fh-events.js
index d3bd7c4f1..9da5578b7 100644
--- a/public/funnel/fh-events.js
+++ b/public/funnel/fh-events.js
@@ -96,7 +96,7 @@
   /* Meta: the map is docs/tracking/meta-events.md, "Map (database event → Meta)". */
   var VIEW_CONTENT = { "/roadmap": 1, "/watch": 1, "/apply": 1, "/home": 1 };
   var BUY_BOX = { "fh-cf-form": 1, fhw: 1 };
-  var PRICE = { value: 297, currency: "USD" };
+  var PRICE = { value: 147, currency: "USD" };
   var REF = /^[A-Za-z0-9_-]{1,64}$/;
   var PV_ID = /^[A-Za-z0-9_.-]{1,120}$/;
   var CLICK_ID = /^[A-Za-z0-9_-]{1,500}$/;
diff --git a/src/ads/fh-events-meta.test.mjs b/src/ads/fh-events-meta.test.mjs
index 07b6a4cb6..47267a067 100644
--- a/src/ads/fh-events-meta.test.mjs
+++ b/src/ads/fh-events-meta.test.mjs
@@ -18,6 +18,9 @@ import { test, describe } from "node:test";
 import assert from "node:assert/strict";
 
 import { makePage } from "./fh-events-harness.mjs";
+import fs from "node:fs";
+import { fileURLToPath } from "node:url";
+import { SLO_VALUE, CURRENCY } from "../meta/map.mjs";
 
 const SID = "sess-abcdef12";
 const PV = `pv.${SID}.k3j9x`;
@@ -180,14 +183,14 @@ describe("Lead", () => {
 });
 
 describe("InitiateCheckout, Purchase, ReachedBuyBox", () => {
-  test("InitiateCheckout on the first buybox_tab tab 2 per session, 297 USD; tab 1 and repeats send nothing", () => {
+  test("InitiateCheckout on the first buybox_tab tab 2 per session, 147 USD; tab 1 and repeats send nothing", () => {
     const p = page({ pathname: "/roadmap" }).run();
     p.win.fhTrack("buybox_tab", { tab: 1, bbv: 2 });
     p.win.fhTrack("buybox_tab", { tab: 2, bbv: 2 });
     p.win.fhTrack("buybox_tab", { tab: 1, bbv: 2 });
     p.win.fhTrack("buybox_tab", { tab: 2, bbv: 2 });
     const tabs = p.events("buybox_tab");
-    assert.deepEqual(named(p, "InitiateCheckout"), [["track", "InitiateCheckout", { value: 297, currency: "USD" }, tabs[1].meta_event_id]]);
+    assert.deepEqual(named(p, "InitiateCheckout"), [["track", "InitiateCheckout", { value: 147, currency: "USD" }, tabs[1].meta_event_id]]);
     assert.deepEqual(tabs.map((b) => "meta_event_id" in b), [false, true, false, false]);
 
     const reload = page({ pathname: "/roadmap", storage: p.store }).run();
@@ -195,14 +198,14 @@ describe("InitiateCheckout, Purchase, ReachedBuyBox", () => {
     assert.equal(named(reload, "InitiateCheckout").length, 0, "once per session, not per page load");
   });
 
-  test("Purchase: eventID purchase.<order_ref>, 297 USD, once per order", () => {
+  test("Purchase: eventID purchase.<order_ref>, 147 USD, once per order", () => {
     const ref = "slo_0123456789abcdef01234567";
     const p = page({ pathname: "/roadmap" }).run();
     p.win.fhTrack("payment_result", { result: "fail", code: "card_declined", bbv: 2 });
     p.win.fhTrack("payment_result", { result: "success", order_ref: ref, bbv: 2 });
     p.win.fhTrack("payment_result", { result: "success", order_ref: ref, bbv: 2 });
     const results = p.events("payment_result");
-    assert.deepEqual(named(p, "Purchase"), [["track", "Purchase", { value: 297, currency: "USD" }, `purchase.${ref}`]]);
+    assert.deepEqual(named(p, "Purchase"), [["track", "Purchase", { value: 147, currency: "USD" }, `purchase.${ref}`]]);
     assert.deepEqual(results.map((b) => b.meta_event_id), [undefined, `purchase.${ref}`, undefined]);
     assert.equal(results[1].props.order_ref, ref, "order_ref is posted with the event");
 
@@ -347,3 +350,11 @@ describe("fbclid, fbc, fbp and url on every post", () => {
     assert.equal("fbclid" in p.bodies()[0], false);
   });
 });
+
+test("the browser's price is the server's price (src/meta/map.mjs SLO_VALUE, from SLO_PRICE_CENTS)", () => {
+  const src = fs.readFileSync(fileURLToPath(new URL("../../public/funnel/fh-events.js", import.meta.url)), "utf8");
+  const m = src.match(/var PRICE = \{ value: (\d+(?:\.\d+)?), currency: "([A-Z]{3})" \};/);
+  assert.ok(m, "fh-events.js has one PRICE line");
+  assert.equal(Number(m[1]), SLO_VALUE, "Meta keeps the copy it gets first, usually the browser's");
+  assert.equal(m[2], CURRENCY);
+});
```

**Checklist — after the first real booking or sale (5 minutes).** Test Events only shows events sent with a test code; real visitors never carry one, so look at Overview.
1. Our row (an agent reads it, SELECT only): Schedule → the `funnel.booking_confirmed` row; Purchase → the `payment.received` row. `payload.meta` should say `sent: 1`, no `error`, `event_name` Schedule / Purchase, `event_id` `<session id>.<number>` (Schedule) or `purchase.slo_…` (Purchase). Purchase also `ok: true`, `value: 147`.
2. https://business.facebook.com/events_manager2/list/pixel/2403674420141513/overview?business_id=1475597360226485 → the Purchase or Schedule row: counts **1** (not 2); connection **Browser and Server**; event details show the server copy deduplicated by **Event ID**; Purchase value **$147** (if it shows $297, the ship with `96c8904de` has not gone out); Schedule content name **funding-book-call**.
3. Sources must not list **Conversions API Gateway** or **ClickFunnels** as a partner — either would be a second server copy (double count).
4. Diagnostics tab on the same page: no new warning for Purchase or Schedule.

**Leftover cards (also under "Leftover cards"):** flaky `src/handlers/meta-purchase.test.mjs` "no raw email or phone…" (matches "480" in the clock); ShowedCall planned, not specified, not built; Conversions API Gateway / ClickFunnels Meta integration not checkable from code (checklist step 3).

### M4 — reports tie-out manifest (re-posted; done, branch `m4-reports-tieout`, head `7e0d272ec`, 8 commits on `8425410ff`, not pushed, not shipped)

Marked draft (red = what the screen showed, green = the fix, a button hides the marks): https://claude.ai/artifact/Hji2Y7SQqaXYzPi4C9YtnZ (private). A copy is on the branch at `ops/workflows/perfect-machine-2026-10-05-m4-marked-draft.html`.

**Key fact, measured.** The Meta ad account's time zone is **America/Phoenix** (one read-only GET of `act_…?fields=timezone_name`, 2026-10-05). `ad_metrics_daily.date` is an Arizona day. Every report that cut days with UTC `CURRENT_DATE` was one day off from 5pm to midnight Arizona time. One helper now owns the day: `src/lib/ad-account-day.mjs`.

**Inventory**

| Report | Where | Who sees it | Source |
|---|---|---|---|
| Campaign manager: tiles, list, drawer series, ceilings, fatigue, ad books, ad spine, funnel pages | `public/app/campaign-manager.html`; `api/campaigns/{list,detail,spend,fatigue}.mjs`; `api/read/{ad-books,ad-spine,funnel-pages}.mjs` | owner/admin menu; API: partner or staff | campaigns, ads, ad_metrics_daily, v_partner_spend_vs_ceiling, client_ad_attribution, bookings, funnel_page_stats; Meta, ClickFunnels |
| Ops & Admin KPIs + today's briefs | `public/app/ops-admin.html`; `api/dashboard/kpis.mjs`, `api/read/ops-pulse.mjs`; `src/dashboard/kpis.mjs`, `src/ops/{pulse,briefs}.mjs` | owner/admin | transactions, funding_rounds, events, clients, ad_metrics_daily |
| Weekly ops brief (Company Brain doc) | `api/ops/weekly-brief.mjs`, `src/ops/weekly-brief.mjs` | staff trigger, owner tier; not scheduled | client_ad_attribution, bookings, funnel_page_stats, video_watch_stats |
| Pipeline "$ funding est." | `public/app/pipeline.html`, `api/dashboard/pipeline.mjs` | staff | cards, clients |
| Daily pulse text (M3) | `src/pulse/**` | Chris by text, 13:00 UTC | probes only, no money |
| Dying-ad alert (M2) | `src/ops/watch-curve.mjs` | Chris by text/ntfy | ad_metrics_daily |
| Sales floor / My numbers | `sales-floor.html`, `my-numbers.html`; `src/sales/metrics.mjs` | finance / closers | call_outcomes, staff_targets |
| Galaxy money ticker | `galaxy.html`; `src/galaxy/company-activity.mjs` | staff | call_outcomes, clients |
| Partner Home tiles, Live Trial, Winner's Board | `partner-galaxy.html`, `public/partner/trial/live/`, `public/partner/board/live/` | partners | partner_revenue, live trial tables, creative-intel |
| VSL watch (YouTube) | `creative-factory.html`, `api/read/video-stats.mjs` | staff | video_watch_stats (0 rows, not connected) |
| Commissions, affiliates, AR, Finance OS, client portal, closer cockpit | their `public/app` pages | finance / staff / clients | ledgers, invoices |
| Scripts | `scripts/marketing-data-health.mjs`, `scripts/clarity-insights-pull.mjs` | script output | row counts; Clarity API |
| Oct 4 roadmap pull | `ops/workflows/roadmap-marketing-2026-10-04.md/.json` | made by hand, no generator | Meta, page tracker, ClickFunnels, Clarity |

**Tie-out** (every read SELECT-only or a read-only GET)

| Report / number | Shown | Raw source | Result |
|---|---|---|---|
| Meta mirror, Sep 26–Oct 4 (4 SLO ads) | DB $915.46, 381 taps | Meta API $915.49, 381 | PASS (3¢: Meta settled SLO4 Oct 4 after the 07:01 sync; the next sync heals it) |
| Meta mirror, all time | DB 46 ad-days, $1,002.32, 400 taps | Meta 69 ad-days, $1,563.13, 568 taps (from Aug 4) | FAIL → card M1 (answered by M1 `99e0f0d28` backfill script) |
| Watch curve: 36 days saved; SLO1 46% at 5 s; SLO2 22% left at 5 s | same | DB curves | PASS |
| Roadmap funnel Oct 1–4: opened / pressed buy / paid | 135 / 2 / 0 | 136 − 1 audit (funnel.page `/roadmap`, person, UTC days) / 2 (funnel.continue) / 0 paid of 15 payment links | PASS |
| Campaign manager "Spend yesterday" (5:45pm AZ) | 0.00 | 120.18 (Oct 4) | FAIL → fixed |
| Campaign manager live campaigns / ROAS 7d / spend today | 0 / 2, —, "no daily limit" | 2 paused, no purchase_roas, 0 ceilings | PASS |
| Fatigue click rate, SLO1, Sep 30–Oct 4 | 7.58% | 15 / 152 = 9.87% | FAIL → fixed |
| Drawer click rate, Oct 3 | 7.29% | 23 / 476 = 4.83% | FAIL → fixed |
| Drawer conversions | 0 | unknown (Meta never asked) | FAIL → card M1 (answered) |
| Funnel pages: VSL, "Date Oct 04" | 642 | CF API 90-day 642; 7-day 77 | number PASS, label FAIL → fixed ("Pulled on" + caption) |
| ClickFunnels mirror (12 rows, 90-day window) | e.g. Roadmap Sales 161 | CF API 162 (one later view) | PASS |
| Ad books: leads / booked | 18 / 0 | 18 / 0; 0 with an ad number | PASS |
| Ad spine 7-day spend (after 5pm AZ) | 523.79 | 606.53 | FAIL → fixed |
| Ops & Admin new clients, 7 days | 23 | 4 real (19 test addresses) | FAIL → fixed |
| Ops & Admin cash 7d / funded / close & show | $5,000 / 0 / — | 1 paid row of $5,000 / 0 rounds / 0 booked | PASS |
| Ops brief ad spend line | "52379 cents" | $606.53 | FAIL → fixed (unit and day) |
| KPI money format | $606.5 | $606.50 | FAIL → fixed |
| Weekly brief: VSL views "this week" | 642 | 77 that week (642 = 90 days) | FAIL → fixed |
| Pipeline New Lead (8) / Survey Complete (2) | $0 funding est. | 0 of 10 cards have an estimate = unknown | FAIL → fixed (dash) |
| Sales floor / My numbers October cash | $0 | 0 call outcomes logged | PASS (latent cards) |
| Galaxy cash / funded today | $0 | 0 / 0 funded clients | PASS (latent card) |
| Partner home, Live Trial, commissions | empty / $0 | 0 partner_revenue, 0 trials, 0 ledger rows | PASS |
| Affiliate payouts | 1 row | no NULL amounts | PASS |
| marketing-data-health counts | 24 / 46 / 7 | 24 / 46 / 7 | PASS |
| Clarity pull | — | not pulled (one pull per Chris ask) | NOT TIED OUT |
| Money in integer cents | spend sums in cents; screens divide by 100 | — | PASS |
| Company name on report screens | FUNDHUB-ADMIN; "FundHub" on Winner's Board and trial plan | — | FAIL → fixed (locked disclosure → card) |
| Doc: TODO.md:17, $707.24 (9/28–10/4) | $707.24 | DB 70724¢ | PASS |
| Doc: MACHINE-GAPS:22, $877.63 (9/26–10/4) | $877.63 | true at 3:15pm Oct 4; full day $915.46 | PASS for its time |
| Doc: ad-scripts-2026-10-02:216, "$86.86 of Meta's $647.64" | — | Meta August total 64764¢ | PASS |
| Doc: roadmap-marketing-2026-10-04, "15–20s: 6%" | 6% | entry 15 = 10% (6% is 20–25 s) | FAIL (doc, card) |
| Doc: roadmap-marketing-2026-10-04, "Days are UTC" | — | the Meta rows are Arizona days | FAIL (doc, card) |

**Fixes (my files only).**
- Code: `src/lib/ad-account-day.mjs` (new); `api/campaigns/{list,fatigue,detail}.mjs`; `api/read/ad-spine.mjs`; `src/ops/pulse.mjs`; `src/dashboard/kpis.mjs`; `src/demo/exclude-demo.mjs` (`andNotTestAddress`); `src/ops/weekly-brief.mjs`; `api/dashboard/pipeline.mjs` (`stageAmount`).
- Pages: `public/app/{campaign-manager,ops-admin,pipeline}.html`; `public/partner/board/live/index.html`; `src/trials/clock.mjs` (text only).
- New tests: `src/http/report-ad-day.test.mjs`, `src/ops/weekly-brief.test.mjs`, `src/http/pipeline-stage-amount.test.mjs`, `e2e/report-tieout.spec.mjs`.
- Test additions: `kpis.test.mjs`, `exclude-demo.test.mjs`, `ad-spine.test.mjs`, `pipeline-screen.test.mjs`. The pg fixtures (`campaign-endpoints`, `creative-endpoints`, `ad-spine`) now seed Arizona days.
- No migration, no route change, no journey flow change.

**Proof.**
- `npm run lint`: clean.
- `npx tsc --noEmit`: exit 0.
- `npm test`: 12,108 tests, 28 failed against main's 27. The one extra, `RateLimiter: enforces a floor between requests` (scripts/marketing, which I did not touch), passed 3 of 3 runs on its own, so 0 new failures by name.
- Playwright: `report-tieout`, `ops-admin` and `pipeline*` passed 36/36. `crm-flows` has 2 CCP → Finance OS failures that fail the same way on main.
- The new SQL, re-run read-only on production, returns the true numbers above.

**Picks written down (safe defaults, not asked).**
- The ad account's day is America/Phoenix for every partner until a time-zone column exists.
- "New clients" leaves out the same test addresses the page tracker already skips (`classifyVisitor`): @fundhub.ai, @example.*, and e2e / sim / test local parts.

**Cards for other owners.** In "Leftover cards", the `[M4 → …]` lines. M1 answered two of them in `99e0f0d28`. M2's manifest answers the watch-curve card.

**Pages that need a push at ship time.** All go out with the one `npm run ship` on Netlify. No ClickFunnels page was touched.
- https://fundhub.ai/app/campaign-manager.html
- https://fundhub.ai/app/ops-admin.html
- https://fundhub.ai/app/pipeline.html
- https://fundhub.ai/partner/board/live/
- the trial plan text on https://fundhub.ai/partner/trial/live/

**Left undone.**
- Clarity is not tied out (the quota rule).
- AR table, Finance OS, client portal and closer cockpit are not tied out. They are client-level screens with no marketing numbers.
- The campaign-manager drawer's click-rate line is proved by a code test and SQL only. Playwright could not open the drawer without a partner selected.
- M1's new ad-books payment fields are not shown on a screen yet (card from M1 → M4, not started).

## V1 database proof (blocked at step 1 — nothing ran) — restored by O1 about 19:20 from V1's saved scratch text `v1-board-text.md`

**Result: no database proof yet.** 0 migrations applied, 0 `.pg.test.mjs` tests run, M1's checks not run, merged tree not built. M1's 406 / 407 / 408 are still unproved on any database. No failure list exists for main, so `scratchpad/v1-baseline-failures-main.txt` was not written.

**Why it stopped (exact error).** `brew --version` → `(eval):1: command not found: brew` (exit 127). Homebrew is not on this Mac (`/opt/homebrew` and `/usr/local/Homebrew` do not exist). Installing Homebrew asks for Chris's Mac password, and the V1 brief says stop rather than use sudo. Checked for any other Postgres to reuse: no `psql` / `pg_ctl` / `initdb` on the path or in Spotlight, no Postgres.app, no Docker / Podman / Colima, no embedded Postgres in `node_modules`.

**No CI proof to borrow either.** GitHub Actions is on for `ZootimusMaximusSupreme/fundhub-platform` and the `tests` workflow is active, but it has **0 runs ever**. Only `main` is on GitHub (local `main` is 112 commits ahead of `origin/main`); no `m*` or `w4` branch is pushed.

**Facts the next try needs (looked up 2026-10-05):**
- A plain Postgres 16 is not enough. `db/migrations/130_company_brain.sql:14` runs `CREATE EXTENSION IF NOT EXISTS vector;` with no fallback, and `db/migrate.mjs` has no skip for it. CI uses the image `pgvector/pgvector:pg16`. The local database needs the **pgvector** extension built for the same Postgres.
- `npm test` (`scripts/run-suite.mjs:81-82`) runs unit files first and **exits before the pg files** when any unit test fails. Main has 27 known unit failures, so `npm test` never reaches the database tests — locally or in CI's `postgres` job. Run the pg files directly, one at a time, with the concurrency flag BEFORE the file list (`scripts/run-suite.mjs:56-67` says flag-after-files ran them in parallel and gave 10 false failures).
- `db/migrate.mjs` runs each file in its own `BEGIN … COMMIT` (lines 219-222), so 406 commits before 407 uses the new `slo` value. It reads `.env` only when a URL it was given contains `*` (lines 122-138). This shell has no `DATABASE_URL` / `MIGRATION_DATABASE_URL` set, and the V1 worktree has no `.env` (only `.env.example`).
- 214 `.pg.test.mjs` files on main (all under `src/`). M1 changes `db/migrations/406_ad_lane_slo.sql`, `407_ad_number_from_meta.sql`, `408_ad_metrics_meta_results.sql`, `db/expected-migrations.mjs`, and adds `src/http/ad-number.pg.test.mjs`.

**Ways to unblock (main session picks; V1 did none of them on its own):**
1. Chris installs Homebrew once (his password), then an agent runs `brew install postgresql@16` plus pgvector for 16, and reruns V1.
2. Main session approves a no-password Postgres that ships pgvector (for example Postgres.app — Chris's user is in the `admin` group and `/Applications` is group-writable, so no sudo; confirm its bundled extensions include pgvector before relying on it).
3. Push the branches (or one merged proof branch) to GitHub so the `postgres` job runs on `pgvector/pgvector:pg16`. That job proves "every migration applies to an empty database", the manifest, `guard:db`, and the isolation suites as `fundhub_app` — but its `npm test` step stops at the 27 unit failures, so it does **not** run the other pg files. Pushing is the main session's call.

**How to re-run once a local Postgres with pgvector is up** (from a worktree; never source `.env`; every command names the URL):
```bash
PGURL=postgres://localhost/fundhub_scratch_v1
node -e 'const h=new URL(process.argv[1]).hostname; if(!["localhost","127.0.0.1",""].includes(h)){console.error("NOT LOCAL: "+h);process.exit(1)} console.log("host ok:",h||"socket")' "$PGURL"
createdb fundhub_scratch_v1
env -u NETLIFY -u CONTEXT DATABASE_URL=$PGURL MIGRATION_DATABASE_URL=$PGURL node db/migrate.mjs
env DATABASE_URL=$PGURL MIGRATION_DATABASE_URL=$PGURL ALLOW_SUPERUSER_DB=1 \
  node --test --test-concurrency=1 $(git ls-files 'src/*.pg.test.mjs' 'scripts/*.pg.test.mjs')
psql "$PGURL" -v ON_ERROR_STOP=1 -c "ALTER ROLE fundhub_app LOGIN PASSWORD 'scratch_only'"
env DATABASE_URL=postgres://fundhub_app:scratch_only@localhost/fundhub_scratch_v1 ALLOW_SUPERUSER_DB= npm run guard:db
env DATABASE_URL=postgres://fundhub_app:scratch_only@localhost/fundhub_scratch_v1 npm run guard:rls
```
For M1: a second database `fundhub_scratch_v1_m1`, main's migrations first, then `node db/migrate.mjs` from an `m1-attribution-money` worktree (picks up only 406, 407, 408), then `node --test src/http/ad-number.pg.test.mjs` and M1's 8 "Live checks after the ship" against seeded fixture rows. Then the merged tree (step 5 of the V1 brief) on a third fresh database.


## R1 release merge

Branch `release-2026-10-05`, **head `2ab65e50b`** (`2ab65e50b5278a944160bc0da67c22fd23fdcede`), cut from main `41cf84128` (main has not moved since). 12 `--no-ff` merge commits, 83 commits ahead of main, main is its ancestor, so main can fast-forward. Lives in worktree `/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/agent-ac6e54d07746b8866` (node_modules there is a symlink to the main checkout's; ignored by git). Not pushed, not shipped, main checkout untouched.

**Merge order result (all 12 merged; `git branch --merged` lists every one):**

| # | Branch | Head merged | Merge commit | Result |
|---|---|---|---|---|
| 1 | w4-walkthrough-fixes | `c81b86bbc` | `fe591a932` | clean |
| 2 | m1-attribution-money | `99e0f0d28` | `3c3744744` | clean |
| 3 | m2-alerts-night-jobs | `44924292e` | `2b8cc95aa` | clean |
| 4 | m3-heartbeat | `56e873b3e` | `f2c626fda` | clean |
| 5 | m4-reports-tieout | `7e0d272ec` | `182a62d12` | clean |
| 6 | m6-join-takes | `1bef065aa` | `5f6debd68` | clean |
| 7 | m7-email-failures | `5cfdb946a` | `9ee7ef17d` | clean |
| 8 | m8-calendar-moves | `d4378d1f3` | `3e003a6e0` | clean |
| 9 | m9-meta-events | `96c8904de` | `f516500e4` | clean |
| 10 | m12-offer-generator | `3decbfd93` | `d21a8c75b` | 1 conflict, fixed |
| 11 | m10-dashboard-backend | `dda703778` | `dcb49dc02` | 9 conflicts + 1 silent double, fixed |
| 12 | m11-dashboard-page | `a581fb0ff` | `2ab65e50b` | clean |

**Conflicts and how each was resolved (fixes live inside the merge commits; no separate fixup commit was needed):**
- `db/expected-migrations.mjs` (M12 merge: M1's 406–408 vs M12's 409): re-ran `npm run migrations:manifest`. All four lines kept. After M10 it auto-merged (seed 296); a re-run made no diff.
- `src/pulse/registry.mjs` (M10 merge): kept both API keys, `marketing/offer/generate` and `marketing/today`, sorted. M11's DESK_FILES line merged clean.
- `docs/journeys/*-actual.md` (8 files) + `README.md` (M10 merge): not hand-merged. Re-ran `npm run journeys` on the merged tree. `npm run journeys:check` now says up to date (it fails on plain main).
- `netlify.toml`: git auto-merged it into TWO `"marketing/flywheel/**"` lines (M12's and M10's). Kept ONE, with both comments, and put `vendor/underwriteiq-full/**` back as the last entry, like main.
- `docs/journeys/CHANGELOG.md`: auto-merged, every line kept: 20 lines added vs main, 0 removed (W4 1, M1 3, M2 4, M3 4, M6 1, M8 3, M9 1, M12 1, M10 1, M11 1; M4 and M7 add none).
- `netlify/functions/api.mjs` ROUTES: auto-merged; `marketing/today` and `marketing/offer/generate` both routed with their imports.
- `src/workflows/index.mjs`: auto-merged; M2's `watchCurveDiagnosisSweeper` and M3's pulse comment both there.
- `public/app/shell.js` + 32 sidebar copies: merged clean; `node scripts/sync-sidebar.mjs` re-run, no diff.
- `ROLE_SETS.MARKETING`: defined once, by M10 (`src/http/read-api.mjs`). M12 did NOT define its own set; it uses `ROLE_SETS.OPS` (same two roles: owner, admin). Left as is.

**Checks on the merged tree (`2ab65e50b`, no database):**
- `npm run lint`: clean (2,409 files).
- `npx tsc --noEmit`: exit 0.
- Ship guards `node --test src/security/migrations-production-only.test.mjs src/http/routes.test.mjs`: 26/26 pass (routes test = every `api/` handler is routed or on its allow-list).
- `npm run migrations:manifest`: no diff. Every `db/` file on disk is in the manifest.
- Migration numbers: no new duplicates. The 12 old duplicate numbers (114 168 255 259 260 261 262 271 272 371 372 381) are the same as on main. New: 406, 407, 408, 409 (+ seed 296).
- `npm test` (no database, so the unit stage only; it stops before the pg stage on any failure): **12,595 tests, 12,568 pass, 23 fail, 4 skipped.** Failing names vs O1's plain-main list (`o1/base.names` / `o1/known.names`): **0 new.** 8 main names now pass (the 2 journeys tests, the pulse registry test, and the Meta $297 / InitiateCheckout / Purchase / "what Meta gets" / "no raw email" tests). Same-name failures were also compared by error text: only 4 pinned workflow counts moved by +1 (M2's new registered clock; those pins are already stale on main). Nothing caused by any branch, so no bisect was needed. Logs: scratch `r1/npmtest.log`, `r1/rel.tap`, `r1/rel.names`, `r1/cmp.txt`.
- `node scripts/ship.mjs --dry`: NOT run. Read first: `--dry` deploys nothing and applies nothing, but step 1 stops on any branch that is not `main`, so it cannot run from this branch, and the main checkout is not mine to touch. Its step 4 (pending list) was done instead, read-only: production `schema_migrations` read once with SELECT (MCP), compared to this tree in scratch `r1/pending.mjs`.

**Ship-risk findings (read of `scripts/ship.mjs`, `db/migrate.mjs`, `src/http/health.mjs` + read-only production reads):**
- Production has 336 applied keys; 16 are not in this repo (`430`–`433`, seeds `035`/`036`, plus 10 old renamed files like `090_app_role.sql`, `365`–`370`, `seed/025_waypoint_nudge_templates.sql`). **They do not break anything.** `ship.mjs` pending = files on disk minus applied keys; `migrate.mjs` skips by key; `/api/health` pending = manifest keys missing from the database. None of the three reads extra keys. Health will just say `migrations: 341` with `expected: 325`, `pending: 0`, which is what ship checks (`pending === 0 && expected === manifest length`).
- **Out of order is fine.** No runner uses a "highest number" mark. Pending today on this tree is exactly 5, in this order: `406_ad_lane_slo`, `407_ad_number_from_meta`, `408_ad_metrics_meta_results`, `409_marketing_jobs`, `seed/296_marketing_copy_writer_house`. Each runs as its own transaction in ship's Supabase path (one request per file) and in `migrate.mjs` (BEGIN/COMMIT per file), so 406's new `slo` value is committed before 407 uses it. Production is Postgres 17.6, so `ALTER TYPE … ADD VALUE` inside a transaction is allowed. None of the 5 files has a top-level BEGIN/COMMIT, CONCURRENTLY or VACUUM (every BEGIN is inside a `DO $$` or function body).
- No name clash with the unknown 430–433: on production `marketing_jobs` does not exist, `ad_lane` has no `slo`, `ad_metrics_daily` has none of the 4 new columns, `client_ad_attribution.ad_id` is still generated, `fundhub_meta_ad_number` / `fundhub_reresolve_ad_numbers` do not exist. 430–433 made `pulse_scorecards`, `morning_briefs`, `ops_suggestions` (none touched by this release).
- Still unproved: 406–409 and seed 296 have never run on ANY database (V1 is blocked: no Postgres). The production ship will be their first run. If one fails, ship stops before the deploy and rolls that file back; files before it stay applied.
- Ship will stop at step 1 while the main checkout has uncommitted or untracked files. At session start those were `TODO.md`, `docs/sops/mortgage-reconveyance-simple-guide-2026-10-05.html`, `ops/workflows/hormozi-kb-finish-2026-10-05.md` (modified) and `ops/workflows/finish-builds-2026-10-05.md`, `ops/workflows/perfect-machine-2026-10-05.md` (untracked). Commit them in the main checkout first.

**READY TO FAST-FORWARD MAIN: yes.** Blockers for the fast-forward: none (from the main checkout: `git merge --ff-only release-2026-10-05`). Before `npm run ship`: main checkout clean (see above). The one open risk is that 406–409 + seed 296 have never run on a database.

- [R1 leftover card, not checked further] `409_marketing_jobs.sql` copies the live `pulse_scorecards` pattern: policy `…_app_all` USING (true) for role PUBLIC, and on production `anon` and `authenticated` hold SELECT on `pulse_scorecards` (Supabase default grants). After ship `marketing_jobs` will read the same way. Whether the Supabase Data API exposes the public schema to the anon key was not checked.
