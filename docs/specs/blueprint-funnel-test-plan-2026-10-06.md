# Blueprint funnel test plan (2026-10-06)

Revision 2. This version takes in the Fable review (read only, about 06:00 on 2026-10-06). That review checked the first draft against local `main` and the branches `mm-x1`, `mm-x2`, `mm-x3`, `mm-x5`, `mm-x8`, `mm-u34` and `mm-u36`.

**Owner order (2026-10-05).** Once the Command Center is built and shipped, test it by building the Capital Blueprint book-a-call funnel from start to finish **through the dashboard's own code**, never through Claude Code. The steps are: avatar, ad research, offer, copy, ad strategy, a script batch ready to film, then tracked funnel pages at a new address, pushed live. Then prove every piece.

**What was built when this was written.** On `mm-wave2a`: X4 (the funnel builder) and U22 (the worker and clock). X3 (the flywheel routes) and X5 (the Shoot tab) were on their branches. X1 (avatar) was only partly built: a migration, model server tools and the allow-list, with **no handler, no route and no `avatar` job kind**. X2 (research) had `src/marketing/research/*` but no stage-job registration. **U35 (batch lifecycle) had no branch at all.**

For a unit that was not built, this plan gives the body the design calls for (`docs/specs/command-center-design-2026-10-05.md` §3.2–3.4). At run time, check it against `docs/specs/marketing-machine-api.md` at the shipped commit. Where they differ, the contract wins and the run log notes it.

---

## Likely outcome (read before the run)

The plan covers everything, but at the time of writing most of the morning report will read NOT RUN. Agents should expect that and must not cover the gaps from Claude Code.

| Step | Likely result unless the ship adds the missing piece |
|---|---|
| A1 start flywheel | Runs (X3) |
| A2 avatar, A3 research | **NOT RUN, not shipped.** Stage 1 and stage 2 answer 409 `not_built` (`src/marketing/flywheel/stages.mjs` `STAGE_RUNNERS 1:null, 2:null`) |
| A4 offer | Runs (live offer writer) |
| A5 copy, A6 strategy | **Blocked.** No code writes `03-offer.md`, so stage 3 cannot be approved, and stages 4 and 5 stay `blocked` |
| B1–B6 funnel | Runs. Pages are written from the catalog facts only (`sources` null), and the report says so |
| C1–C5 scripts | **NOT RUN, not shipped** unless U35 ships (`start_batch` is not a job kind; `write_now_ready:false`) |
| D screens | Runs for the tabs that shipped. The teleprompter is NOT RUN unless a teleprompter page ships |

---

## 0. How each step is driven (read first)

### There is no way to sign in as the owner without his password. Do not build one.

- `src/auth/magic-link.mjs` signs in client portal accounts only (`createAccountSession`). It cannot sign in staff.
- `src/auth/demo-logins.mjs` only switches seeded demo rows off. It never grants a login, and the owner is not a demo row.
- A staff session only comes from `src/auth/login.mjs` (password), then `src/auth/session.mjs` `createSession`, which writes the `sessions` table. Writing that table is banned for this run.
- The old Blueprint walk minted a session with `createSession` (`ops/workflows/capital-blueprint-build-2026-09-29.md:89`). That is **not** allowed here.

### The driver: run the button's code from the laptop

Each step runs the real button code in a Node process:

- The process runs from a git worktree pinned to the deployed commit: `git worktree add --detach .claude/worktrees/blueprint-test <shipped sha>`. Never switch the main checkout's branch.
- It uses the production `DATABASE_URL` from `.env`, which connects as `fundhub_app` through the pooler.
- **Never run a bare `SET` on the pooler.** Use `BEGIN READ ONLY` for reads that need it.

**Way A (main path).** Import the route's default export (for example `api/marketing/funnels/create.mjs`) and call `handler(req, res, deps)`:

- `req = {method, headers:{}, query, body}`.
- `res` is a small stand-in that records the status and the JSON.
- `deps.requireAuth = async () => OWNER`. `OWNER` comes from one read-only query: `SELECT id, org_id, role, email, name, status FROM staff WHERE lower(email)='chris@fundhub.ai' AND status='active'`. Nothing is written to `sessions` or any auth table.
- `requireRole(...)` and the company check inside the handler still run.
- **Not every route takes `deps.requireAuth`.** P2 checks each route this plan uses. A route that does not take it is driven at module level (Way M below), only when those modules are exactly what the route calls. Otherwise that step is NOT RUN.

**Way M (module level, only where the route has no `deps.requireAuth`).** Call the same functions the route calls, in the same order, with the same inputs. The run log records that the route's own login gate was not exercised for that step. This is used for:

1. **Write offer (A4).** `api/marketing/offer/generate.mjs` calls the imported `requireAuth` directly and gates with `ROLE_SETS.OPS`. A fake `requireAuth` does not reach it, so calling the handler answers 401. X3's `flywheel/run stage:3` imports that handler, so it fails the same way. Drive it as `resolveOfferInputs(body)` (`src/marketing/offer-inputs.mjs`), then `createOfferJob(db,{orgId, staffId, payload:{...inputs, today}})` (`src/marketing/offer-store.mjs:55`), then `runOfferJob(db,{jobId, orgId})` (`src/marketing/offer-run.mjs:26`). `today` is the Arizona date, the same way the handler works it out. The U22 worker never claims `offer`, and the offer's own background function needs a staff session, so the job runs in the runner process.
2. **Funnel page build (B3), fallback only.** See B3.

### Wake adapters: one per route, not one shared `deps.wake`

Three wake shapes exist. Each route gets its own:

| Route(s) | What the route calls | Adapter to inject |
|---|---|---|
| `funnels/create`, `funnels/build`, `funnels/push-live` | `wakeOrFail(db,{job, token: bearerToken(req), env, wake: deps.wake})`. The default wake is `wakeFunnelWorker` (`src/marketing/funnel-transport.mjs`), which POSTs `marketing-funnel-background` **with the owner's session token** | `deps.wake = async () => { await wakeWorker(env); return { ok: true, status: 202, reason: null }; }`. This wakes the shared U22 worker with the worker secret, not a session |
| `batches/write-now` | `(deps.wake ?? wakeWorker)(env)` | `deps.wake = (env) => wakeWorker(env)` |
| X3 flywheel routes | Read the shipped handler for its wake shape at P2 | Match that shape |

Why the funnel adapter matters: with a fake `requireAuth` there is no bearer header. The default wake then answers `ok:false` ("there was no sign-in to start the worker with"), and `wakeOrFail` marks the job **failed** (`src/marketing/funnel-routes.mjs:120-130`). The adapter avoids that. The job is still picked up by the real worker: `funnel` and `funnel_push` are in `JOB_KINDS`, and the U22 worker claims every kind except `offer`.

