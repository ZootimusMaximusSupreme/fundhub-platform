# Finish Codex's stopped threads — 2026-10-20

Owner ask (Chris, 2026-10-20 11:34 MST): see what Codex was working on, finish it in multiple threads, and **do not touch dashboard design — Codex owns that now.**

## What Codex left (all four threads stopped at 05:08 MST, nothing running)

| Thread | PR | Branch / Codex worktree | State at stop |
|---|---|---|---|
| $5k–$10k Capital Blueprint + agentic texts/calls | #83 | `codex/blueprint-offer-core` · `~/.codex/worktrees/blueprint-offer-core/fundhub-platform` | CI green on head `58a709758`. Owner said "get it all done" to: after checks pass, deploy and turn on text/voice coaches + reminder templates for eligible paid Blueprint clients. Whop billing webhook and monthly live credit pull stay OFF. |
| Cortana per-round fee invoices | #85 | `codex/cortana-book-call-fee-invoices-20261020` · `~/.codex/worktrees/cortana-fee-invoices/fundhub-platform` | One CI run red: `e2e/fin-b15-cc-controls.spec.mjs:433` and `e2e/verification-security.spec.mjs:28` (closer 403, JSON end). Not merged. |
| LinkedIn / bank relationship outreach | #77 | `codex/bank-relationship-outreach` · `~/.codex/worktrees/bank-outreach-release/fundhub-platform` | CI green at 11:51 UTC. Not merged. |
| Dashboard overhaul (Astra CRM) | #80, merged #81 #82 #84 #76 | Codex | **Codex owns. Claude does not touch.** |

Main CI red (run 39421266793): `e2e/fin-b15-cc-controls.spec.mjs:433` and `e2e/page_money_setup.spec.mjs:4` (390 px).

Root checkout note: `/Users/chrisstanbridge/Developer/fundhub-platform` holds ~180 uncommitted files from the early offer/invoice work ("original root edits remain untouched" on the offer board). Those are older copies of PR83/PR85. Nobody edits, commits, or deletes them in this batch.

## Shared rules for every workflow

1. **No dashboard design.** Do not change HTML, CSS, layout, spacing, or visible words on staff/CRM/portal screens (`public/app/**`), and do not touch `docs/rules/UI-STANDARDS.md`. If a fix needs a design change, write a card under **Leftovers for Codex** and stop that piece.
2. Work only inside your Codex worktree (cd there). Do not edit the root checkout except this board.
3. **One merge at a time.** Before merging: fetch, merge `origin/main` into your branch, fix conflicts (regenerate `db/expected-migrations.mjs` if it conflicts), wait for green CI on that new head, then merge. Write `MERGING` on your row while you do it, `MERGED` after.
4. Migration numbers: 486/487 = PR85, 488/489 = PR83. Do not take another chat's number.
5. Push to `main` ships by itself (`.github/workflows/ship.yml`). After ship, check `https://fundhub.ai/api/health` says pending 0.
6. Never weaken, skip, or delete a test.
7. Report to Chris in 4th grade English.

## Task list

| ID | Owner | Status |
|---|---|---|
| A — Blueprint PR83 release + activation | Claude session `blueprint-release` | done — merged, live, coaches on |
| B — Cortana fee invoices PR85 green + release | Claude session `cortana-invoices` | claimed |
| C — Bank outreach PR77 release | Claude session `bank-outreach` | claimed |
| D — Main CI red (fin-b15, page_money_setup) | This session (coordinator) | claimed |

## Copy-paste prompts

