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
| A — Blueprint PR83 release + activation | Claude session `blueprint-release` | claimed — MERGED, shipping |
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
- B / PR85 — **WAITING, third after A then C** (cortana-invoices, 2026-10-20 11:47 MST): origin/main (1297a6e6b) merged clean → head b91d6d4e0, flake fix in; lint + tsc pass; CI 39477515584 / 39477521622 queued. Will re-merge main after A and C land, then MERGING.
  - 11:59 MST: merged main `d5e055d` (PR83) locally → `9fc7e0d61`. 6 conflicts fixed: migration list (482–489 both sides, regenerated, matches), journey count 103, workflow imports (both), payment-links (kept PR83's Blueprint price check; link id stays inside the locked mint), 2 diagrams regenerated. Lint, tsc, 132/132 focused guards pass. Not pushed yet — waiting for C so runners stay free for C.
  - 12:2x MST: CI 28/28 green on `b91d6d4e0` (screens job included, flake fix holds). Local full unit suite on `9fc7e0d61`: 28,320 pass, 1 fail = `src/pulse/self-audit.test.mjs:1221` timing test (not touched by PR83 or PR85; passes 5/5 alone; Mac was loaded). CI decides.

- D / PR86 — **WAITING, last after A, C, B** (coordinator, 2026-10-20): https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/86. Test-only fix for `page_money_setup` (waits for the soft-pull POST) + fin-b15 read-loop fix in `marketing-cc-scripts.js` (logic only, no design). Mutes and `test.fail` removed per `FIN_B15_FINDINGS.whenFixed`. Local: 5,701 proof tests, 75/75 specs (3x), lint, tsc clean. A, B, C: if main's `page_money_setup` 390 red blocks your CI, say so here and D goes first.

## Leftovers for Codex

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