**Report this:** `src/marketing/funnel-push.mjs`'s header says it runs "never by the clock", but the shared worker will claim it. This test is the first time `funnel_push` runs through the shared worker. Say so in the report. It is not a stop.

`wakeWorker(env)` is in `src/marketing/wake.mjs`. It POSTs `/.netlify/functions/marketing-worker-background` with the `x-fundhub-worker` header. The job then runs on Netlify with Netlify's settings and files, exactly as after a tap. If the wake fails, the 15-minute clock (`src/marketing/clock.mjs`, `*/15`) picks the job up.

### Settings for every runner process

Per the review, the local `.env` has `ADAPTERS_DRY_RUN=0` and `MESSAGING_DRY_RUN=0`. That means **vendors and messaging are LIVE by default** in a local process. A runner that forgets to override them is live.

- Load `.env`, then **force `MESSAGING_DRY_RUN=1` and `ADAPTERS_DRY_RUN=1`**. The runner checks both values at start and exits if either is not `1`.
- The model calls (`src/agents/model.mjs`, `src/marketing/offer-transport.mjs`) use plain `fetch`, not the vendor switch. So Way M model runs work with `ADAPTERS_DRY_RUN=1`. **Never flip it to 0 for a model run.**
- Set `ADAPTERS_DRY_RUN=0` **only** in the one short process that reads the ClickFunnels page list (`listPages()`, read only): the P7 snapshot, B1's free-address check, and the B5 compare. Nothing else runs in that process.
- Set `URL=https://fundhub.ai`.
- The review found `MARKETING_WORKER_SECRET` present and unmasked in the local `.env`, so laptop wakes will fire. P4 re-checks this **by name only**.

### Run log and who the app says did it

- Write one JSONL line per tap (route or module, `request_id`, status, answer, and "gate exercised: yes/no") to `ops/workflows/marketing-machine-2026-10-evidence/blueprint-test/run-log.jsonl`. That folder is gitignored.
- Every row records Chris's staff id as the person who acted (`locked_by`, `requested_by`, `created_by`). The run log is the record of which actions the test did, and the morning report says so.
- Never call `POST marketing/scripts/edit`. It saves voice pairs as if Chris had edited.
- Fix notes start with "Test agent:" and always send `make_rule:false`.

### Tracks (at most 5 agents at once)

| Track | Work | Waits for |
|---|---|---|
| P | Preflight | Ship 1 (pushed to GitHub, CI run for the sha) |
| A | Flywheel A1–A6 | P |
| B | Funnel B1–B2 now, B3–B6 later | P. B3 waits for A5 approved **or** for Track A to be confirmed stopped before A5 |
| C | Scripts C1–C5 | P, B1 (the funnel key `blueprint` must exist), and `write_now_ready:true`. Otherwise NOT RUN |
| D | Screen proof | Ship 2 and each track's last step |

- Fable QA runs as a gate inside each track. QA reads; it never hand-edits a file or row. Every change goes back through a dashboard route (Tweak, Redo, Fix or Reject).
- C does not have to wait for A. The script writer reads `RULES.md`, `VOICE.md`, the recipes, the catalog, the angle list and the funnel's offer facts (`src/marketing/writer-prompt.mjs:5-6`). It does not read the flywheel files. That gap goes on the board as one leftover card.

---

## 1. Goal and pass bar

**Goal.** Build the Capital Blueprint book-a-call funnel from start to finish with the dashboard's own code: avatar, market research, offer, ad copy, ad strategy, then scripts ready to film, then a tracked funnel live at a new address. Then prove every piece.

**It passes when all of these are true:**

1. Each flywheel step that shipped for campaign `capital-blueprint` is done, checked by QA and approved. Its file is in GitHub under `marketing/flywheel/capital-blueprint/`, and the approve's `outbox_id` row has a `committed_sha`.
2. If U35 shipped: six Blueprint scripts are approved. Each has the ad number approve gave back and an angle name. They are in film order in a saved shoot plan. **Take file names wait on Chris's offer word**: X5 prints `take_file_name:null` with a `take_name_problem` sentence for any offer other than SLO. That is the expected pass, not a fail.
3. A new funnel is live at its own new address (`/blueprint`, or `/blueprint-N` if taken). It got its address and tag automatically. All 3 pages carry the tag and the full tracking. `GET marketing/funnels` shows a `tag` on every funnel row.
4. A fake ad click on the live page (test ad number and test click id) is saved with the funnel tag, the ad number and the click id. It is marked `actor='agent'`, so it never counts in the numbers and is never sent to Meta by the server.
5. Every cost comes from the cost ledger (`marketing_model_usage`), and every job stayed under its cap.
6. Nothing else changed: no existing live page, no Meta ad created or turned on, no customer message, no data deleted, no key removed, no existing shoot plan edited or closed (`ops/workflows/marketing-machine-2026-10.md:53`).

**Partial result.** If a unit did not ship, its step reads "NOT RUN, not shipped". It is never run from Claude Code. Steps that depend on it stop, and the report says so.

---

## 2. Inputs (only facts on file)

- **Campaign slug:** `capital-blueprint` (slug rule `src/marketing/offer-inputs.mjs:34-38`).
- **Offer key, two forms:**
  - X3's `flywheel/campaign` takes the **`src/config/offers.mjs` key `UWIQ_DELIVERABLES`**. Sending `capital_blueprint` there answers 400.
  - The funnel builder and script machine use `capital_blueprint` (`src/marketing/offer-facts.mjs:50`, `src/marketing/funnel-paths.mjs:51-52`). It points to `OFFERS.UWIQ_DELIVERABLES` in `src/config/offers.mjs:138-193`.
- **Catalog facts:**
  - Name "Capital Blueprint" (`:140`).
  - List price `priceCents: 500000`, which is $5,000 (`:160`). Floor $1,000 (`:161`) is a closer's discount floor and is never shown in marketing. Max $5,000 (`:162`).
  - Product code `consulting-package` (`:183`). Contract `CAPITAL-BLUEPRINT-AGREEMENT` (`:191`).
  - What the buyer gets, word for word (`:7-14`): Credit Analysis Report, Dispute Letter Pack, Credit Optimization Roadmap, Funding Snapshot, Bank & Lender Match List, How To Use This mini course.