### A — Blueprint PR83 release + activation
Work in `~/.codex/worktrees/blueprint-offer-core/fundhub-platform` (branch `codex/blueprint-offer-core`, draft PR #83). Read AGENTS.md, CLAUDE.md, `ops/workflows/5k-10k-offer-readiness-2026-10-20.md` in that worktree (it has one uncommitted board edit — commit it), and `ops/workflows/codex-finish-2026-10-20.md` in the root checkout. Owner already approved: after final required checks pass, merge PR83, ship, and activate the Blueprint text and voice coaches and reminder templates for eligible paid Blueprint clients (real texts and Bland calls). Keep the Whop billing webhook and the monthly live credit pull OFF. Follow the shared rules (no dashboard design, one merge at a time). After ship: check `/api/health` pending 0, migrations 488/489 applied, the agents/templates are active, and the Blueprint pulse checks are green. Report what is live and what is not proved (no real customer reply yet is fine — say so).

### B — Cortana fee invoices PR85
Work in `~/.codex/worktrees/cortana-fee-invoices/fundhub-platform` (branch `codex/cortana-book-call-fee-invoices-20261020`, draft PR #85). Read AGENTS.md, CLAUDE.md, `ops/workflows/funding-fee-invoices-cortana-2026-10-20.md`, and the root board. Owner ask: funding fees are calculated per round, sent as separate invoices through Commas, automated by the system, tracked in Cortana. The coordinator session owns `e2e/fin-b15-cc-controls.spec.mjs` (also red on main) — do not fix that one; merge `origin/main` after it lands. You own the `e2e/verification-security.spec.mjs:28` failure ("closer hitting owner screens: API calls must 403", JSON end) if it comes from this branch. Get CI green, merge (one merge at a time), ship, check `/api/health` pending 0 and migrations 486/487 applied. Do not send a real invoice or fake a Cortana receipt. Report what is live and what Cortana still cannot see.

### C — Bank outreach PR77
Work in `~/.codex/worktrees/bank-outreach-release/fundhub-platform` (local branch `codex/bank-outreach-release`, which matches `origin/codex/bank-relationship-outreach`, draft PR #77). Read AGENTS.md, CLAUDE.md, the bank outreach board in `ops/workflows/`, and the root board. The owner wants the outreach system, dashboards, and back end built so two outbound hires can use it. The screens are Codex's design — do not change them. Merge `origin/main` in, get CI green, merge (one merge at a time), ship, check `/api/health`, and walk the outreach screens live as a staff user to prove they load and save. No real outreach messages to banks. Report what works and what is left.

### D — Main CI red (coordinator)
Fix `e2e/fin-b15-cc-controls.spec.mjs:433` and `e2e/page_money_setup.spec.mjs:4` on main in a worktree off `origin/main`. If the fix needs a dashboard design change, leave a card for Codex and stop.

## Shared flake — /tmp/fundhub-verify-ui.json (B owns)

`e2e/verification-security.spec.mjs:28` (PR85 run 39418091850) and `e2e/verification-roles.spec.mjs:102` (PR83 run 39404034078) fail with `SyntaxError: Unexpected end of JSON input`. Not caused by either branch: CI runs Playwright with `--workers=2` and both specs read/write the same evidence file. One worker read it mid-write. B fixes it on PR85 with a write-to-temp-then-rename (no test weakened). A and C: do not fix it again; it reaches main when PR85 merges.

B note for D (11:5x MST): `fin-b15-cc-controls.spec.mjs:433` is a `test.fail` FINDING marker — the ✘ is an expected failure and does not count. Main run 39421266793 summary: `1 failed` = only `e2e/page_money_setup.spec.mjs:4:35` (390). That is the real main red.

## Merge queue

(write one line when you start merging and when you finish)

- A / PR83 — **MERGING** (blueprint-release, 2026-10-20 11:38 MST): merging origin/main into branch, waiting on CI, then merge to main. Others wait.
- A / PR83 — **MERGED** 11:58 MST as `d5e055d` (CI 28/28 green on head `e2637bb`, main `1297a6e` merged in first, no conflicts). Queue is free. Ship run 39479369765 waiting for a runner; activation follows ship.
  - 12:5x MST: Mac ship 39479369765 never got a runner (3 tries, GitHub macOS capacity). Coordinator's PR87 moved ship to Ubuntu; Linux ship 39486073918 on `78b08d2` applied migrations 482/483/485/488/489 to production (health pending 0) and then **STOPPED before deploy** at pulse prove: `beat money-checkout took 8252 ms and was not under half its 11000 ms deadline`. Same beat runs in 906 ms from the Mac; PR83 did not touch beats/prove → runner-to-database distance. **Live now: new database, old code.** No Blueprint agreement has ever been sent, so the new price blank has hit nobody. Asked the coordinator who fixes the Linux ship gate. Activation waits for deploy. C: main is free to merge, but its ship will hit the same gate.
  - **14:0x MST — A DONE.** Netlify published deploy `ship 78b08d2f` at 13:19 MST (ship-log `c17db693e`), so PR83 code IS live; health pending 0, expected 373. BP-COACH and BP-COACH-VOICE went `live` and the 3 Blueprint reminder templates were approved (approver Chris, copy hashes match) at 13:20 MST by another session, one minute after the deploy (not by A). Blueprint deep checks live read-only: real-advisor PASS, monthly-delivery PASS, coach-call-delivery PASS; hourly beat `blueprint-delivery` GREEN. Whop billing webhook and monthly live pull still OFF. **Not proved:** zero real paid Blueprint clients exist. The only one, FH-000522 "Sim Eleven-Blueprint" (`+sim-11` email), is a test buyer, so no real coach text, call or reply has happened. Its old ladder rungs 1-3 were already used (template_pending), and texts fail at Twilio since Oct 11, so no automatic call can start (it needs 2 sent texts).
  - **Owner-set 2026-10-20:** Chris: "Twilio works. No issues. Done." Workflow A closed.
  - **Owner order 2026-10-20 (confirmed by Chris in A's chat: "Yes, both on"):** turn on all features. Done: `FINANCE_OS_SYSTEM_PULL_LIVE=1` set in .env, credentials snapshot and Netlify production/preview/branch (read back `1`); **needs the next deploy to take effect**. It pulls for every active finance-os subscriber: today 1 test buyer (FH-000522) + 2 demo. Fundhub's Whop route is on (unsigned POST → 401). **Blocked:** the Whop v1 webhook is still disabled inside Whop. WHOP_API_KEY is a hidden Netlify secret with no webhook scope, no Whop CLI on the Mac, and the built-in browser is not signed in to Whop. Needs one click in the Whop dashboard: https://whop.com/dashboard/biz_Iyh4wHBV0UYvP0/developer/ . Journey + changelog in PR #90 (docs only).
- C / PR77 — **WAITING, next after A** (bank-outreach, 2026-10-20): PR77 head e382f1edb CI all green. Prepping origin/main merge on the branch only; no merge to main until A writes MERGED.
  - origin/main (1297a6e6b) merged clean into PR77 → head 4a13e3618 pushed; lint + tsc pass locally; CI runs 39476786793 / 39476798301 / 39476786704 queued.
  - 4a13e3618: both `tests` runs green; dedicated `hourly-release-runner` never got a macOS runner (no step ran, cancelled at 20 min) — infra, not a test.
  - PR83 landed (d5e055d10) → re-merged main into PR77. 5 conflicts, all keep-both: expected-migrations regenerated (Blueprint 482/483/485/488/489 + Bank 483/484; migrate.mjs keys by full filename so shared 483 is safe, same as the existing two 482s), beats list (both beats), workflow history + journey REGISTERED 101→102 (both crons), fin-b23 send-lock test (main's draft wait + our stray-click checks). 77 workflow/pulse registry tests, lint, tsc pass; full no-DB suite running.
  - Live walk plan: built-in browser has no staff sign-in and no unmasked staff password on the Mac, so signed-in read proof = `bank-outreach-live-proof.yml` (repo secret, read-only). First save = manager import of official FDIC list (251 banks AZ/SC/FL/CA, parser dry-run OK) via the real store, then read back. No outreach sent.
- C / PR77 — **MERGING** (bank-outreach, 12:31 MST): head `4eebab840` (main `d5e055d` merged in, 5 keep-both conflicts above, diagrams regenerated) pushed; waiting on CI, then merge to main. B: after C lands, journey REGISTERED is 102 on main (Bank cron + Whop drain) and your PR adds the 103rd.
  - CI on `4eebab840`: both full `tests` matrices green; Ubuntu `outreach` job green (real Postgres, 50 Chromium bank cases, strict scratch). Mac-only `hourly-release-runner` cancelled again — GitHub: "not acquired by Runner of type hosted even after multiple attempts" (macOS capacity, same cause as PR87). Rerun queued. Its checks are still covered: ship.mjs runs `pulse/prove.mjs --beats` + morning proof as a deploy gate; bank page/CSS/JS unchanged since WebKit passed on e382f1edb (PR83 only added two unused brand.css rules).
  - Holding the merge until A's ship 39486073918 starts running, so C's ship queues behind it instead of replacing it.
  - A's ship started. Main moved to PR87 (ship on Ubuntu) → merged into PR77. That broke `prove-policy.test.mjs` (pins outreach bundle proof to the ship runner, which was macOS). Fix `ff066bc60`: outreach `hourly-release-runner` and manual `bank-outreach-live-proof.yml` now `ubuntu-latest` (pgvector service DB on the same port/app-role URL; `--with-deps` browsers); pins updated to match. 30/30 policy + live-proof guard tests pass. Fresh CI 39487260397 / 39487263539 / 39487260651 running. Note: Codex measured Ubuntu public-GET stalls before; if the hourly proof goes red on that, it stays red and is reported, not relaxed.
  - HOLD (coordinator message): no PR77 merge until the coordinator's Mac ship of main 78b08d2 finishes and they say the queue is open.
  - CI on `ff066bc60` (kept red, no rerun): PR `tests` 39487263539 all green. Push `tests` 39487260651: one red = `scripts/marketing/lib/fetch.test.mjs:151` RateLimiter "expected >=240ms across 3 waits, got 239ms" (file untouched by PR77; same SHA passed that shard in the PR run). Dedicated 39487260397: `outreach` green; Linux `hourly-release-runner` — 19 beats load, bank-outreach green, blueprint-delivery green, WebKit 27/27, morning outreach 2 PASS/0 FAIL; its only PROBLEM is `doors-live` GET /api/public/survey-submit no answer in 8007 ms from the Ubuntu runner = the same Linux GET stall the coordinator is fighting on ship. The other 7 reds are the usual empty-scratch operational reds.
- C / PR77 — **MERGED** 14:01 MST as `405002085` (head `ff066bc60`; main only moved by the `ship: 78b08d2f` log line, included by the merge). Queue is free for B. C's Linux auto-ship is next; if it stops on the GET stall, C tells the coordinator and does not rerun it. B: main now has Bank migrations 483/484 and REGISTERED 102.
  - Linux auto-ship 39496970203 STOPPED (not rerun): migrations 483/484 applied on prod (health 402 applied, pending 0), then the hourly bundle gate failed on runner GET slowness (slo-repair-checkout 7564 ms, funnel-checkout 7572 ms, 4 beats cut at 13 s). Code NOT deployed — live still expects 373. Told coordinator; coordinator is running the Mac ship of 405002085. C does not start one.
  - Already done on live data (tables exist since 483 applied): manager import of the official FDIC list through the real store as chris@fundhub.ai (owner) → imported 251, existing 0; read back list total 251 and team view AZ 12 / CA 115 / FL 81 / SC 43, each "Assign a rep and find a banker". No outreach sent. Live `bank-outreach` beat GREEN 429 ms (read-door skipped until deploy); `pulse:prove --lanes=gap-bank-outreach` on live data PASS 75 / FAIL 0, nothing written. After deploy: page + signed-in read proof.
  - OUTAGE ~21:12–21:18 UTC: coordinator's Mac ship of 405002085 (deploy 6ad7d95184c9dde6708f82cb) took every /api door to 502 — "Cannot find module '../../vendor/underwriteiq-full/api/lite/crs/lender-matrix.js'", stack /var/task/.claude/worktrees/ship-main/netlify/functions/api.mjs. Cause: ship ran from `.claude/worktrees/ship-main`, nested inside the main checkout, so the function bundled under that subpath while included_files `vendor/underwriteiq-full/**` landed at site root. C reported it; coordinator restored 6ad7cc5e4fd137a736af3437 (78b08d2f). Health 200 again. Outreach code NOT live yet. Redeploy must run from a folder not nested in the repo. C does not deploy; waiting on coordinator.
  - CORRECTED bank list (Chris caught it): the first 251 were FDIC banks HEADQUARTERED in AZ/SC/FL/CA only. `docs/specs/bank-outreach-plan-2026-10-14.md` says every bank per state where it has branches, plus credit unions. Re-pulled per the plan: FDIC Locations (branches) joined to active Institutions → 511 bank-state rows; NCUA call report 2026-06 `Credit Union Branch Information.txt` + `FOICU.txt` → 543 credit-union-state rows. Imported through the real store (fdic: 260 new / 251 existing; ncua: 543 new). Live total 1,054: AZ 122, CA 449, FL 343, SC 140. Spot check AZ: JPMorgan Chase, Wells Fargo, Bank of America, Western Alliance, Desert Financial all present. No outreach sent.
  - ALL STATES (owner order via coordinator): live `bank_relationships` program states set to all 56 STATE_CODES (one-row UPDATE through the app role, which 483 grants UPDATE on outreach_programs; no code/deploy). Imported FDIC Locations (56 per-state pulls; Oregon needs `STALP:"OR"` quoted) joined to active Institutions = 6,148 bank-state rows, and NCUA 2026-06 branch file + FOICU = 5,420 credit-union-state rows, in 9 chunks through the real store; 0 failed, existing rows untouched. Live total 11,568 across 55 codes (AS has none). Top 5: TX 927, IL 607, NY 489, CA 449, PA 449. Lenders sheet not touched. No outreach sent.
- B / PR85 — **WAITING, third after A then C** (cortana-invoices, 2026-10-20 11:47 MST): origin/main (1297a6e6b) merged clean → head b91d6d4e0, flake fix in; lint + tsc pass; CI 39477515584 / 39477521622 queued. Will re-merge main after A and C land, then MERGING.
  - 11:59 MST: merged main `d5e055d` (PR83) locally → `9fc7e0d61`. 6 conflicts fixed: migration list (482–489 both sides, regenerated, matches), journey count 103, workflow imports (both), payment-links (kept PR83's Blueprint price check; link id stays inside the locked mint), 2 diagrams regenerated. Lint, tsc, 132/132 focused guards pass. Not pushed yet — waiting for C so runners stay free for C.
  - 12:2x MST: CI 28/28 green on `b91d6d4e0` (screens job included, flake fix holds). Local full unit suite on `9fc7e0d61`: 28,320 pass, 1 fail = `src/pulse/self-audit.test.mjs:1221` timing test (not touched by PR83 or PR85; passes 5/5 alone; Mac was loaded). CI decides.

- B / PR85 — **MERGING** (cortana-invoices, 14:0x MST): merging main `405002085` (PR77) into branch, then CI, then merge. Others wait.
  - Head `d19b0d4b7` pushed: main `405002085` merged; 4 conflicts (migration list regenerated, 378 keys incl. two 484s by full name; journey count 104 = 102 + 2 fee clocks; 2 diagrams regenerated). Lint, tsc, 186/186 focused tests pass. Waiting on CI.
  - **MERGED** 14:31 MST as `801d3e7d9` (head `d19b0d4b7`; PR run 14/14 green; main only moved by `ship: 40500208` log line, included by the merge). Auto-ship next — watching. Queue is free for D.
  - CI on `d19b0d4b7` (kept red, no rerun): push run 39497306141 one red = `src/pulse/catalog/proofs/fin-b01-display-specs.test.mjs` → `e2e/fin-b01-optimize-intake.spec.mjs:66` page.goto timeout on `/optimize.html` (7/8 passed; page does not load any file PR85 changed; same SHA passed that shard in the PR run; 40/40 locally). PR run waiting on screens job.
- D / PR86 — **WAITING, last after A, C, B** (coordinator, 2026-10-20): https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/86. Test-only fix for `page_money_setup` (waits for the soft-pull POST) + fin-b15 read-loop fix in `marketing-cc-scripts.js` (logic only, no design). Mutes and `test.fail` removed per `FIN_B15_FINDINGS.whenFixed`. Local: 5,701 proof tests, 75/75 specs (3x), lint, tsc clean. A, B, C: if main's `page_money_setup` 390 red blocks your CI, say so here and D goes first.

## B2 — Cortana link end to end (Chris, 2026-10-20 ~14:15 MST: "make sure this is 100% done end to end")

Split under B. All read-only until the exact fix step is known.

| ID | Owner | Status |
|---|---|---|
| B2.1 — Why Cortana's Commas feed shows 0 payments (Commas webhook list, payments since 10-01) | helper agent of `cortana-invoices` | claimed |
| B2.2 — Cortana's documented server event intake (invoice sent / paid) | helper agent of `cortana-invoices` | claimed |
| B — PR85 merge + ship | `cortana-invoices` | MERGING |

Prompt B2.1: Read-only. In the fee worktree, read `src/payments/commas-api.mjs` and the Fanbasis API docs (apidocs.fan, commasdocs.com). With GET only and keys from root `.env` (never printed), list Commas webhook subscriptions per key, count payments since 2026-10-01, and check whether Cortana's source webhook (`/api/webhook/5c02fe28-…/78def8fe-…`) is registered. Report the likely cause and the one fix call — do not run it.

Prompt B2.2: Read-only. Find Cortana/DirectROAS's documented server-side event or webhook-source intake (endpoint, auth, fields, dedupe, non-revenue). Read `src/ads/fh-events-harness.mjs` and `public/funnel/fh-events.js`. Never send an event or guess a payload; if docs are not public, say so.

**B2 result (2026-10-20):** B2.1 — Commas→Cortana payment webhook is registered and active on Commas org 1766728 (`app.usecortana.ai/api/webhook/fanbasis/5c02fe28-…`, created 09-25, last fired 10-01); Cortana shows 0 payments because the newest Commas payment is 09-15. B2.2 — no public server-event docs; in app.directroas.com (signed in, read-only) custom events only offer New Revenue / LTV and a Webhook source shows its contract only after creation. Owner: build "invoice sent" only if Meta suggests it. Meta does not (Purchase on payment is the money event; stage events are for Meta lead-form Conversion Leads with Meta lead_id). **Closed — not built. Nothing created in Cortana, nothing sent.**

## B3 — Cortana weighted payment feed (Chris, 2026-10-20 evening: "yes, set it all up" → "Fundhub sends it")

Owner map: soft pull (light step) → first purchase → per-round funding fee; every later payment (portal repair for next round, $1k auto-checkout, Blueprint deposit + fee, repair+funding mixes) is LTV.

- **Cortana side DONE (app.directroas.com, signed in):** new conversion **Soft Pull**; one Webhook source "Fundhub server - …" added to Soft Pull, New Deals Closed and All Payments (LTV); 12 fields mapped on each (name, email, phone, value→Revenue, 5 UTM, fbclid, gclid, conversion_date). One labeled test sample per source (example.com email) — counted as *test*, 0 conversions. URLs saved to `.env`, `credentials/env.full.snapshot`, Netlify (`CORTANA_WEBHOOK_SOFT_PULL_URL`, `_FIRST_PURCHASE_URL`, `_ALL_PAYMENTS_URL`, no --secret) + `CORTANA_FEED_ENABLED=1`.
- **Code (branch `claude/cortana-weighted-feed`, migration 499):** 5-minute clock `cortana-payment-feed` reads paid `transactions` (Commas + Whop), ledger `cortana_feed_sends` is the dedupe, provider `src/messaging/providers/cortana-webhook.mjs`, heartbeat job row, money tripwire `ads:cortana-payment-feed`, hourly beat `cortana-feed`, real-Postgres test.
- **After ship (B does it):** switch OFF Cortana's native "First Commas (Fanbasis) Purchase (account)" and "Commas (Fanbasis) Payments (2ff3a814)" sources so nothing counts twice.
- **Not possible for agents:** Whop connect inside Cortana (needs Whop key paste) — not needed now, Whop money comes through the server feed.

## Leftovers for Codex

- **Bank outreach state filter + import note still say 4 states** (from C, 2026-10-20): live program now covers all 56 codes and holds 11,568 targets, but `public/app/bank-outreach.html` State filter only offers AZ/SC/FL/CA ("All launch states"), and the import dialog text says "in AZ, SC, FL and CA" (`bank-outreach.js` import message says "outside launch states"). Reps can still see everything via "All launch states" and search. Screen words/options are Codex's design; Claude did not change them.

(design changes found by Claude sessions go here; Claude does not do them)

## D — Linux ship gate (coordinator, 2026-10-20 ~13:15 MST)

- Note: PR87 (ship on Ubuntu) was not opened by the coordinator.
- Ship 39486073918 stopped only on timing: `money-checkout` took 8,252 ms on the Ubuntu runner and also *skipped* `checkout-funnel-door` there, so one GET to `https://fundhub.ai/api/public/funnel-checkout` hung until its own timeout. The same gate on the Mac, on current main `78b08d2` (18 beats): OK, `money-checkout` 813 ms; the door answers in 0.3–0.8 s by curl. Read: a network hang on that runner, not code. The failed job was already re-queued (not by D). D watches it. If it stops the same way again, D fixes the cause in code (never by raising the deadline or weakening the gate).

## Leftovers (red beats seen in the ship gate — not this batch's named work, not fixed here)

- `email-path` / `text-path`: templates `EMAIL-S00-WELCOME`, `EMAIL-S04-01-CONFIRM`, `CONTRACT-SEND-EMAIL`, `SMS-S00-WELCOME`, `SMS-DOC-01-REQUEST` missing on production (matches the 2026-10-12 test-pollution note).
- `apply-links`: one bank Apply link `www.mybrb.bank` returns 404 (lender `b004d840`).
- `whop-billing`: no Whop payment clock in the last 3 minutes (Whop webhook is OFF by owner order; Blueprint lane).
- `money-operations` (Linux runner only): `FINANCE_OS_SETUP_FEE_CENTS` not set in the ship runner's env.

## D — ship blocked (coordinator, 2026-10-20 ~13:40 MST) — STOPPED per stuck rule

- Linux ship 39486073918 attempt 2 (not started by D): stopped again at the same gate, different door — `doors-live` 8,003 ms, `GET /api/webhooks/commas` no answer (timeout). Two runs, two different fundhub.ai doors hung exactly 8 s (the probe timeout). fundhub.ai has no IPv6 record and ship already forces IPv4. The live hourly pulse on Netlify: 73 runs in 3 days, 0 timeouts on `doors-live`/`money-checkout`. So the hang is the GitHub Ubuntu runner's path to fundhub.ai, cause not found.
- Mac ship (`.claude/worktrees/ship-main`, local main moved to `origin/main` 78b08d2; its 2 old local-only commits are safe on `fix/display-lane-time` and `fix/brief-whole-suite`): stopped at the database step, before deploy. `SUPABASE_ACCESS_TOKEN` in `.env` → Supabase 401 "Invalid access token" (same 401 as the Supabase MCP). `MIGRATION_DATABASE_URL` in `.env` is a masked placeholder. Nothing deployed.
- Live state: health ok, pending 0, PR83 migrations 482/483/485/488/489 applied; PR83 code NOT deployed. A/B/C: hold merges and activation.
- Needs Chris: a working Supabase access token for the Mac (https://supabase.com/dashboard/account/tokens). With it, D ships main from the Mac, then each PR in queue order.

## D — correction (2026-10-20 ~14:00 MST): main IS live

- Main `78b08d2f` was shipped from this Mac at 13:19 MST by another session (commit `c17db693e` "ship: 78b08d2f is live", ship log "400 applied, 0 pending"). Health: expected 373 = main manifest, pending 0. PR83 code is deployed. D's own Mac ship ran after it and stopped at the database step before deploy, so it did nothing.
- Queue open. A: activate. C: merge PR77 now, then B.
- Still true: the Linux auto-ship GET stall is unsolved, and the Mac's `SUPABASE_ACCESS_TOKEN` (…3046) gets 401. Neither blocks right now.

## Final state (coordinator, 2026-10-20 15:21 MST)

| ID | PR | Live |
|---|---|---|
| A Blueprint offer + coaches | #83, #90 | Yes (ship 78b08d2f). Coaches + 3 templates on. Monthly pull ON (`FINANCE_OS_SYSTEM_PULL_LIVE=1`). Whop webhook still disabled inside Whop: needs Chris's dashboard click. |
| B Cortana per-round invoices | #85 | Yes (ship 801d3e7d, migrations 484/486/487). Commas→Cortana payments linked. "Invoice sent" sender parked: Cortana docs are behind Chris's login. |
| C Bank outreach | #77 | Yes (ship 40500208). 11,568 bank/credit-union state rows, 55 of 56 codes, program states = all 56. Signed-in live read not run (GitHub STAFF_E2E_PASSWORD stale; copying the owner password into a robot secret needs Chris's own yes). Automatic half (Apollo + Salesforge) not built: no accounts. State filter UI lists 4 states → Codex card. |
| D Main red + fin-b15 loop | #86 | Yes (ship 1574eacb). |

Incident: 14:16–14:18 MST the live API returned 502 after D shipped from `.claude/worktrees/ship-main` (nested inside the repo: Netlify bundled the function under `.claude/worktrees/ship-main/`, so `../../vendor/...` did not resolve). D restored deploy `ship 78b08d2f` via `netlify api restoreSiteDeploy` (the raw API token got 401 on restore), then reshipped from the non-nested `/Users/chrisstanbridge/fundhub-ship`. Ship from a non-nested folder only.

Open: Linux auto-ship hangs on one fundhub.ai GET per run (4 of 4 runs); Mac ship works from `/Users/chrisstanbridge/fundhub-ship` with `MIGRATION_DATABASE_URL=$DATABASE_URL` only when pending is 0 (let the Linux ship apply migrations first). Mac `SUPABASE_ACCESS_TOKEN` (…3046) gets 401.

## Owner calls, 2026-10-20 ~16:00 MST

- Whop webhook: yes. Checked in the Whop dashboard: `https://fundhub.ai/api/webhooks/whop-billing`, v1, **Active**.
- "We only use ClarityPay" (owner, said with the Whop/financing answer). Recorded as stated; nothing changed.
- Apollo and Salesforge: **no paid tools now**. Automate outreach as far as possible without them → session `outreach-auto` (board `ops/workflows/bank-outreach-auto-2026-10-20.md`).
- Cortana: Chris signs in in the browser pane; then the "invoice sent" sender gets built.
- Robot login (owner password into a GitHub secret): dropped.

## D — Linux ship gate: cause found, fix in PR #93 (exciting-ramanujan session, 2026-10-20 ~17:00 MST)

- **Cause.** From a GitHub Ubuntu runner, some connections to fundhub.ai's front door (Netlify apex load balancer 75.2.60.5 / 99.83.231.61) go silent. TCP connects, the server ACKs every byte, then no answer ever comes. Measured with packet capture: 59 of 1,120 TLS handshakes silent with 14 at once; 3 of 600 one at a time. curl and Node alike; post-quantum and classic key share alike; DNS and TCP clean. Not our code. The Mac and the live Netlify pulse do not see it.
- **Fix (PR #93).** The pulse proof (only the proof, not the live probe) sends one more identical GET/HEAD to the site after 1 s of silence and takes the first answer. No deadline or half-deadline rule changed. A door that answers neither is still red.
- **Proof before merge.** Run 39516992055: plain 11 of 630 GETs hung, hedged 0 of 630; real `prove.mjs --beats` 3 of 3 OK.
- **Next.** Merge PR #93 → the Linux ship of main deploys by itself (this also ships PR #91, whose ship 39511244534 stopped on the same hang).
- Diagnosis branches `diag/linux-get-stall` and `diag/linux-get-stall-fix` are tools only, never for main; deleted after the ship.

## D — Linux ship gate, follow-up (exciting-ramanujan, 2026-10-21)

- PR #93 (one extra try) landed 2026-10-20. Linux ships after it: 6 went live, 8 stopped. 5 of the 8 lost one fundhub.ai door on **both** connections. Measured why (run 39523413721): the apex load balancer's silence comes in clumps — 74 of 700 handshakes went silent with 14 at once, often 5–6 in the same instant (Netlify's ordinary edge road: 3 of 700; one at a time: 0 of 150).
- PR #98 spreads up to two extra tries 1 s apart. Verified on the runner (run 39524495899): plain fetch 17 of 840 hung, hedged 0 of 840; real `prove.mjs --beats` 6 of 6 OK (one needed the third try). PR #114 (other session, body stalls) is kept; PR #98 is merged on top of it.
- **DONE.** PR #98 merged as `5d07f3fb5`. Its Linux ship 39576830316 went live by itself: hourly proof OK (2 doors went silent and the second connection answered), deploy `6ad8869806cc63a5812ffd5a`, health 419 applied / pending 0, ship log `7310eed32`, published-file check PASS.
- **Leftover — apply-links timing (not fixed here, stop per no-extra-holes).** On the Linux runner the apply-links beat takes 3.4–6.5 s. In 5 of 12 ship runs it reached 6.0–6.5 s, over half its 12 s deadline, and that alone stopped runs 39529832163 and 39552558577. Cause: nearly every run one bank Apply page hits the beat's own 4.5 s read limit; reads start at 0.6–1.6 s, so the beat ends at ~5–6.5 s. These are outside bank sites, not fundhub.ai. A fix means changing that beat's read timing or the half-deadline rule — a gate/beat decision, so not done here.
  - Prompt: "Read-only first. On a GitHub ubuntu-latest runner (branch diag/linux-get-stall-fix has scripts/diag/net-trace.mjs, a passive tracer loaded with `--import`), run `node scripts/pulse/prove.mjs --beats` 8 times and list which bank hosts hit the apply-links 4.5 s read limit and in which phase (no TLS answer, or a slow page). Then propose the smallest change that keeps apply-links under half its deadline on Linux without raising any deadline, loosening the half-deadline rule, or hiding a slow bank. Board: ops/workflows/codex-finish-2026-10-20.md section D."
