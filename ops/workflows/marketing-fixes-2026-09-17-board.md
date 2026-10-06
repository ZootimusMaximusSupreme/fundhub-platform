# Marketing walkthrough fixes board — 2026-09-17

**Source of the defects:** `marketing-walkthrough-2026-09-17-board.md` (walker) and
`-validate.md` (second agent, 6 CONFIRMED / 0 contradicted).

**Owner order, 2026-09-17:** "acknowledge not to fix anything that wasnt scoped out. then run
them all." Three fixes authorised. Nothing else. A correct fix to an unscoped defect is still a
failed task.

## Result

| Unit | What | Status |
|---|---|---|
| F1 | Creative Factory script drop-down reads "— none —" after a script saves | **done and proven live** — `6e93c3e7`, shipped `8a35bd30` |
| F2 | The /watch page records no views | **needs Chris** — no code can fix it |
| F3 | Social Studio "Write 3 posts for me" writes 0 drafts | **part done** — mask bug fixed `a91a81f8`, but the button still writes 0 live |

Run as one Workflow: diagnose (3 parallel, read-only) → fix (serialised, one shared tree) →
verify (2 lenses per fix: does it work, did it stay in scope) → whole-diff scope audit.
7 agents, 0 errors.

## F1 — fixed. Commit `6e93c3e7`.

The save half of "save this script" shipped on 2026-09-08. The read half was never built.
Nothing on the server would hand saved scripts back, so the drop-down was filled only in browser
memory at the moment of saving. A reload wiped it back to "— none —", and a script written
yesterday could never be attached to anything.

Files: `api/scripts/list.mjs` (new), `src/http/scripts-list.pg.test.mjs` (new),
`public/app/creative-factory.html`. The route registration in `netlify/functions/api.mjs` and
the guard in `src/ui/label-chain-reachable.test.mjs` were swept into `bf24b6c8` by another lane
before this commit landed — see "main was broken" below.

Proof: 9/9 pass, **0 skipped**, against a real `DATABASE_URL`. The test writes through
`api/scripts/write.mjs` and reads through `api/scripts/list.mjs`, and asserts partner isolation
in both directions, so an endpoint returning nothing could not pass it. Routes + label-chain
guard 35/35. An independent verifier re-ran it and drove a real browser against the real handler
and the live database: after a full reload the drop-down held the exact script the 2026-09-17
walk saved and could never see again. Both verify lenses returned holds=true.

## F2 — no code fixes this. A person has to paste.

`apply.fundhub.ai/watch` is a ClickFunnels page. This repo cannot reach it, so no deploy from
here can ever change it. Everything on our side is already finished and live: the beacon
endpoint answers on fundhub.ai, the migration is applied, both tables exist and are empty.

The step: open the ClickFunnels page editor and paste
`clickfunnels-fragments/06-utm-hidden-fields.html` at the top and
`clickfunnels-fragments/07-vsl-watch-beacon.html` at the bottom, then Save and Publish.
Connecting to ClickFunnels is on the red list and was not attempted.

## F3 — not a missing social account. A fake password.

The walker's guess was wrong, disproved two ways: the drafts table has no account column at all,
and its own comment says it exists for "generated posts before a social channel exists." A draft
needs no connected account.

Real cause: the `OPENAI_API_KEY` stored on the live site is the **blanked-out** form of a key —
sixteen asterisks and four characters, what you see on screen when a password is hidden. Someone
copied the mask instead of the value. OpenAI refuses it with a 401. Because *a* key is present,
the code never falls through to Anthropic — and the Anthropic key on the site is valid (measured
200). So the button asks a locked door and gives up. The screen does print "The writer is not
switched on, so nothing was written"; nobody captured that line on the walk, which is why it was
recorded as nothing happening.

**Owner rule, set 2026-09-17 after removal was proposed: never remove a key.** See CLAUDE.md
§11 "Never remove a key". The `OPENAI_API_KEY` stays exactly where it is, mask and all. No
future agent may unset, clear or overwrite it. The removal command that stood here is deleted
so nobody runs it.

### Fixed in code instead. Commit `a91a81f8`.

`openaiKeyOf()` in `src/agents/model.mjs` now treats a value containing an asterisk as not set.
A real OpenAI key never carries one, so this recognises a mask exactly and refuses no genuine
credential. One function gates every caller — `liveModelProvider`, `pickProvider` and the call
path — so that is the whole diff. The moment a real key replaces the mask, OpenAI is used again
with no further change.