- **Owner range:** $5,000 to $10,000 for 12 months, then a monthly member fee whose amount is not set (`docs/finance/capital-blueprint-build-spec-2026-09-29.md:12`, `:49`, `:105`). Chris's words: "$5k-$10k book-a-call offer" (`ops/workflows/marketing-machine-2026-10.md:39`).
- **Sold on a call:** `book_call:true`. The funnel pages carry no price; the call sets the price (`src/marketing/funnel-copy.mjs:115`, `:144`).
- **Lane:** `uwiq` (`marketing/ads/registry.json` `rules.uwiq.primary_offer = capital_blueprint`; `funnel-paths.mjs:52`). So `utm_campaign=uwiq`.
- **UTM format:** `utm_source=fb&utm_medium=paid&utm_campaign=<lane>&utm_content=<ad number>` (`src/marketing/url-tags.mjs` header).
- **Host and addresses:** host `apply.fundhub.ai` (`funnel-paths.mjs:30`). Pages `/blueprint`, `/blueprint-book`, `/blueprint-thank-you`. If taken, the next free one is `-2`, then `-3`.
- **Calendar:** the booking page frames the existing calendar `https://apply.fundhub.ai/funding-book-call` (`src/marketing/funnel-pages.mjs:26`). It is never changed and never booked in this test.
- **Meta pixel:** `2403674420141513` (`docs/tracking/meta-events.md:3`).
- **Ad numbers:** `registry.json`'s highest id is 83. `91` is the floor inside `approve.mjs`, not a measured next number. The real next number comes from `next_ad_number()` (migration 414, lines 344-354), which takes the highest of `ads.fundhub_ad_number`, `ad_scripts.ad_id` and one more source. **Never call `next_ad_number()` in the test**; it would use up a number. The report prints the numbers approve gave back.
- **Do not touch:** the $297 Roadmap (`capital-blueprint-build-2026-09-29.md:7`), any existing live path (`marketing-machine-2026-10.md:49`), or any existing shoot plan.
- **Never print (not on file):** a $10,000 or any other price on a funnel page, the member fee, any guarantee, any Blueprint testimonial or client result, close rate, cost per customer, or ad budget.
- **Test values:** fbclid `FHTEST_blueprint_<YYYYMMDDHHmm>`. `utm_content` = the first Blueprint ad number from C2, or `91` if C2 did not run. The row is `actor='agent'`, so it is left out of every number either way.
- **Script count:** 6. This is the plan's own choice: one short shoot, under the $40 batch cap. Formats are left to the planner and writer.

---

## 3. Ordered steps

### P. Preflight (Track P, about 20 min, $0). Stop on any failure.

- **P1. Deploy health.** `curl -s "https://fundhub.ai/api/health?cb=$(date +%s)"` must show `ok:true` and `pending:0`. Read the shipped sha from the last row of `ops/ship-log.md`.
- **P2. Units shipped.** At the shipped sha:
  - `netlify/functions/api.mjs` ROUTES has every route used below.
  - For each route used: does the handler take `deps.requireAuth`? Write yes/no per route into the run log. "No" means Way M or NOT RUN (§0).
  - For each route used: what wake shape does it call? Match the adapter table in §0.
  - `src/marketing/job-kinds.mjs` has `funnel`, `funnel_push`, `write_slot`, `fix_script`, and, if shipped, `avatar`, `flywheel_stage`, `start_batch`. Check that merging X3's older `job-kinds.mjs` did not drop X4's `funnel`/`funnel_push` or U24's `write_slot`/`fix_script`.
  - `src/marketing/flywheel/stages.mjs` `STAGE_RUNNERS`: which stages have a runner. `null` means that stage is NOT RUN.
  - Is there any code that writes `03-offer.md` to the outbox (`git grep -n "03-offer" -- src api netlify`, not counting tests and comments)? If none, A5 and A6 are blocked by design (see A4).
  - `src/repo/allow-list.mjs` includes `marketing/flywheel/`.
  - `marketing_settings` has `run_caps`. If X2's migration 429 shipped, read `max_research_cost_usd` (NULL by default).
  - Ship 2 file list: does it ship a teleprompter page and its tab script? What are the real tab hash names in the shipped tab bar? (Needed for D.)
- **P3. Health card.** `GET marketing/health` through Way A:
  - `clock.last_tick_at` is under 20 minutes old.
  - `outbox.token_present` is true and `held_reason` is null. If not, see S10.
  - Record `model.month_cost_usd` and `max_month_cost_usd`.
- **P4. Production settings, by name only.** Present: `ANTHROPIC_API_KEY`, `CLICKFUNNELS_API_KEY`, `MARKETING_WORKER_SECRET`, `GITHUB_REPO_TOKEN`, `META_CAPI_ENABLED=1`. Production `ADAPTERS_DRY_RUN` must be an off value (S12). `META_TEST_EVENT_CODE` must be absent (S8). Locally: confirm by name that `MARKETING_WORKER_SECRET` is present. No value is printed.
- **P5. The X4 tracker is live.** `curl -s "https://fundhub.ai/funnel/fh-events.js?cb=$(date +%s)" | grep -c builtFunnel` is at least 1.
- **P6. Owner row,** read only, as in §0.
- **P7. Baseline at t0** (save to evidence):
  ```sql
  SELECT now() AS t0;
  SELECT coalesce(max(fundhub_ad_number),0) FROM ads;
  SELECT coalesce(max(ad_id::int),0) FROM ad_scripts WHERE ad_id ~ '^[0-9]{1,9}$';
  -- plus the third source next_ad_number() reads (migration 414:344-354), read directly, never through the function
  SELECT key, path, tag, status, kind, active FROM marketing_funnels ORDER BY created_at;
  SELECT count(*) FROM ads;  SELECT count(*) FROM marketing_jobs WHERE kind='meta_load';
  SELECT count(*) FROM client_ad_attribution WHERE landing_path LIKE '/blueprint%';
  SELECT id, status, shoot_date, root_script_ids FROM marketing_shoots WHERE status <> 'done';
  ```
  If the last query returns a row (for example the Oct 3-4 SLO shoot is still open), **C4 is NOT RUN**. Never edit or close that shoot.

  Also save a snapshot of the ClickFunnels page list: `listPages()` from `src/messaging/providers/clickfunnels-pages.mjs`, read only, in the short `ADAPTERS_DRY_RUN=0` process. Keep id, name, `current_path`, url and every timestamp field.
- **P8. Money check.** If month spent + 20 (avatar) + 40 (research) + 1 (offer) + 40 (copy) + 40 (scripts) + 1 (pages) is over $300, run in this order and stop paid work at the cap: C first, then B, then A. Only count steps that shipped.
- **P9. CI.** `gh run list --commit <shipped sha>` is green on lint, tsc, unit and pg. The known climate test may fail (`marketing-machine-2026-10.md:32`). **If there is no CI run for the shipped sha** (for example the sha was never pushed), **stop** (S19). Tests that matter here:
  - `src/http/marketing-funnel-builder.pg.test.mjs`
  - `src/marketing/funnel-{paths,pages,copy,worker}.test.mjs`
  - `src/messaging/providers/clickfunnels-pages.test.mjs`
  - `src/funnel/built-funnel-track.test.mjs`, `src/funnel/track-meta.test.mjs`
  - `src/meta/meta-spec.test.mjs`, `src/messaging/providers/meta-capi.test.mjs`
  - `src/marketing/{worker,clock,writer,api-contract}.test.mjs`
  - The X1, X2, X3, X5 and X8 tests by name, for the units that shipped.

