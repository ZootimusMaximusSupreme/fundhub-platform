# W6 manifest: finish the lists (L0)

Batch: `ops/workflows/coverage-every-surface-2026-10-10.md` (not edited by this workflow, as ordered).
Builder: W6. Branch `cov/w6-lists`, folder `.claude/worktrees/cov-w6`. Built 2026-10-10.
Nothing is pushed. Nothing is merged. No code was changed and no product bug was fixed. This change writes lists.

## In one minute

- I wrote **8 new list files**. They hold **1,284 rows**. Every row is one real thing: a table, a key name, a job, a door, a page control, an agent, a trip step.
- Each row says what the thing does, what it touches, how much it matters, and what (if anything) watches it.
- Every live thing in those 8 families is now on a list. Before, 29 jobs, 52 doors, the webhook doors, 21 pages, every key, every table and every agent were on none.
- 33 of the 1,284 rows repeat a thing an older list already had (the same `workflow:<id>` name). So there are **1,251 new unique rows**.
- The whole folder now holds **3,974 rows** (3,941 unique).
- The new rows lean low. Of 561 money, message and record rows in the new files, only **206 have a real check (L3)**. 355 do not.

## The 8 files

| File | Rows | What it lists | none | ping | e2e | deep |
|---|---|---|---|---|---|---|
| `tables.json` | 271 | every table made in `db/migrations` and `db/schema`: who writes it, who reads it, which pulse lane reads it | 8 | 0 | 142 | 121 |
| `keys.json` | 428 | every env name the code reads (names only): 203 the live app reads, 126 only inside `vendor/`, 53 only in scripts, 27 only in tests, 19 set by the host | 393 | 0 | 0 | 35 |
| `jobs.json` | 116 | all 100 Inngest workflows and all 16 Netlify function files | 0 | 6 | 64 | 46 |
| `routes-3.json` | 52 | the 52 routed doors that had no row | 0 | 7 | 39 | 6 |
| `webhooks.json` | 29 | every inbound door: the 5 signed doors in the router table, Twilio (2), Resend, Mailgun (2), PostGrid, Submagic, the 2 merchant doors, the open merchant API, RB2B, the VSL beacon, owner-text, Inngest, signed links, and the 3 secret-header functions | 0 | 13 | 2 | 14 |
| `public-pages.json` | 182 | every form, button and link on the 43 public pages outside `/app` (23 page rows for pages no list named, 16 forms, 17 buttons, 125 distinct links, 1 map read) | 31 | 127 | 1 | 23 |
| `agents.json` | 47 | all 27 rows in the live `agents` table, the reply runtime, and 19 places the code calls a model | 11 | 5 | 21 | 10 |
| `journeys.json` | 159 | every step in the 17 `*-intended.md` files, plus the 6 board columns of `funding-round-flow.md` | 89 | 15 | 28 | 27 |

Row shape is the same as the older files: `surface, control, kind, calls, tables, impact, coverage, evidence`. Extra keys are added where they help (`route, methods, who, file, trigger, env_name, secret, header, code, status`).

## How I scored (so you can check me)

- `deep` only when a lane, beat or slice reads the data the thing wrote and can go red. The evidence names the file and the check id.
- `e2e` when a test runs the real code (a test file imports the handler or the writer). Tests with a fake database count, as in the older files.
- `ping` when only a `reg:`, `job:` or `wf:` row answers.
- `none` when I could point at nothing. A key name is `deep` only when a lane reads the live value.
- A page form is `deep` when `gap-funnels.mjs offer:*` reads that the form and its post target are on the live page. That check does not submit the form. The evidence says so.
- A row that repeats an older surface is flagged `repeats_row_in` and carries `older_row_coverage`.
- Reads on the live database: one set of read-only queries on `agents`, `agent_triggers`, `agent_runs`, `agent_shadow_log` (BEGIN READ ONLY, then ROLLBACK). Nothing else was read live. No secret was printed or written.

## The new numbers (W6's count, for board section 2)

The board file was not edited. Paste this block over section 2 "The numbers" when you integrate.

### Totals

| | Rows | none (L0) | ping (L1) | e2e (L2) | deep (L3) |
|---|---|---|---|---|---|
| Older 12 lists (as written, not re-scored) | 2,690 | 348 | 388 | 1,406 | 548 |
| New 8 lists, W6 | 1,284 | 532 | 173 | 297 | 282 |
| **All 20 lists** | **3,974** | **880** | **561** | **1,703** | **830** |
| All 20 lists, repeats counted once (33 fewer) | 3,941 | 880 | 561 | 1,692 | 808 |