Proof: `src/agents/model.test.mjs` 7/7. The two new tests were run against the **unpatched**
module first and both failed, so they are not rubber stamps. Every test touching the module,
including `src/http/social-generate.pg.test.mjs` against a real `DATABASE_URL`: 40 pass, 0 fail,
**0 skipped**. lint clean, tsc clean.

Side effect, flagged so nobody is surprised: `src/company-brain/answer.mjs` and
`src/company-brain/classify.mjs` pick the provider the same way, so Company Brain is quietly
taking the same 401s. This fix repairs those too — they now reach Anthropic, which works.

## Live proof after ship `8a35bd30`

F1 **passes on fundhub.ai**. Staff session as owner, Creative Factory for the house partner,
full page load: the picker read `["— none —", "MKT-WALK 2026-09-17 · v1"]`, `LIVE_CF.scripts=true`,
`SCRIPTS.length=1`, and `GET /api/scripts/list` answered HTTP 200 `ok=true`. That option is the
script the 2026-09-17 walk saved and could never see again. The reported symptom is gone.
Script: `scripts/tmp/f1-f3-live-proof.mjs`.

F3 **does not yet pass on fundhub.ai.** Pressed "Write 3 posts for me" on the live Social Studio
as owner: drafts before 0, drafts after 0. The screen said "The writer is not switched on, so
nothing was written" — the endpoint's `no_model`. Script: `scripts/tmp/f3-live-proof.mjs`.

The code fix is right and is not the thing failing: `no_model` fires on
`model.mode === "shadow" || model.error || !model.text`, so it is the SAME message both before
the fix (a real call to OpenAI returning 401) and after it (no provider reachable at all). The
mask no longer shadows Anthropic — that part is proven by unit test. What is now missing is a
working writer key in the live function.

**Unresolved, and stopped rather than guessed at:** whether production holds a valid
`ANTHROPIC_API_KEY`. The earlier diagnostic agent claimed it measured that key at HTTP 200, but
it may have measured the local `.env` copy rather than the production one — that claim is NOT
independently confirmed and should not be relied on. I could not check: `netlify env:list`
truncates its table well short of all 82 variables, and every attempt to read a value is refused
by the harness guard as `[Credential Materialization]`. `agent_shadow_log` is empty, so it does
not settle it either.

Worth noting how the mask got there in the first place: `netlify env:list` prints every value as
a row of asterisks. Someone copied what the screen showed.

## main was broken, and it was not this work

`bf24b6c8` ("five lanes applied (UNVERIFIED — tests not yet run)", 15:41) committed the new
route — `netlify/functions/api.mjs` importing `../../api/scripts/list.mjs` — **without** the
handler file, which was left untracked. main therefore imported a file that was not in git. A
build from a clean checkout would have failed to load the API function and taken every route
down with it. It only worked because the file happened to exist on this laptop. The same commit
took a guard asserting the screen calls `/api/scripts/list` while leaving that screen
uncommitted, so HEAD's own suite would have failed too.

`6e93c3e7` commits both halves together and repairs it.

## Not shipped, on purpose

`npm run ship` refuses an uncommitted tree by design (`scripts/ship.mjs:60`). A second session
was editing this repo throughout this run — about 50 tracked files modified, still changing at
15:52, and it deleted this board's first draft as an untracked file. Shipping would mean
committing another lane's in-flight, self-declared UNVERIFIED work. Held.

## Out of scope — found, written down, deliberately not touched

- The angle / hook / offer suggestion lists on the same screen have the **identical**
  missing-read bug as F1. `public/app/creative-factory.html` says so in its own comment: nothing
  reads the label dictionary back and there is no endpoint for it. One endpoint could serve both.
- `clickfunnels-fragments/harness/build.mjs` never sandwiches fragment 07 into
  `harness/watch.html`, so there is no local browser proof of the beacon script anywhere — the
  only proof is a fake-browser test.
- The local `.env` carries the same fake OpenAI placeholder, so a local run fails identically.
- `src/funding/approval-amount-guard.pg.test.mjs` has an existing test whose assertions were
  inverted by another lane.
- Three pre-existing failures in `src/http/crm-html.test.mjs`, matching the recorded baseline at
  `2aae7dc2`.

Also named as broken on the walk and left alone from the start: no picture/video maker switched
on, house partner has no Meta ad account, YouTube not connected, `docs/ads/scripts/` holds only a
README. 21 of 24 ads untitled is not a defect (CLAUDE.md §3c — ads are identified by id).