### Track A. The flywheel (Ideas tab, "Offer and market" card)

**A1. Start a flywheel**
- Route: `POST marketing/flywheel/campaign` (X3). Driver: A.
- Body: `{"request_id":"<uuid>","key":"UWIQ_DELIVERABLES"}`.
- Expected **201** `{ok, campaign:"capital-blueprint", offer_key, repo_path, outbox_id, created}`.
- Saves: a `marketing_requests` row and a `repo_outbox` row for `marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md`, which gets `committed_sha` after the drain.
- Cost $0. Time 1 to 2 minutes.
- Proof:
  - `SELECT path, committed_sha, error FROM repo_outbox WHERE id = :outbox_id`
  - `git fetch origin && git show origin/main:marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md`
  - Send the same `request_id` again: same answer, no second row.
- Owner notes stay as the template. The agent writes no words in Chris's voice.

**A2. Build the avatar (stage 1)**
- Route: `POST marketing/flywheel/run`. Body `{"request_id":"<uuid>","campaign":"capital-blueprint","stage":1}`. X3's body is `{request_id, campaign, stage, note?}` only; there are no `service_description`, `market` or `competitors` fields.
- **If stage 1 answers 409 `not_built`, A2 is NOT RUN, not shipped.** That is the expected answer unless X1's handler, route and `avatar` kind land in ship 1.
- If it shipped: X1 job kind `avatar`, 10 saved steps, run by `src/marketing/worker.mjs` on production. Saves a `marketing_jobs` row, `marketing_model_usage` rows with that `job_id`, and outbox rows for `01-avatar.md`, the supporting files and the Sources file.
- Cap: $20 (`run_caps.avatar`), plus at most one step of overshoot (design §5 rule 13). At most 184 searches ($1.84). Time unknown; design worst case is about 3 hours.
- Proof:
  ```sql
  SELECT j.status, j.error, j.attempts, sum(u.cost_usd) usd, count(u.*) calls
  FROM marketing_jobs j LEFT JOIN marketing_model_usage u ON u.job_id=j.id
  WHERE j.kind='avatar' AND j.payload->>'campaign'='capital-blueprint' AND j.created_at>=:t0 GROUP BY 1,2,3;
  ```
  Expect `done` and usd ≤ 20 plus the overshoot. The file is in GitHub.
- QA gate (Fable): every quote has a link; spot-check 10 links (GET returns 200); a thin result says it is thin; no private person's contact details.
- Approve: `POST marketing/flywheel/approve {"request_id":"<uuid>","campaign":"capital-blueprint","stage":1}`. Answer `{ok, campaign, stage, file, outbox_id, already_approved}`. Proof: the `outbox_id` row has a `committed_sha`, and the front matter in GitHub reads `status: approved`.

**A3. Research the market (stage 2)**
- Same route, `stage:2`. **409 `not_built` means NOT RUN, not shipped** (X2 has no stage-job registration yet).
- If it shipped: X2 kind `flywheel_stage`, 5 steps. Saves `02-ad-research.md`; the full evidence stays on the job row. At most 106 searches ($1.06), or 138 with retries.
- **Cap is not settled.** X2's migration 429 adds `max_research_cost_usd`, NULL by default, and the card asks for a stop amount each run.
  - If the route takes a stop amount in the body, send $40.
  - If it needs the amount in `marketing_settings`, A3 is NOT RUN (S17: never change settings).
- Proof: the same query with `kind='flywheel_stage' AND payload->>'stage'='2'`, plus the file in GitHub.
- QA gate: every claim has a link, "treat with caution" and "could not reach" lists are present, counts are printed. Then approve stage 2 as in A2.

**A4. Write the offer (stage 3)**
- Driver: **Way M** (the offer route and `flywheel/run stage:3` both use the real login check, see §0).
- Steps: `resolveOfferInputs({campaign:"capital-blueprint"})`, then `createOfferJob(db,{orgId, staffId:OWNER.id, payload:{...inputs, today}})`, then `runOfferJob(db,{jobId, orgId})`. The inputs fill in avatar and research summaries from `01` and `02` if they exist; if they do not, the offer is written from the catalog facts, and the report says so.
- The run log marks this step "gate exercised: no".
- Saves: a `marketing_jobs` row (kind `offer`, result with the offer and review card).
- Cost: about $0.67 (last measured run, design J3). No per-run cap; the $300 month cap applies. Time about 5 minutes.
- Proof: `getOfferJob` (or `GET marketing/offer/generate?id=<job>` read through Way M) shows `done`, and the cost is in the ledger.
- **Expected stop here.** Per design J3, the offer "writes `marketing_jobs`, not the stage file yet", and P2 found no code that writes `03-offer.md`. So stage 3 cannot be approved, stage 4 (A5) stays `blocked`, and stage 5 (A6) stays `blocked`. Track A stops after A4. This is the expected path, not a surprise. The morning report must not promise copy or strategy.
  - If P2 did find a writer for `03-offer.md`, prove it reached GitHub, approve stage 3 as in A2, and continue to A5.
- QA gate (this one matters):
  - The offer is the Capital Blueprint, not the partner program.
  - The price is $5,000, or stated inside the owner's $5,000–$10,000 range.
  - It never names $1,000 or a member fee amount.
  - Any bonus, guarantee or deliverable that is not in `offers.mjs:7-14` or build spec line 12 goes in the report as "proposed, needs Chris's yes".
  - If it fails: Redo once (a new job through the same Way M steps). A second fail stops Track A (S5).