### By impact (all 20 lists, repeats counted once)

| Impact | Rows | none | ping | e2e | deep | Meets the rule |
|---|---|---|---|---|---|---|
| Money | 481 | 44 | 50 | 233 | 154 | 154 (needs L3) |
| Customer message | 488 | 69 | 37 | 183 | 199 | 199 (needs L3) |
| Customer record | 864 | 106 | 66 | 466 | 226 | 226 (needs L3) |
| Staff only | 848 | 149 | 96 | 444 | 159 | 603 (needs L2) |
| No impact | 1,260 | 512 | 312 | 366 | 70 | 436 (needs L2) |
| **All** | **3,941** | 880 | 561 | 1,692 | 808 | **1,618** |

- Below the rule: **2,323** of 3,941.
- Money, message or record rows with no L3 check: **1,254** (327 money, 289 messages, 638 records). The older lists had 910 of 1,305.
- The new 8 files alone: 561 money, message or record rows, 206 with L3, 355 without (88 money, 98 messages, 169 records).

### Warnings about these numbers

- The older 2,690 rows are **not re-scored**. Wave 1 added 5 families of checks, 58 lanes and 10 beats after those rows were scored. Many older `none` and `e2e` rows are probably `deep` now. Re-scoring the old folder is its own job.
- 7 workflows are scored differently here than in `messages.json`. The older scorer called a workflow `deep` when any one of its templates had a check. I call it `deep` only when a check reads what that workflow's trigger should have made.
  - Older `deep`, now `e2e`: bs-01-precall-launcher.
  - Older `e2e`, now `deep` (a lane that landed since): finance-os-card-due-reminders, finance-os-money-agent, blueprint-finance-os-alerts, f-07-funding-locked, s-nobook-chase, s-05a-no-show-recovery.
- A key name is scored on whether a lane reads its live value. 393 of 428 names have no such lane, and 126 of those are read only inside `vendor/`.

## What the lists found (leftover cards, not fixed)

One card each. Nothing here was touched.

- [ ] **Three live voice and text agents cannot hand off.** AG-04, AG-09 and AG-01 have blank "Escalate to" and "when" boxes; only "after 15 minutes" is set.
- [ ] **AG-04 Setter Josh is retired on live** (2026-09-26) while `ai-set-01-josh-setter` is still wired. The workflow refuses to dial while the row is not ready, so this is safe today. No agent_triggers row exists for AG-04, so `ai-agents:retired` does not see it.
- [ ] **AG-09 is live and no check sees a failed bureau call.** The inquiry call sweeper writes no `agent_runs` row per call. `calls:ai-dial-no-failure` reads only the setter's runs.
- [ ] **Two test rows sit in the live `agents` table:** `VF-LIVE` and `VF-SHADOW`.
- [ ] **Retired `GHL-*` agents still have enabled trigger rows,** including a second `docs.received` trigger (GHL-DOC) next to DOC-CHECK's.
- [ ] **DOC-CHECK is live with no guardrails saved.** It copies legal name, address and date of birth onto the identity record.
- [ ] **`partner_payouts` and `partner_payout_lines` have no writer.** Nothing in `src`, `api`, `netlify`, `scripts`, `vendor` or `tools` inserts into either. Two checks read `partner_payouts`, so they can only pass or find nothing.
- [ ] **`vsl_funnels` is a dead table** (no app code reads or writes it). `brand_kits` and `brand_kit_sources` have no writer in app code.
- [ ] **The Mailgun bank-email door is money and only pinged.** `MAILGUN_SIGNING_KEY` is read by no lane. That door is how a bank yes arrives (F-11).
- [ ] **The merchant doors are unwatched:** `merchant-whop/<id>`, `merchant-commas/<id>` and `/api/merchant/events` have no lane and no ping. They write `merchant_events`.
- [ ] **75 money, message or record key names in the live app have no watch,** among them `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `AD_TOKEN_ENC_KEY`, `META_APP_ID`, `META_APP_SECRET`, `TWILIO_ACCOUNT_SID` (inbound texted documents need it), `OPS_NOTIFY_SECRET`, `VAPID_PRIVATE_KEY`, `FINANCE_OS_TRANSFERS_LIVE`, `FINANCE_OS_TRANSFER_MAX_CENTS`, `SUBSCRIPTION_BILLING_ENABLED`.
- [ ] **4 of W8's 5 trips have no start-to-end intended file.** Roadmap has one (`slo-offer-intended.md`). Funding and repair have code-traced flow files only. Inquiry and partner have only the role matrix. The 8 role files are copies of the code (README says "a mirror, not a test"), so 89 of 159 journey rows are `none`.
- [ ] **172 `agent_runs` rows in 30 days have outcome `no_client` and no agent code:** the runtime could not match an inbound message to a client.
- [ ] **Recon (AG-07) shows 11 `fail` and 12 `pass` runs in 30 days; the last fail is 2026-10-10 13:02.** A `fail` means the pulse found a break that morning. That is the pulse working, not Recon broken.
- [ ] **Three signed doors are only checked for "is it there, is the key set":** Lendflow, Bland and PostGrid. No lane reads what they changed.
- [ ] **`src/pulse/registry.test.mjs` fails in a fresh worktree** because the leads page is git-ignored (known trap, passes in the main folder).

## Honest limits

1. **Writers and readers of a table are found by reading the SQL text** (`INSERT INTO`, `UPDATE`, `FROM`, `JOIN` and a name). A table touched only through a dynamic name or a view is missed. Views and DB functions are not listed. 27 tables have no writer in app code. I searched `db/seed` and `db/migrations` too: 19 of them are filled only by a seed or a migration. 8 have no writer anywhere: `partner_payouts`, `partner_payout_lines`, `vsl_funnels`, `brand_kits`, `brand_kit_sources`, `mail_campaigns`, `mail_tracked_numbers`, `sources` (the mail and warehouse ones are scaffolds that wait on a gate).
2. **Env names are found by `process.env.X`, `env.X`, `env["X"]` and quoted names.** A name built at run time (for example `MERCHANT_SECRET_ENC_KEY_<id>`) is listed under its base name only.
3. **Public pages: 25 in-page anchors (`#...`) are not listed** (nothing can break there). The climate page is a static export drawn by scripts, so its 5 controls come from `docs/journeys/climate-lead-magnet-intended.md`, not from HTML. The leads page is git-ignored and exists only in the main folder; it is listed without its folder name and without any of its content.
4. **Agents:** statuses are as read live on 2026-10-10. An owner can change them in the Agent Editor at any time.
5. **Journeys:** one row per step in each intended file. I did not invent steps. The funding-round-flow columns are marked as from a code-traced flow file, not an intended file.
6. **Coverage on a link row** is the page ping plus whether its target is itself pinged. A ping on a page does not read what the link says.

