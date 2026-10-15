# Batch 09 manifest (finish the 853, 2026-10-14)

Branch `fin/b09`, worktree `.claude/worktrees/fin-b09`, built from `fin/base` (2f4f574a0). Generation 1 attached 37 rows; generation 2 challenged the 3 left over and (re-run, last section) attached one of them as a live check. Not pushed, not merged.
Tier 4, lane `gap-catalog-display`, 40 rows. All 40 are staff-only or no-impact screen controls on three staff pages and
three public pages.

## The numbers

| | |
|---|---|
| Batch rows open before (count script, offline, on `fin/base`) | 40 |
| Batch rows open after | 2 |
| Whole count before / after (all four lanes) | 853 / 815 (display lane 680 / 642) |
| practice-test | 37 |
| live-check | 1 (the lead list's Reset my edits button, last section) |
| na-verified | 0 |
| not-attachable | 2 |

## Why 39 rows are not saved-result checks

(The one live check of this batch reads the live page, not a table: see the last section.)

A saved-result contract (`DISPLAY_RESULT_CONTRACTS`) only reaches a row through `compileDisplayRuntimeData`, and that only
builds result cases for rows whose impact is money, customerData or customerMessage (`needsDeepDisplayResult`). All 40 rows
here are `staffOnly` or `none`. Past that gate there is also nothing a query could judge for most of them:
- Most of them (every filter, rail, select, pager, fold, copy button, Presets, Reset, Use text, drawer close, New drill, Revert, the download) leave no saved trace at all.
- The colour, face, ramp and name rows write `org_brand` / `partner_brand`, and the database already refuses a bad value
  there with CHECK constraints (hex colours, six-stop ramp, font names; `043_partner_brand.sql`, `128_org_brand.sql`). A query
  on those columns cannot go red.
- The agent identity rows write `agents`, where name is NOT NULL and class and channel carry CHECKs (`037_agent_registry.sql`);
  the owner is free text.
I did not change the compiler to force a query through. Every row here is a page that sends a request or paints words, and the
bug a customer could hit is "the page painted it and never sent it", which a database query cannot see.

## What each practice test is

A real page in Chromium (the S4 harness, `s4-screen-harness.mjs`), fake `/api` answers, one control pressed, and a judgement of the
exact request the page sends and the words it paints. Expected rows are worked out in the test from the fake data, not copied
from the page. Each row is claimed only inside the callback that asserts it (`fin-b09-kit.mjs`), an empty callback is refused,
and a last test fails the file if a listed row never ran. Nothing reads live data. No secret-shaped string is built.

## Every row

| Surface | Control | Outcome | Test file | What it judges |
|---|---|---|---|---|
| agent-editor.html | + New agent button | practice-test | `fin-b09-agent-editor.test.mjs` | asks for a name, trims it, sends create with channel internal and class client_facing, selects the new agent; cancel or blank sends nothing |
| agent-editor.html | Agent list row (click to open an agent, confirm discard of unsaved edits) | not-attachable | `fin-b09-agent-editor.test.mjs` | NOT ATTACHED. Click and question work; the discard does not discard (product finding 1) |
| agent-editor.html | Closer drill: New drill button | practice-test | `fin-b09-agent-editor.test.mjs` | clears the turns, sends nothing; the next line starts with empty history |
| agent-editor.html | Closer drill: Send button and Enter key (OP-06 only) | practice-test | `fin-b09-agent-editor.test.mjs` | Send and Enter send the typed line with the earlier turns; Shift+Enter and a blank line send nothing; no drill card on other agents |
| agent-editor.html | Details/section toggles (Identity, Trigger events, Prompt, Escalation, Shadow log) | practice-test | `fin-b09-agent-editor.test.mjs` | each of the five opens and closes alone; picking another agent refolds them all |
| agent-editor.html | Identity: Agent name input | practice-test | `fin-b09-agent-editor.test.mjs` | typed (trimmed) name is the saved name and shows in the list before saving |
| agent-editor.html | Identity: Class select (Client-facing, Ops) | practice-test | `fin-b09-agent-editor.test.mjs` | saved as client_facing or ops; the list regroups |
| agent-editor.html | Identity: Owner select | practice-test | `fin-b09-agent-editor.test.mjs` | options are the staff names; the chosen one is saved as owner_label |
| agent-editor.html | Revert button | practice-test | `fin-b09-agent-editor.test.mjs` | restores name, class and owner to the last saved agent, sends nothing; after a save it returns to that save |
| brand-studio.html | Accent ramp: six colour pickers | practice-test | `fin-b09-brand-studio.test.mjs` | each picker is its own stop in the saved ramp and in the preview strip |
| brand-studio.html | Brand name input | practice-test | `fin-b09-brand-studio.test.mjs` | wordmark text, Brand tile and saved entity_name (legal entity wins when typed) |
| brand-studio.html | Copy history: page select and section select | practice-test | `fin-b09-brand-studio.test.mjs` | page select lists pages, section select lists only unlocked blocks, each pick re-reads with page_id (and section_id only when one is picked) |
| brand-studio.html | Display face select | practice-test | `fin-b09-brand-studio.test.mjs` | chosen Google font loads and is the saved display_face |
| brand-studio.html | DNS table copy buttons: CNAME, ALIAS/A, TXT | practice-test | `fin-b09-brand-studio.test.mjs` | each copies its own value (TXT is the partner's verify string) and says copied |
| brand-studio.html | Generation: Turn off (owner) | practice-test | `fin-b09-brand-studio.test.mjs` | sends enabled:false for this partner, page shows Off; refusal keeps On; only the owner sees the button |
| brand-studio.html | Ink colour picker and hex input | practice-test | `fin-b09-brand-studio.test.mjs` | picker fills the hex box, a valid hex moves the picker, a bad hex is put back, Save sends it |
| brand-studio.html | Mono face select | practice-test | `fin-b09-brand-studio.test.mjs` | chosen Google font loads and is the saved mono_face |
| brand-studio.html | Paper colour picker and hex input | practice-test | `fin-b09-brand-studio.test.mjs` | same as ink, for the paper colour |
| brand-studio.html | Presets button (cycle six ramps) | practice-test | `fin-b09-brand-studio.test.mjs` | six different ramps, the sixth press returns to the start; the saved ramp is the one on screen |
| brand-studio.html | Reset button (discard unsaved local edits, confirm dialog) | practice-test | `fin-b09-brand-studio.test.mjs` | No changes nothing; Yes drops the stored draft and reloads; never writes to the server |
| brand-studio.html | Use text button (clear wordmark) | practice-test | `fin-b09-brand-studio.test.mjs` | picture goes, the name is the wordmark again, button disabled with no wordmark, Save sends no wordmark_url |
| button:climate/index.html#Click a state: shows its sco | Click a state: shows its score and a plain sentence (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md) | not-attachable |  | shipped page shows score, band and trend but no plain sentence (see reason) |
| button:contract.html#dlBtn | Download a copy of the signed document. | practice-test | `fin-b09-contract-download.test.mjs` | asks for the file on the same signed link, saves it under the server's file name with the exact bytes; failure says so; hidden until everyone has signed |
| button:leads/<32-hex>/index.html#reset | Button 'Reset my edits' | live-check | `src/pulse/coverage/fin-b09-leads-reset.mjs`, run by the display lane; judge tested in `fin-b09-leads-reset.test.mjs` | one GET of the live private lead page (address from the registry): one button that says Reset my edits, a click handler on it that asks first and stops on No, empties the saved edits, writes that to the browser's storage, redraws, and the page loads back the same storage key. Red on any break or a page that is gone; skip when the read fails |
| campaign-manager.html | Action log Rule select (scale winner, cost per sale too high, kill switch, and 5 more) | practice-test | `fin-b09-campaign-manager.test.mjs` | every rule keeps only its own actions; a rule with nothing under it says so in words |
| campaign-manager.html | Action log state rail (all, agent, human, revertible, failed) | practice-test | `fin-b09-campaign-manager.test.mjs` | agent, human, revertible and failed each keep exactly their own actions; counts match |
| campaign-manager.html | Action log Target select (campaign, ad_set, ad, creative_asset, connection, social_post, autopilot) | practice-test | `fin-b09-campaign-manager.test.mjs` | keeps only that kind of target, and holds together with the state rail |
| campaign-manager.html | Ad performance group-by rail (lane, ad_id, variant, gate, entry, primary_offer, secondary_offer) | practice-test | `fin-b09-campaign-manager.test.mjs` | each of the seven picks asks the server for that group_by and shows that answer |
| campaign-manager.html | Angle/hook group-by rail (angle, hook, lane, offer, script_type) | practice-test | `fin-b09-campaign-manager.test.mjs` | each of the five picks asks for that group_by and keeps the window |
| campaign-manager.html | Angle/hook Window select (7, 14, 30, 90 days) | practice-test | `fin-b09-campaign-manager.test.mjs` | 7, 14, 30, 90 days: each pick re-reads with that days and keeps the grouping |
| campaign-manager.html | Campaign approval-state rail (all, draft, awaiting_approval, approved, live, paused, archived) | practice-test | `fin-b09-campaign-manager.test.mjs` | each state shows its own campaigns, marks itself on, counts match |
| campaign-manager.html | Campaign Limit select (10, 25, 50, 200) | practice-test | `fin-b09-campaign-manager.test.mjs` | 10, 25, 50, 200 set the page size |
| campaign-manager.html | Campaign Offer select (all, funding, credit cards, credit repair) | practice-test | `fin-b09-campaign-manager.test.mjs` | narrows by offer, and holds together with the platform pick |
| campaign-manager.html | Campaign pager (prev, next) | practice-test | `fin-b09-campaign-manager.test.mjs` | next and previous walk pages with no gap or overlap; ends are disabled; a new filter starts at page 1 |
| campaign-manager.html | Campaign Platform select (all, meta, tiktok, google) | practice-test | `fin-b09-campaign-manager.test.mjs` | narrows by platform, and holds together with a state pick |
| campaign-manager.html | Campaign row click (opens detail drawer) | practice-test | `fin-b09-campaign-manager.test.mjs` | opens the drawer on that campaign and reads its detail (30 days, this partner); Enter does the same |
| campaign-manager.html | Connect ClickFunnels: API key input, Subdomain input, Connect button | practice-test | `fin-b09-campaign-manager.test.mjs` | needs both boxes, sends them trimmed, clears the key, then syncs; a refusal keeps the key and shows the server's words |
| campaign-manager.html | Connections state rail (all, pending, active, expired, revoked, needs_verification) | practice-test | `fin-b09-campaign-manager.test.mjs` | each state shows only its connections; counts match |
| campaign-manager.html | Drawer: close (✕, scrim click, Escape key) | practice-test | `fin-b09-campaign-manager.test.mjs` | the X, the scrim and Escape each shut it |
| campaign-manager.html | Drawer: Days select (7, 14, 30, 90, 180) | practice-test | `fin-b09-campaign-manager.test.mjs` | 7, 14, 30, 90, 180: each pick re-reads that campaign for that many days and stays selected |

## The rows left NOT_PROVED, with the exact reason (two; the third was attached in the re-run, last section)

1. **agent-editor.html: Agent list row (click to open an agent, confirm discard of unsaved edits).** The click and the question work
   and are exercised. The discard does not discard: after Yes, the typed words stay on that agent in memory, and going back to it
   shows them again with the unsaved mark gone (the list also keeps the typed name). The row's words promise a discard, so it
   is not attached. `fin-b09-rows.test.mjs` reads the page source and goes red the day the click restores the saved copy.
2. **climate/index.html: Click a state: shows its score and a plain sentence.** The shipped `/climate/` page is the bundled Lending
   Climate dashboard. A state click opens a panel with the score, band and trend, and no plain sentence about the wider picture.
   The lead-magnet page the journey describes (headline, state card with that sentence, four questions) is not what ships
   (same as S4 finding 2). `fin-b09-rows.test.mjs` goes red if the shipped bundle gains the sentence.
3. ~~leads/<32-hex>/index.html: Button 'Reset my edits'.~~ Generation 1 and 2 said there was no file in the repo to open, and that
   was true for a practice test. It is not true for a live check: the registry names the page's address and the morning pulse
   already reads that address. Attached as a live check in the re-run (last section).

## Files added

- `src/pulse/catalog/proofs/fin-b09-kit.mjs` (row tracker, shared browser, dialog helper)
- `src/pulse/catalog/proofs/fin-b09-rows.json` (the row table: control rows per test file, plus `notAttached`)
- `src/pulse/catalog/proofs/fin-b09-display-proofs.mjs` (the 37 proof cases)
- `src/pulse/catalog/proofs/fin-b09-not-attachable.mjs` (the 3 reasons, as data)
- `src/pulse/catalog/proofs/fin-b09-rows.test.mjs` (guard: exact map rows, no live site, the reasons still true)
- `src/pulse/catalog/proofs/fin-b09-agent-editor.test.mjs` (12 tests)
- `src/pulse/catalog/proofs/fin-b09-brand-studio.test.mjs` (15 tests)
- `src/pulse/catalog/proofs/fin-b09-campaign-manager.test.mjs` (15 tests)
- `src/pulse/catalog/proofs/fin-b09-contract-download.test.mjs` (4 tests)
- `src/pulse/catalog/proofs/fin-b09-g2-findings.test.mjs` (generation 2: tests that run the real pages and pin the findings that have a page to run; 3 tests after the re-run)
- `src/pulse/coverage/fin-b09-leads-reset.mjs` (re-run: the judge of the live lead page's Reset button, no network call of its own)
- `src/pulse/coverage/fin-b09-leads-reset.test.mjs` (re-run: 13 tests)
- `ops/workflows/finish-853-2026-10-14/manifest-b09.md` (this file)

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line (`FIN_B09_DISPLAY_PROOF_CASES`) and 1 spread line `...FIN_B09_DISPLAY_PROOF_CASES,` at the end of the plugin list |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | the display red count 672 to 635 (my decrease is 37; if other batches also lower it, add the decreases together and use the number the test prints) |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog` (expect a conflict; re-run it after merging and take its output). The re-run changed nothing in it |
| `src/pulse/coverage/gap-catalog-display.mjs` | (re-run) 1 import line (`leadsResetResults`); a new function `livePageReader(ctx)` (one GET: no body, redirects not followed, 5 second limit, never throws); 2 lines at the top of `gapChecks`/`judge`: `const leadsReset = await leadsResetResults(DISPLAY_TRACKING_CASES, livePageReader(ctx), ctx.registry);` and `if (leadsReset.has(entry.id)) return leadsReset.get(entry.id);`. The same shape as the batch 01, 06, 07, 19 and 21 hooks. Batch 07 also GETs this page (see risks) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | (re-run) 1 import line (`leadsResetFor`) and one clause `&& !leadsResetFor(entry)` in the filter that lists rows expected to stay NOT_PROVED, as batch 01 and 21 did for their own rows |

No product file, no `e2e/` file, no migration, no journey file was changed. No other shared list was touched.
(The re-run also edited three files of this batch: `fin-b09-not-attachable.mjs` lost the leads row, `fin-b09-rows.test.mjs` now
expects 2 left-out rows, and `fin-b09-g2-findings.test.mjs` got the third test.)

## Product findings (not fixed)

1. Agent Editor: the "Discard them?" question on the agent list does not discard (see row 1 above). Cost, pinned in the re-run:
   after Yes, the next Save on that agent sends the words that were meant to be dropped (`fin-b09-g2-findings.test.mjs`, second test).
2. Campaign Manager drawer: pick a Days value before the first detail answer has painted and the page only redraws. It never re-reads,
   and when the first answer lands the heading says "last 7 days" over the 30 day numbers. (Seen as a stalled read in this batch's
   Days test; the test now waits for the first paint.)
3. Brand Studio and Agent Editor: nothing new beyond the S2/S4 findings about the owner and "escalate to" person being blanked when
   the staff list answers after the agent list. The tests serve the agent list after the people lists so they stay steady.

## Break checks (each break made in the page file, the test run red, the file put back with git checkout)

- **agent-editor.html**: 26 breaks, 25 red, 1 not counted (see below).
  new agent: channel fixed to sms; new agent: name not trimmed; new agent: blank name allowed; new agent: not selected after create; new agent: class fixed to ops; list row: always switches (no question); list row: answer ignored; list row: opens the first agent only; drill: message not sent; drill: history dropped; drill: Shift+Enter sends; drill: Enter does not send; drill: blank text is sent; drill: send button does nothing; new drill: turns kept; new drill: button does nothing; details: no refold on agent switch; name: box not read; name: not trimmed; class: always client_facing; class: box not read; owner: box not read; revert: no snapshot; revert: snapshot not refreshed on save; drill: shown for every agent.
- **brand-studio.html**: 36 breaks, 36 red.
  ramp: every picker writes stop 0; ramp: saved reversed; ramp: preview strip not drawn; name: wordmark shows entity; name: not saved; name: tile never says Text mark; ink: picker does not set the colour; ink/paper: hex box not upper-cased; ink/paper: bad hex accepted; ink: wired to paper; paper: wired to ink; ink: valid hex does not move the picker; display face: writes the mono face; display face: font link not updated; faces: saved swapped; mono face: writes the display face; presets: cycle of five; presets: never moves; presets: pickers not repainted; reset: draft not removed; reset: no question; reset: reloads nothing; use text: wordmark kept; use text: always enabled; use text: file box not emptied; turn off: sends on; turn off: wrong partner; turn off: button never wired; turn off: shown to every role; history: section id always sent; history: locked blocks offered; history: page pick does not refill sections; history: section pick does not re-read; dns copy: TXT copies the data value; dns copy: no copied word; dns copy: nothing copied.
- **campaign-manager.html**: 46 breaks, 46 red.
  rail: approval state ignored; rail: pick does not set state; platform: filter ignored; platform: select does not set; offer: filter ignored; offer: reads platform; limit: always 50; pager: next steps by one; pager: previous steps by one; pager: next never disabled; pager: new filter keeps the page; pager: prev always disabled; row click: opens the first campaign; row click: Enter key does nothing; row click: no detail read; drawer: X does not close; drawer: scrim does not close; drawer: Escape does not close; drawer: scrim stays up; days: choice not kept; days: no re-read; days: options trimmed; connections: state ignored; connections: pick does not set; log: agent filter ignored; log: human filter ignored; log: revertible ignored; log: failed counts only errors; log: target ignored; log: target select does not set; log: rule ignored; log: rule select reads target; ad books: always lane; ad books: pick does not set group; ad books: no re-read; spine: group not sent; spine: pick does not set group; spine: days not sent; spine: window select does not set days; spine: window select does not re-read; clickfunnels: one box is enough; clickfunnels: subdomain sent as key; clickfunnels: key not cleared; clickfunnels: key not trimmed; clickfunnels: no sync after connect; clickfunnels: refusal reworded.
- **contract.html**: 8 breaks, 8 red.
  download: filename ignored; download: file not saved; download: wrong bytes; download: link dropped from the file request; download: failure silent; download: empty answer treated as ok; download: offered before everyone signed; download: button not wired.

Total: 115 breaks made in page files, all 115 turned the named test red.
Two breaks stayed green on the first pass. (1) The drill card shown for every agent was a gap in the test: it only tried a draft
agent. The test now also tries a shadow agent that is not OP-06, and that break is red (counted above). (2) Marking the Identity
section `open` in the markup changes nothing a person can see, because the page folds every section on load; it is an equal
outcome, not a product break, and is not counted.


## Commands run and what they said

Measured on a Mac with a load average of 30 to 70 (other batches running at the same time).

- `node scripts/pulse/count-not-proved.mjs` (offline, stub fetch): batch rows open 40 before, 3 after; all lanes 853 before, 816 after.
- `npm run pulse:catalog` then `node scripts/pulse/compile-catalog.mjs --check`: fresh.
- The five new test files together, three runs in a row: 50 tests, 50 pass, 0 fail, each time
  (`fin-b09-agent-editor` 12, `fin-b09-brand-studio` 15, `fin-b09-campaign-manager` 15, `fin-b09-contract-download` 4, `fin-b09-rows` 4).
- The whole group (every file under `src/pulse/catalog`, `gap-catalog*`, `gap-door-batch*`; 118 files): 1,733 tests, 1,732 pass, 1 fail.
  The one failure is `flow-result-proofs` "every test named by a flow proof passes", where `src/sales/closer-deck.test.mjs` times out
  under load. That is the same load flake S1 and S4 recorded. It is not a file of this batch. Alone, `closer-deck.test.mjs` is 27 of 27
  and that one test passed on its own re-run (1 of 1, 65 seconds); a re-run of the whole file under the same load hit the timeout once more.
  The display proof guards (`display-proof-cases.test.mjs`: exact map rows, red count 635, and the run of every test named by a display
  case, these four included) all passed inside the group run.
- `npm run lint`: 3,570 files parse clean.
- Break checks: 115 breaks in 4 page files, all red (above). Every page file was put back with `git checkout`; `git status` shows
  no product file changed.

## Generation 2 (the three rows that were left)

Challenge: read each real page or handler and attach a live check or practice test unless the reason is exactly true.
All three reasons are exactly true. None was attached. The count stays 40 before, 3 after.

| Row | Challenge | Result |
|---|---|---|
| agent-editor.html: Agent list row (click to open an agent, confirm discard of unsaved edits) | Read `renderList()`, `select()`, `collect()` and the Revert handler in `public/app/agent-editor.html`, then ran it in Chromium: type a new name, click another agent, answer Yes, click the first agent again. | `not-attachable`. The question is asked and the click works, but `select()` reads `cur` and `collect()` already wrote the typed words into it, so Yes only clears the unsaved mark. The words are still there. The row words promise a discard. A test that asserts the discard is red; a test that leaves it out would turn the row green over a page that does not do what the row says. Revert (a different row) does restore. |
| climate/index.html: Click a state: shows its score and a plain sentence | Read the shipped chunks (`_next/static/chunks/375-*.js`, `app/page-*.js`), the redirect in `netlify.toml`, and the git history of `public/climate` (`f39cec357` reverts the visitor page, `8547bb72a` ships the dashboard). Then ran the page in Chromium with a fake `/api/climate` and clicked a state. | `not-attachable`. The panel shows "Today's Score", the number, the band word (raw `color_band`, for example `favorable`), Fresh/Stale and the as-of time, Trend, Business Conditions, Bank Liquidity, Issuance Velocity, and a bank list. There is no sentence and no paragraph. The lead-magnet page that has the sentence is only in the journey doc. |
| leads/<32-hex>/index.html: Button 'Reset my edits' | Searched `src/`, `scripts/`, `db/`, `docs/`, `public/`, `api/`, `netlify/`, `e2e/` for the button words and for "Follow up date"; `git log --all -- public/leads` (no commit has ever tracked it); read `.github/workflows/ship.yml` and `src/pulse/registry.mjs`. | `not-attachable`. The page is one inline file with the real leads inside it. It is git-excluded and written at ship time from the `PRIVATE_LEADS_PAGE_B64` secret. Nothing in git builds it. Reading it from the main folder is outside this batch's rules and would put real names and numbers in front of an agent. A test that opens it only when it exists is a skipped test on every fresh checkout and on every GitHub run without the secret. |

New guard (not an attachment): `fin-b09-g2-findings.test.mjs` runs the agent editor and the climate dashboard for real and passes only
while findings 1 and 2 are still true. It is a stronger version of the source regexes in `fin-b09-rows.test.mjs`, which stay.
The reasons in `fin-b09-not-attachable.mjs` now say what generation 2 checked.

Break checks for generation 2 (the product fixed on purpose, the test run red, the file put back with `git checkout`):
- agent-editor.html: restore the saved copy of the agent the click leaves, when Yes is answered. The finding test went red with
  "the discard works, attach the 'Agent list row' row".
- climate chunk `375-*.js`: add a paragraph "This is the wider picture ..." to the state panel. The finding test went red with
  "the state panel now carries a sentence ... attach 'Click a state'".

Numbers, generation 2 (count script, offline): batch rows open 40 on `fin/base`, 3 on `fin/b09` (before and after this
generation). All lanes 853 on `fin/base`, 816 on `fin/b09`; display lane 680 and 643.

Product finding added in generation 2 (one line, not fixed):
4. Climate dashboard: the state map in the bundle draws only five state shapes (AZ, CA, NY, TX, FL), so a visitor can click five
   states on the map; the other 46 are reachable only through the table's "View State" buttons. The journey says 51 drawn.

Commands run, generation 2:
- `node --test src/pulse/catalog/proofs/fin-b09-g2-findings.test.mjs`: 2 of 2 pass; both red under the break checks above.
- `node --test` over `door-proof.test.mjs`, `data-control-proof.test.mjs`, `fin-b09-rows.test.mjs` and the new file: 996 tests, 996 pass.
- `npm run pulse:catalog`: no change to `generated.json` (the new file is not in any shared list).
- `node scripts/pulse/count-not-proved.mjs`: 816 total, 3 of them this batch.


## Resume run (the workflow was restarted after the Mac shut down; builder generation 1 again)

The branch already held generations 1 and 2. This run re-measured everything from a clean state, re-challenged the three
left-over rows, and fixed one flaky test of this batch that the whole-group run exposed.

Numbers (count script, offline, stub fetch), measured again on `fin/base` and on `fin/b09`:

| | |
|---|---|
| Batch rows open before (`fin/base`) | 40 |
| Batch rows open after (`fin/b09`) | 3 |
| All lanes before / after | 853 / 816 (display lane 680 / 643) |
| practice-test / live-check / na-verified / not-attachable | 37 / 0 / 0 / 3 |

Re-challenge of the three left-over rows: all three reasons are still exactly true.
- Agent list row: read `public/app/agent-editor.html`. The list click asks `confirm()` and then calls `select()`, but every
  input already ran `collect()`, which wrote the typed words into the agent object. Yes only clears the unsaved mark. The words stay.
- Climate state click: the shipped bundle shows score, band and trend with no sentence (`fin-b09-g2-findings.test.mjs` runs it).
- Leads reset: `grep` for the button words finds no page file in the repo; the page is shipped outside git.

The flake that was fixed (test only, no page file touched): in a whole-group run under a load average near 100, the
"+ New agent" test read the page's `CREATED` note after the page's own 2.2 second timer had already cleared it, so the file
failed once and "every listed row was exercised" failed with it. The same race sat in the three `SAVED` waits of the identity
tests and in the 1.1 second `copied` label of the DNS copy buttons. `fin-b09-kit.mjs` now has `watchText()` and `textsSeen()`:
a recorder, installed before the click, that keeps every text an element took. The tests assert the word appeared in that list.
`waitFor` in the kit now allows 20 seconds instead of 8. No assertion was removed or loosened: a page that never paints the word
still goes red (see the breaks).

Break checks for this run (page file broken, test run red, file put back with `git checkout`):
- `saveNote('CREATED')` changed to an empty note: "+ New agent" red (2 red with the row guard).
- `saveNote('SAVED')` changed to `DONE`: name, class and revert tests red (4 red with the row guard).
- Brand Studio copy label `copied` changed to `done`: DNS copy test red (2 red with the row guard).
- Spot checks of earlier breaks, still red: contract.html filename ignored (3 red), download button shown before everyone signed
  (1 red), campaign pager next steps by one (2 red), agent editor Revert never restores (2 red), brand studio Presets cycle of five (2 red).

Commands run in this resume run:
- `node --test` over the six `fin-b09-*` files: 52 of 52 pass (before and after the fix).
- `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs`: 3 of 3 pass (exact rows, red count 635, and the run of every
  test named by every display case, this batch's four files included). A first run of the same file under a load average near 100
  had one failure in this batch (the race above) and failures in other batches' browser specs (staff display batch payment and
  teleprompter timing tests, EF/Public contracts, cc-tab-ideas, marketing-cc-settings); those are not files of this batch.
- `node scripts/pulse/compile-catalog.mjs --check`: fresh. `npm run pulse:catalog`: no change to `generated.json`.
- `node scripts/lint.mjs`: 3,571 files parse clean.

Shared lines touched in this run: none. The three files changed in the fix are all new files of this batch.


## Re-run, generation 2 (the three left-over rows challenged again; one is now a live check)

The order was: challenge every earlier "not-attachable" reason, read the real page or handler, and attach unless the reason is
exactly true. Result: one reason was NOT exactly true and is now attached. Two were exactly true and stay.

| Row | Challenge this run | Outcome |
|---|---|---|
| agent-editor.html: Agent list row (click to open an agent, confirm discard of unsaved edits) | Read `renderList()`, `select()`, `collect()` and the Save handler in `public/app/agent-editor.html` again. Every input runs `collect()`, which writes the typed words into the agent object. The list click asks `confirm()` and then calls `select()`, which only clears the unsaved mark. Nothing restores the saved copy. Ran it in Chromium (`fin-b09-g2-findings.test.mjs`, tests 1 and 2): type a name, click another agent, answer Yes, come back: the typed name is still there with no unsaved mark, and Save sends it. | not-attachable. The row's words promise a discard. A test that asserts the discard is red; a test that leaves it out would paint the row green over a page that does not do what the row says. Product finding 1. |
| climate/index.html: Click a state: shows its score and a plain sentence | Read the shipped state panel in `_next/static/chunks/375-*.js` again: "Today's Score", the number, a band word, Fresh or Stale, four numbers, and a bank list. No sentence and no paragraph. The lead-magnet page that has the sentence was reverted on 2026-09-18 (`f39cec357`), the Darwin dashboard replaced it (`8547bb72a`); the sentence now lives only in `docs/journeys/climate-lead-magnet-intended.md`. Ran it in Chromium (`fin-b09-g2-findings.test.mjs`, test 3). Also considered the batch 06 route (a live read that proves the control is not shipped, then "nothing to judge"): it would be wrong here, because a state click IS shipped and shows the score. | not-attachable. The row's words name a sentence the shipped page does not show. The journey doc is stale against the owner's own 2026-09-18 decision; that is a call for Chris, not for a check. Product finding. |
| leads/<32-hex>/index.html: Button 'Reset my edits' | The earlier reason ("no page file in this repo to open") is true for a test that opens a file and false for a check that reads the page the server hands out. Batch 07 had already shown the way for the sibling page row: the registry names the address (`SHIPPED_OUTSIDE_GIT`, `leadsPagePath`) and the lane GETs it. Built the same for this row. | live-check. Details below. |

### The live check for the Reset button

- **What reads it.** `src/pulse/coverage/fin-b09-leads-reset.mjs`. The display lane makes one GET (`livePageReader`, in
  `gap-catalog-display.mjs`, which is already on the reviewed read-only list in `no-unfenced-transmit.test.mjs`; the new file has no
  network call of its own, and a test holds that). The address comes from the one registry row whose file starts with `leads/`. Redirects are
  not followed. 5 second limit. Nothing is sent or written.
- **What it judges.** Seven promises, each in plain words in the detail line: (1) the page has exactly one button that says Reset
  my edits; (2) a click handler is attached to it (by its id, directly or through a held element or a named function; a commented-out
  handler does not count); (3) the handler asks first and stops when the answer is No; (4) Yes empties the edits the page saved
  (the saved object is reset in memory, or the storage key is removed together with a reload); (5) the empty edits are written to the
  browser's storage; (6) the list is redrawn after that; (7) the storage key it clears is the one the page loads back.
- **Statuses.** 200 and all seven hold: PASS. 200 and one breaks: FAIL, naming which. 404 or 410: FAIL (gone). 3xx: FAIL (moved).
  401, 403, 429, 5xx, no answer, no GET client, bad base address, no single registry row: skip with the reason. A read that failed is
  never green.
- **Privacy.** The page text is judged in memory and thrown away. No detail or fix line repeats anything the page holds (a test plants
  a marker in the title, the heading and the data and asserts it never comes back). Nothing from the page is in this repo or this file.
- **What it is not.** It reads the SOURCE the server hands out. It does not click. The click was run once, by hand, on the live page
  (below), and the check turns what that run showed into a check that goes red the day the button, its question, its clearing or its
  redraw is gone.

### Measured on the live page, 2026-10-15, read only

| What | Result |
|---|---|
| One real GET of the live lead page, judged by `judgeLeadsResetHtml` (only the verdict words printed) | status 200, all seven promises held, 0 broke |
| The page's own script run in Chromium from an in-memory copy at a made-up address (no other request allowed, nothing written to disk, only booleans printed), one saved edit seeded on a real row id | the edit shows on screen; Reset then **No**: storage unchanged, edit still shown, one confirm asked; Reset then **Yes**: storage is the empty object, the typed words left the screen; after a reload still empty |

### The judge, broken on purpose (this run)

Each break was made alone in the judge or the lane, the judge test and the lane test run, then the file put back with `git checkout`.
21 breaks, 21 red.
The question never asked; the empty step always true; the write step always true; the redraw step always true; the same-key step
always true; any button text accepted; zero buttons accepted; the handler search ignoring the id; comments not stripped; 404 not red;
a redirect not red; an unread page read as PASS; an odd status read as PASS; the row key loosened to any leads row; the registry address
accepting two rows; the detail echoing the page; the lane hook unused; the lane GET changed to POST; redirects followed; a thrown
read answered as a page; any answer treated as status 200.
Two of them stayed green on the first pass and the tests were tightened, not the breaks dropped: the privacy test now plants the
marker in the title and heading as well (an echo of the start of the page was not caught), and the lane test now asserts the words for
404, 302, 401 and 500 (a lane that turned every answer into a 200 was not caught).

### Numbers, this run

| | |
|---|---|
| Batch rows open on `fin/base` | 40 |
| Batch rows open on `fin/b09` at the start of this run | 3 |
| Batch rows open now | 2 (the agent list row and the climate state click) |
| All lanes on `fin/base` / now | 853 / 815 (display lane 680 / 642) |
| practice-test / live-check / na-verified / not-attachable | 37 / 1 / 0 / 2 |

### Commands run, this run

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` on a clean detached copy of `fin/base`, then of `fin/b09` at its previous head, then now; intersected with `batch-09.json` | 40, 3, 2 batch rows open; all lanes 853, 816, 815 |
| `node --test src/pulse/coverage/fin-b09-leads-reset.test.mjs` | 13 of 13 pass |
| `node --test` over the new test, `gap-catalog-display.test.mjs`, `no-unfenced-transmit.test.mjs`, `registry.test.mjs`, `modules.test.mjs`, `fin-b09-rows.test.mjs` | 46 of 46 pass |
| `node --test` over the six `fin-b09-*` browser and guard files (agent editor 12, brand studio 15, campaign manager 15, contract download 4, rows 4, findings 3) | 53 of 53 pass (load average near 100 during the run) |
| `node --test` over `compiler.test.mjs`, `na-conditions.test.mjs`, `self-audit.test.mjs`, `modules.test.mjs` | 165 of 165 pass |
| `node --test --test-name-pattern=...` on `display-proof-cases.test.mjs` (exact rows, red count 635) | 2 of 2 pass. The third test of that file (runs every test named by every display case) was not re-run whole; this batch's four named files were run above and the proof-case list did not change |
| `npm run pulse:catalog`, `compile-catalog.mjs --check` | no change to `generated.json`; fresh |
| `node scripts/lint.mjs` | 3,573 files parse clean |

### Risks for the integrator

- **Batch 07 also GETs this same private page** (its `live-page` contract, `fin-b07-leads-page.mjs`). After both merge the lane reads it
  twice. They can share one read: `judgeLeadsResetHtml(html)` is pure and takes the same page text, so one `{ status, html }` read can
  feed both. Nothing else needs changing. `fin-b09-leads-reset.mjs` has its own copy of the address lookup (`leadsResetPath`, 6 lines),
  the same as b07's `leadsPagePath`; either can be dropped for the other.
- The new check goes red if a ship runs without `PRIVATE_LEADS_PAGE_B64` (the page is gone). That is the same condition b07's check
  reports, and it is real: a ship from GitHub without the secret removes the page.
- The lane edit sits near the batch 01, 06, 07, 10, 19 and 21 edits in `gapChecks`. Expect a textual conflict in `gap-catalog-display.mjs`
  and in the lane test's filter line; both are one line each of this batch's.

### Product findings (re-run additions, not fixed)

5. Agent Editor: after answering Yes to "Discard them?", the next Save on that agent sends the words that were meant to be dropped
   (pinned by `fin-b09-g2-findings.test.mjs`, second test).
6. Climate journey doc: `docs/journeys/climate-lead-magnet-intended.md` still describes the visitor page that was reverted on 2026-09-18
   (clicked state with a plain sentence, a four-answer form, a count). The shipped `/climate/` is the dashboard. Two rows of the map
   are written from that doc. An owner call: retire the rows or restore the page.