**A5. Write the copy (stage 4).** Runs only if stage 3 was approved.
- Route: `POST marketing/flywheel/run` `stage:4` (X3's port of `copy.js`). Answers 409 `blocked` until stage 3 is approved; that means NOT RUN.
- Saves `04-copy.md` (top 3 hooks, every piece by angle, the dropped pieces with reasons). The copy checker runs in code.
- Cap: whatever X3 applies (expected $40), inside the month cap. Cost unknown until the first run.
- QA gate: no invented numbers, no "credit repair", Fundhub spelled right, outcome first, no Social Security number talk. Then approve stage 4 as in A2.

**A6. Pick the strategy (stage 5).** Runs only if stages 3 and 4 were approved.
- Same route, `stage:5`, about 9 model calls. Spends no ad money.
- Saves `05-ad-strategy.md`.
- QA gate: it names "creative needed vs on hand" (on hand is 0 videos) and suggests nothing that turns spend on. Then approve stage 5.

### 3.9 Screen proof method (Track D, after ship 2)

- **Snapshot the real answers.** Call these GET handlers through Way A and save each JSON answer to `snapshot.json` in the evidence folder:
  - `marketing/today`, `marketing/health`, `marketing/settings`
  - `marketing/flywheel?campaign=capital-blueprint`
  - `marketing/funnels`, `marketing/funnel?id=`
  - `marketing/scripts?status=locked&batch=`, `marketing/script?id=` (if C ran)
  - `marketing/batches`, `marketing/shoot`
  - `marketing/offer/generate` (read through Way M if the handler does not take `deps.requireAuth`)
- **Load the shipped pages with those answers.** Playwright opens `https://fundhub.ai/app/marketing-command-center.html` with the **tab hash names read from the shipped tab bar at P2**. The names `#ideas`, `#scripts`, `#shoot` are not confirmed; `main`'s page has no tab anchors, and U34, U36 and X8 add `cc-tab-*.js`.
  - `context.addInitScript` sets `localStorage.fh_token` to a dummy string. It is not a real session and it never reaches the server.
  - `context.route('**/api/**')` answers only from `snapshot.json`. Any request that is not in the snapshot, and any non-GET request, is aborted and fails the test.
  - Pattern: `e2e/marketing-command-center.spec.mjs`, `e2e/harness.mjs`.
- **Check the text against the rows.**
  - Funnels card: URL, tag, "Live", events seen.
  - Flywheel card: each stage shows the state the rows show (approved, not built, or blocked).
  - Scripts tab (if C ran): ad numbers with angles.
  - Shoot tab (if C4 ran): film order, `plan_estimated_minutes`, and for each script the `take_name_problem` sentence where `take_file_name` is null.
- **Teleprompter.** Only if ship 2 ships a teleprompter page. Prove only what that page's own code or contract says it does. Do not test a mirror switch or a space-bar step unless the shipped page has them. The only teleprompter in the tree when this was written is `tools/teleprompter/index.html`, a static page fed by `scripts.json`; its README covers words-per-minute scroll, pause and resume, tap a word, drag, and restart. If no teleprompter page ships: NOT RUN, not shipped.
- **Viewports:** 390x844 and 1280x800.
- **Button check.** Tap Push live and Approve on the mocked page. Capture the request bodies and confirm they match what the runner sent: `{request_id,id,confirm_url}` and `{request_id,id,version}`. Abort those requests.
- **Marked shots.** Every screenshot gets red boxes and a legend (CLAUDE.md §8: `_mark-shots.mjs` / `_apply-marks.py`) and goes in the evidence folder.

---

## 4. The funnel (Track B)

**B1. Create the funnel: automatic address and tag** (Ideas > Funnels card, Create)
- Route: `api/marketing/funnels/create.mjs`, which runs `validateCreate`, then `liveTakenPaths` (a read-only ClickFunnels list), then `createBuiltFunnel` and `nextFreePath`.
- Body: `{"request_id":"<uuid>","offer_key":"capital_blueprint","campaign":"capital-blueprint","build":false}`.
- Driver: A, with the funnel wake adapter (§0), in the short `ADAPTERS_DRY_RUN=0` process for the list read.
- Expected 200:
  - `funnel.key` `blueprint`, `path` `/blueprint`, `tag` `fnl-blueprint`
  - `url` `https://apply.fundhub.ai/blueprint`, `utm_campaign` `uwiq`, a `utm_template`
  - `status` `draft`, `active` false
  - three pages: `/blueprint`, `/blueprint-book`, `/blueprint-thank-you`
  - `job:null`
- Cost $0. Time seconds.
- Proof:
  ```sql
  SELECT id,key,path,tag,utm_campaign,lane,campaign,status,active,landing_url FROM marketing_funnels
   WHERE kind='book_a_call' AND offer_key='capital_blueprint';
  SELECT role,position,path FROM marketing_funnel_pages WHERE funnel_id=:fid ORDER BY position;
  ```
- **Every funnel is tagged.** `GET marketing/funnels` (Way A): every row has a non-empty `tag`.
- If the address is not `/blueprint`, report which one was picked and why. That is S7, not a failure.

**B2. Guard checks** (all refusals; nothing changes)
- Same `request_id` again: same body, still one funnel row.
- `POST marketing/funnels/rename {"request_id":"<uuid>","id":"<fid>","path":"roadmap"}` answers 400 `field:"path"` (a reserved address).
- `POST marketing/funnels/push-live {"request_id":"<uuid>","id":"<fid>","confirm_url":"https://apply.fundhub.ai/blueprint"}` answers 400 "Build the pages first".

**B3. Build the pages**
- When: after A5 is approved, **or** as soon as Track A is confirmed stopped before A5 (the expected case). In that case the pages are written from the catalog facts only, and the report says so.
- Route: `api/marketing/funnels/build.mjs`, which queues job kind `funnel`, which runs `src/marketing/funnel-build.mjs`: one Opus call, the copy check, at most 2 rounds (`:52`), then the three pages are drawn.
- Body: `{"request_id":"<uuid>","id":"<fid>"}`.
- **Which driver.** `readCampaignSources` reads only the function bundle, and outbox commits never rebuild the bundle.
  - If no flywheel files were approved, or the shipped bundle already holds the approved `01`, `03` and `04` files: use Way A with the funnel wake adapter. The production worker runs the job.
  - If approved files exist that the bundle does not hold: use the fallback. Call the route through Way A with a wake adapter that does nothing (`ok:true`), then run `funnel-build.run` from the worktree with **`deps.readSources` returning the approved files directly** (read from `origin/main`). The job's `sources` field still records each file's status. Copy the production public tracking ids into the process (`META_PIXEL_ID`, `CLARITY_PROJECT_ID`, `GA_MEASUREMENT_ID`, read with `netlify env:get`) so the pages come out the same as on production. These are public page ids, not secrets.
  - Hold ship 2 for a few minutes if A5's commit is about to land.
- Saves: per page `html`, `html_sha256`, `page_copy`, `built_at`, `build_job_id`. The job result holds `{checks:"passed", rounds, model, cost_usd, sources}`. Plus 1 or 2 `marketing_model_usage` rows.
- Cost: about $0.50. That is a guess from about 20k input tokens and at most 8k output tokens per round, 2 rounds, at `claude-opus-5-5` $4 / $20 per million (`src/marketing/model-prices.mjs:23`). The real number is `result.cost_usd`; the report prints that. The month cap applies.
- Time: up to 6 minutes (`RUN_ESTIMATE_MS`), plus up to 15 minutes if waiting for the clock.
- Proof:
  - `SELECT status,error,result->'sources',result->>'cost_usd' FROM marketing_jobs WHERE kind='funnel' AND payload->>'funnel_id'=:fid`. Report each source's status. Null means the pages were written from the catalog facts only.
  - Run `trackingGaps(html,'fnl-blueprint')` (`src/marketing/funnel-tracking.mjs`) on each saved page: the answer must be `[]`.
  - Preview each saved HTML locally with Playwright `setContent` at 390 and 1280.
- **QA gate (no push on a fail).** Every benefit traces to `offers.mjs:7-14` or an approved `03-offer.md`. No price. No guarantee. No testimonial. No promise of an approval or an amount. "Fundhub" spelled right. Outcome first. If it fails: Redo (`POST funnels/build`) once. A second fail stops Track B before the push (S9).

**B4. Push live** (two taps; the second names the URL)
- Route: `api/marketing/funnels/push-live.mjs`, which queues job kind `funnel_push`, which runs `src/marketing/funnel-push.mjs`:
  - checks the addresses are still free
  - makes NEW custom HTML pages in the order thank-you, booking, landing (`:54`)
  - stops if a page is not on `apply.fundhub.ai/<path>`
  - puts the page token only into its own pages
  - checks each page live with a cache-busted read, 4 tries 15 seconds apart (`:55-56`)
  - marks the funnel live and queues the three repo saves.
- Body: `{"request_id":"<uuid>","id":"<fid>","confirm_url":"https://apply.fundhub.ai/blueprint"}`.
- Driver: Way A with the funnel wake adapter **only**. The push runs on the production worker with production's ClickFunnels key and production's vendor switch. It is never run from the laptop.
- Report: first run of `funnel_push` through the shared worker (§0).
- Saves:
  - Pages: `cf_page_id`, `cf_public_id`, `live_url`, `pushed_at`, `sent_sha256`, `proved_at`, and `proof {status:200, has_tag:true, gaps:[]}`.
  - Funnel: `status` live, `live_at`, `active` true.
  - `repo_outbox` rows `funnel-page-live-<page id>` for `marketing/landing-pages/funnels/blueprint/{landing,booking,thank-you}.html`.
- Cost $0. Time about 3 minutes, plus the clock wait.
- Proof:
  ```sql
  SELECT role,path,cf_page_id,live_url,proved_at,proof->>'status',proof->'gaps' FROM marketing_funnel_pages WHERE funnel_id=:fid ORDER BY position;
  SELECT path,committed_sha,error FROM repo_outbox WHERE op_id LIKE 'funnel-page-live-%';
  ```
- **After live, more refusals:** `POST funnels/build` answers 400 ("is on ClickFunnels") and `POST funnels/rename` answers 400 (live).

**B5. Live GET proof** (cache-busted; ClickFunnels serves stale HTML right after a push)
```bash
for p in blueprint blueprint-book blueprint-thank-you; do
  curl -s -A "Fundhub-Blueprint-Test/1.0" -H 'cache-control: no-cache' \
   "https://apply.fundhub.ai/$p?fh_cb=$(date +%s%N)" -o "$EVID/$p.html" -w "$p %{http_code}\n"; done
```
Expect 200 on all three. Each page must contain:

| # | Must be in the page |
|---|---|
| 1 | `<meta name="fh-funnel-tag" content="fnl-blueprint">` |
| 2 | `window.FH_FUNNEL=` with its own `"path"` and `"step"` |
| 3 | `connect.facebook.net/en_US/fbevents.js` |
| 4 | `fbq('init', '2403674420141513')` |
| 5 | `fbq('track', 'PageView', {}, {eventID: window.__fhPv})` |
| 6 | `https://fundhub.ai/funnel/fh-attribution.js` |
| 7 | `https://fundhub.ai/funnel/fh-events.js` |
| 8 | `sdk.myclickfunnels.com/sdk.js` and `name="cf-page-token"` |

Optional, not counted toward the pass: `https://fundhub.ai/js/clarity.js` (only if `CLARITY_PROJECT_ID` was set where the page was drawn) and `googletagmanager.com/gtag/js?id=G-` (only if the GA4 id was set there). Report them as present or absent.

The booking page must also frame `https://apply.fundhub.ai/funding-book-call`.

**No other page changed.** Read the ClickFunnels page list again (short `ADAPTERS_DRY_RUN=0` process) and compare it with the P7 snapshot. Only our three new `cf_page_id` rows may be new. Every other row must match field for field.

**B6. Tracking proof** (Playwright on the live page; nothing reaches Meta)
- **Block outside trackers.** `context.route` aborts `connect.facebook.net`, `www.facebook.com/tr`, `*.clarity.ms`, `googletagmanager.com` and `google-analytics.com`, in frames too. **This block is what keeps the browser's PageView from reaching Meta. It is a guarantee of the test harness, not of the product.** The report says so plainly. Without the block, the run does not count.
- **Open:** `https://apply.fundhub.ai/blueprint?utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content=<ad#>&fbclid=FHTEST_blueprint_<ts>&fh_cb=<ts>`.
- **Capture** the POST to `https://fundhub.ai/api/public/slo-interest`. Its body must have `kind:"track"`, `event:"page_view"`, `page:"/blueprint"`, `funnel_tag:"fnl-blueprint"`, the four UTMs, `fbclid`, `fbc:"fb.1.<ms>.FHTEST…"` and `webdriver:true`. The answer must be `{ok:true, actor:"agent", saved:true}`.
- **Pixel calls.** `window.fbq.queue` holds only the inline head `init` and `PageView` calls. `fh-events.js`'s `fire()` never calls `fbq` when `navigator.webdriver` is true, so no other pixel calls appear. Seeing exactly those two proves the pixel code on the page ran.
- **Click the CTA** to `/blueprint-book`. The UTMs carry over through `data-fh-next`. The calendar frame loads. **No booking is made.** Then open `/blueprint-thank-you`.
- **Proof in the database** (`sid` = `sessionStorage.fh_sid`):
  ```sql
  SELECT name, payload->>'page', payload->>'funnel_tag', payload->>'funnel_id', payload->'attribution',
         payload->>'fbc', payload->>'actor', payload->>'actor_reason', (payload ? 'meta') AS meta_sent
  FROM events WHERE name LIKE 'funnel.%' AND payload->>'session_id'=:sid ORDER BY created_at;
  SELECT path, events_seen, last_event_at FROM marketing_funnel_pages WHERE funnel_id=:fid;
  ```
  - Three `funnel.page` rows with the tag and the funnel id. The calendar frame's own `/funding-book-call` row has no tag; that is expected.
  - `attribution.utm_content=<ad#>`, `fbclid=FHTEST…`, `actor='agent'`, `actor_reason='automated_browser'`, `meta_sent=false` (the server sent nothing to Meta).
  - `events_seen` went up by at least 1 on each page.
  - The visit does not count: `GET marketing/funnels/stats` still shows 0 page views for `blueprint`, because it only counts `actor='person'`.
- **Meta server event with a test code: dropped from this run.** `sendMetaEvents` needs `db` and a `scope` for the stored token, plus `META_CAPI_ENABLED="1"` in the process, and no test code is on file. The server event's shape is proven by CI only (`src/meta/meta-spec.test.mjs`, `src/funnel/track-meta.test.mjs`). Never set `META_TEST_EVENT_CODE` on Netlify; it would mark every real visitor's event as a test.

---

## 5. Ready to film (Track C)

**Gate.** Track C runs only if U35 shipped: `start_batch` is in `JOB_KINDS` and `GET marketing/batches` answers `write_now_ready:true`. When this was written there was no U35 branch, so the likely morning result is "NOT RUN, not shipped". A write-now tap while `write_now_ready` is false would leave a job sitting queued; do not tap it (S11).

**C1. Write now** (Scripts tab)
- Route: `api/marketing/batches/write-now.mjs`, which runs `startWriteNow` (`src/marketing/ideas-store.mjs:345`). That queues `start_batch` (U35), which fans out to `write_slot` jobs (`src/marketing/writer.mjs`, up to 3 at once).
- Body: `{"request_id":"<uuid>","count":6,"funnel_key":"blueprint"}`.
- Driver: A, with the write-now wake adapter `(env) => wakeWorker(env)`.
- Saves: a `marketing_batches` row (`on_command`, then released), 6 `ad_scripts` drafts (`funnel_key` blueprint, `lane` uwiq, `check_results`, `flagged`), and ledger rows.
- Cap: $40 per batch (`max_batch_cost_usd`, migration 410), and the $300 month cap.
- Time: under 10 minutes (design J8).
- Proof:
  ```sql
  SELECT status,total,ready,flagged,failed,error FROM marketing_batches WHERE id=:batch;
  SELECT id,root_script_id,version,status,title,script_format,flagged FROM ad_scripts WHERE batch_id=:batch;
  ```

**C2. QA, then approve each draft** (one Approve per script)
- QA (Fable) reads `body`, `parts` and `check_results`. It checks: no price except as the offer facts allow, no invented numbers, no Social Security number, no guarantee, the call to action goes to the book-a-call funnel, Fundhub spelled right.
- If a draft fails: Fix once, `POST marketing/scripts/fix {"request_id","id","version","note":"Test agent: …","make_rule":false}` (job kind `fix_script`, about the cost of one script). If it fails again, reject it with a reason. Never use Edit.
- Approve: `POST marketing/scripts/approve {"request_id":"<uuid>","id":"<script id>","version":<n>}`. It answers 200 with `ad_number` and `registry:"queued"`. The number is whatever approve gives back; 91 is only its floor.
- Proof: `SELECT ad_id,title,status,locked_at,repo_path,repo_commit FROM ad_scripts WHERE batch_id=:batch AND status='locked'`. The numbers run in a row with no gaps and no repeats, and the first one is higher than every number in the P7 baseline. The outbox rows for the script files and the `registry.json` edit get committed.

**C3. Film order**
- `POST marketing/scripts/order {"request_id":"<uuid>","order":["<root_script_id>", …]}`, in approval order.
- Proof: `film_order` is 1 to n.

**C4. Save the shoot plan** (Shoot tab, X5)
- **Only if P7 found no open shoot.** If one is open, C4 is NOT RUN, and the report says why. Never send the change form `{id, root_script_ids}` and never send `status:'done'` for a shoot this test did not create.
- `POST marketing/shoot {"request_id":"<uuid>","root_script_ids":[…in film order],"shoot_date":"2026-10-06"}`. Today's Arizona date is also the table's default.
- Expected 200 `{shoot}` with `status` planned and `root_script_ids` in order. A 400 here means a shoot was opened after P7; stop C4 and report it.
- If X5 ships in ship 2, C4 waits for it.

**C5. Ready-to-film proof**
- `GET marketing/shoot` answers `{shoot, plan_candidates, plan_estimated_minutes, past_shoots, wpm, as_of}`. Each script has `angle_name`, `offer_word`, `take_no`, `take_file_name`, `take_name_problem`, `read_seconds`, `words`.
- **Expected for the Blueprint:** `offer_word:null`, `take_file_name:null`, and `take_name_problem` reads "The Capital Blueprint offer has no file-name word yet…". X5 only knows the word `SLO`. `marketing/ads/NAMING.md:77` says a new offer uses its own word, and picking it is Chris's call. That is the pass, not a fail. It goes in the report as "take names wait on your offer word". It does not block anything: ads are identified by number (CLAUDE.md §3c).
- Check: `angle_name` matches the script `title`, `read_seconds` and `plan_estimated_minutes` are filled in, and the order matches C3.
- The teleprompter is proven in D only if a teleprompter page shipped (§3.9).

---

## 6. Morning report for Chris (4th grade, with links)

Every line below is a template. Keep a line only if that step passed. Put in the real numbers from the run. For a step that did not run, write one line: "Not done yet: <step>. <one-line reason>."

> **Blueprint test: done** (or: done except …)
>
> - How we ran it: Nothing was clicked on the web page itself. We ran the same code the buttons run, from the laptop, with your sign-in skipped. We did not type your password.
> - Your Blueprint funnel is live: https://apply.fundhub.ai/blueprint *(if B4 passed)*
> - It has 3 pages. Each page has a label so we know which ads sent people. Each page has Facebook's counter and our 2 trackers. *(if B5 passed)*
> - The pages were written from the Blueprint's list of what you get. They were not written from new research yet. *(if B3 ran with no sources)*
> - We sent 1 fake ad click. It saved the label, the ad number and the click id. It was marked as a test. So it is not in your numbers. Facebook did not get it. *(if B6 passed)*
> - 6 Blueprint scripts are approved: Ads N to N. They are in film order. https://fundhub.ai/app/marketing-command-center.html *(if C2 passed)*
> - Your shoot plan is saved. About N minutes. *(if C4 passed)*
> - The take names need one word from you for this offer. Like "SLO" is for the Roadmap. *(if C5 ran)*
> - The offer is written. *(if A4 passed)* The avatar and research are done: https://github.com/ZootimusMaximusSupreme/fundhub-platform/tree/main/marketing/flywheel/capital-blueprint *(only the stages that passed)*
> - AI cost tonight: $X. This month: $Y of $300.
> - Safe: no old page changed. No Facebook ad made or turned on. No customer got a message. Nothing deleted. No key removed. Your old shoot plan was not touched.
> - Note: the app shows your name on the approvals. A helper did the taps for you. The run log lists each one.
> - Did not work: one line each, or "nothing".
> - Your taps: 1) Read the scripts. Fix or reject any. 2) Say yes or no on any offer idea marked "needs your yes". 3) Pick the file-name word for this offer. 4) Want the funnel down? Say so.
> - The marked pictures are here: <link from the main session>