## Multiple funnels — measured 2026-09-17, waiting on Chris

Chris asked: how do we account for multiple funnels? If we don't, add it.

**Answer: partly.** Measured, not assumed:

- **Video views** (`vsl_watch_sessions`, `db/migrations/379_vsl_watch.sql`) record which
  **video** (`video_key`) and which **page** (`page_url`), plus the ad number. So two
  funnels on two different pages *can* be told apart — but only by raw web address. There
  is **no funnel name** on a view, and **no partner** on it at all.
- **Leads** carry the page they landed on (`landing_path`,
  `db/migrations/286_client_ad_attribution.sql`) and two old free-text fields,
  `cf_funnel_family` and `cf_funnel_version` (`db/schema/005_client_custom_fields.sql`).
- **Partner sites** (`/sites/*`, `netlify/functions/partner-site.mjs`) have funnel
  templates — apply, diag, edu, aff, book (`db/migrations/135_partner_pages.sql`) — but
  **no videos**. So there is nothing for the view counter to count on a partner site today.

**Built, `fb49489e` — Chris said yes: a funnel means one of our own sales pages with its
own video.** Design changed from what was first described, for the better: the funnel is
worked out on our side from the page address the counter already saves
(`db/migrations/385_vsl_funnels.sql`), not sent by the page. So the ClickFunnels page script
does **not** change, the paste in the TODO is still the current one, and a funnel listed later
names viewings recorded before it. Diagram: `docs/journeys/vsl-watch-flow.md`, "Which funnel
a viewing belongs to". Test: `src/vsl/vsl-funnels.pg.test.mjs`.

**Live, ship `125d20c5`.** The ship applied 385 (296 database changes, 0 pending).
`src/vsl/vsl-funnels.pg.test.mjs` then ran against the live database: **7/7 pass, 0 skipped,
three clean runs in a row.** Two earlier runs were cancelled partway, with 0 pass and 0 fail —
most likely the way their output was piped cut the process short, not the code. Checked
afterwards: 0 test funnels and 0 test viewings left on the live database. The funnel list holds
0 rows, as intended.

## F3 — re-checked and fixed in code, 2026-10-05 (W3 of `finish-builds-2026-10-05`, branch `w3-funnel-tracking`, not live until ship)

**The 09-17 cause was wrong. The live OpenAI key is not a mask. It is a real key on an empty account.**

- `OPENAI_API_KEY` on Netlify is a **secret** variable (`is_secret: true`, last changed 2026-08-24). Netlify always shows a secret as stars, so the CLI's "masked" view is Netlify hiding it, not the stored value. The local `.env` copy *is* a mask, which is why a laptop test got 401.
- Proof: the 2026-09-17 23:17 UTC press came *after* the masked-key fix shipped (`8a35bd30`, 16:14 Arizona), and `partner_ai_usage` still recorded `gpt-4o-mini` with 0 tokens. A key with a star in it would have been skipped. And `failed_events` holds the live OpenAI answer three times on 2026-09-18 08:52 UTC: `openai 429 … insufficient_quota, "You have no credits remaining"`.
- `callModel` only turns to Anthropic when no OpenAI key is set at all, so the working Anthropic key (production key answers 200, checked 2026-10-05) was never asked. No social press has run since 09-17 (`partner_ai_usage`), and `marketing_content_queue` has no rows after 2026-08-26.

**Fix (smallest diff, reuse):** `api/social/generate.mjs` now calls `callWriter`, which runs the same backup the ID reader already uses (`readWithBackupReader`, `src/handlers/doc-check.mjs`): when OpenAI says "no credit", ask Anthropic once, with the OpenAI key left out of that one call's copy of the environment. The stored key is untouched. The backup gets only what is left of the 8.5-second bound.

**Proved (local, not live):**
- `src/http/social-generate-writer.test.mjs` 8/8, 0 skipped. Same stubs on the old path: OpenAI 429, one call, no text.
- Real call: OpenAI leg replays the recorded production 429, Anthropic leg goes to the real API with the **production** `ANTHROPIC_API_KEY` → provider anthropic, `claude-sonnet-4-5-20250929`, 3 captions, 4.9 s total.

**Live proof still owed after ship:** press "Write 3 posts for me" on https://fundhub.ai/app/social-studio.html?partner_id=55272246-b97f-4c4b-a693-bce3f7e2dfd2 as owner. Pass = new `draft` rows in `marketing_content_queue` and a `partner_ai_usage` row with model `claude-sonnet-4-5-20250929` and tokens above 0.