## Files

New (all under `ops/workflows/coverage-every-surface-2026-10-10/`):
`tables.json`, `keys.json`, `jobs.json`, `routes-3.json`, `webhooks.json`, `public-pages.json`, `agents.json`, `journeys.json`, `manifest-w6.md`.

Not touched: every older list, the board, every `src/` file, `modules.mjs`, `tripwires.mjs`, `tripwires-baseline.json`, `na-conditions.mjs`, `self-audit.mjs`, `beats/index.mjs`. No check was built, so none of the shared lists needed a line, and `BASELINE_MAX` did not move.

## Proof

- Every row was checked by a script: valid JSON, all 8 keys present, `impact` and `coverage` in the allowed words, `calls` and `tables` are lists, every `src/`, `e2e/`, `api/`, `scripts/`, `db/`, `docs/` path in a control or evidence string exists on disk (0 bad paths).
- Secret scan of the 8 new files: no key shape, no connection string, no long hex or base64 string that is not a path. Names only for keys.
- `npm run lint`: 3,267 files parse clean.
- Pulse unit tests (`node --test "src/pulse/**/*.test.mjs"`, no database): 3,237 tests, 3,099 pass, 1 fail, 137 skipped. The 1 failure is `registry: every registry row names a real handler or desk file` (the git-ignored leads page, see above). It passes in the main folder.
- `npm run pulse:prove` (built bundle, live database, read only): **OK**. "Every listed file is in the bundle, no step threw or passed 20 s, no SQL error, nothing tried to write." 58 gap lanes answered, 1,072 expected checks all showed up, 100 of 100 workflows covered. It took 3 minutes 31 seconds. The report it printed from the Mac had 795 rows: 707 green, 15 red, 66 nothing to judge, 7 not checked (the 7 are keys and mail checks that only the live server can read). Those reds are the existing checks, not mine, and some name keys that read as missing only on a laptop. I did not look into them.
- No code changed, so no new test was needed and none was skipped, deleted or weakened.

## Notes for the integrator

- Paste the "new numbers" block over board section 2. Mark it as W6's count.
- Add the 8 file names to the board's evidence list. The board says "12 lists"; it is now 20.
- After W8 reads `journeys.json`, note that 4 of its 5 trips have no intended file.
- To run the tests I made two links inside the worktree (`node_modules` and `.env`, both git-ignored). I removed them again before the commit.