---

## 7. Rollback (nothing is deleted)

- **A1–A6 files and approvals.** They stay in git. To change one, use Tweak or Redo on that row; later steps then show "out of date". No deletes and no force-push. A revert happens only if Chris asks, as a normal commit.
- **A4 offer job.** The row stays. Redo makes a new run.
- **B1 draft funnel.** It stays a draft with `active=false`, so no traffic and no ads reach it. Rename is allowed while it is a draft. There is no delete route.
- **B3 pages.** While it is a draft, `POST funnels/build` writes them again.
- **B4 live funnel.**
  - The database never lets it go back to draft or move (migration 425 lines 127 and 237).
  - The push code never deletes or archives a page.
  - Default: leave it up. It is a new, unlinked address with no ad pointing to it.
  - Taking it down is Chris's call, because it removes a live page. If he says yes, an agent checks developers.myclickfunnels.com for an archive or delete call (no guessed endpoints). It acts only on the three saved `cf_page_id` values and writes the change in the ops notes.
- **B6 test events.** The `actor='agent'` rows stay. They are already left out of every number.
- **C1–C2 scripts.** A draft can be rejected. An approved script cannot be un-approved: its number is used up, and Reject keeps the row as `rejected`. Registry entries stay.
- **C3.** Re-order with `POST scripts/order`.
- **C4.** Only for a shoot **this test created**: leave it planned, or close it with `POST marketing/shoot {"id","status":"done"}` if Chris asks. Never touch a shoot the test did not create.

---

## 8. Risks and stop rules

**Stop rules:**
- **S1. A page we did not make changes.** The ClickFunnels list differs outside our three ids, or anything is sent to an id we did not make. Stop all tracks.
- **S2. A Meta ad is involved.** Any `meta_load` job after t0, any new `ads` row we caused, or any ad status change. Stop all tracks.
- **S3. Someone could get a message.** The test session shows a booking or contact event, or a new `client_ad_attribution` row with `landing_path LIKE '/blueprint%'`. Stop.
- **S4. Money cap.** A job hits its cap: that track stops, and caps are never raised by an agent. Month spent plus the next cap would go past $300: do not start that step.
- **S5. Same step fails twice** (CLAUDE.md §8 stuck rule). Stop that track and report what was tried.
- **S6. Wrong host.** ClickFunnels answers a host other than `apply.fundhub.ai`. The push stops by itself and the funnel stays a draft. Do not retry. The domain is Chris's call.
- **S7. Address taken.** The URL system picks `/blueprint-N`. Report it; not a failure.
- **S8. `META_TEST_EVENT_CODE` is set on production.** Stop and report. Do not unset it (no key removal).
- **S9. Funnel QA fails twice.** No push.
- **S10. Outbox held** (`no_token` or `dry_run`). Track A continues with saves pending. B3 then builds from the catalog facts only. Report it.
- **S11. A route or job kind is missing, a stage answers `not_built` or `blocked`, or `write_now_ready` is false.** That step is NOT RUN. Never run it from Claude Code.
- **S12. Production `ADAPTERS_DRY_RUN` is on.** No push. Do not get around it by pushing from the laptop.
- **S13. Wall clock.** Avatar still running after 4 hours, or any other job after 2 hours: stop that track and report.
- **S14. Health.** `/api/health` is not ok, or `pending` is above 0: no writes.
- **S15. Auth.** No password typed, no session minted, no auth table written.
- **S16. No ship while a `funnel_push` job is running.** At most two ships today.
- **S17. No Clarity export pull. Never `POST scripts/edit`. Never change `marketing_settings`.**
- **S18. GitHub.** The outbox commits to `origin/main` on GitHub. Local `main` was about 60 commits ahead, and the 2026-10-05 push failed (403). Before any ship pushes, it fetches `origin/main` and merges it in. `scripts/github-push-whole-repo.mjs` pushes `main` with `--force-with-lease`; it must never overwrite outbox commits. If a push would drop a commit that is on `origin/main`, stop.
- **S19. No CI run for the shipped sha.** Stop at P9. Do not test an unchecked build.
- **S20. Runner safety switches.** A runner process that starts without `MESSAGING_DRY_RUN=1` and `ADAPTERS_DRY_RUN=1` (except the short page-list read) exits before any call.
- **S21. Existing shoot.** Never edit or close a shoot plan the test did not create.

**Risks:**
- **Attribution.** The app records Chris's staff id for test actions. The run log is the record.
- **Login gate not exercised for the offer.** A4 runs at module level, so its own login and role check are not tested in this run. The run log marks it.
- **Shared worker runs the push.** First time `funnel_push` runs through the U22 worker, not its own background function. Its header comment says otherwise.
- **Bundle lag.** Outbox commits never rebuild the function bundle, so B3 may need the fallback. The job's `sources` field shows what the pages were written from.
- **Offer drift.** The offer writer may propose things that are not on file. The QA gates catch them, and they are never pushed as fact.
- **The flywheel does not feed scripts.** The script writer does not read the flywheel files (leftover card).
- **No `03-offer.md` writer.** Copy and strategy cannot run after the offer until something writes that file (leftover card, not fixed here).
- **A ship mid-run.** Saved steps can be retried, but avoid shipping during paid steps.
- **Local vs Netlify settings.** The B3 fallback could draw pages with different settings. Copy only the public tracking ids; never copy secrets into code.

Files to know: `src/marketing/funnel-{routes,store,build,push,paths,tracking,worker,transport}.mjs`, `src/messaging/providers/clickfunnels-pages.mjs`, `db/migrations/425_marketing_funnel_builder.sql`, `src/funnel/track.mjs`, `src/marketing/{worker,clock,wake,ideas-store,writer,offer-run,offer-store,offer-inputs}.mjs`, `src/marketing/flywheel/stages.mjs`, `api/marketing/offer/generate.mjs`, `docs/specs/command-center-design-2026-10-05.md`, `docs/specs/marketing-machine-api.md`. The X4 funnel code exists only on branches `mm-wave2a` and `mm-x4-funnel-builder` at the time of writing.
