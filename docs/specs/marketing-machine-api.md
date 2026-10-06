# Marketing machine API contract

Every `marketing/*` route in the marketing machine spec (M1 to M8), plus `POST marketing/jobs/retry` and the `resume_ad` action on `campaigns/write`: the method, who may call it, the request, the answer, the errors and one example each.

- **Spec:** [`docs/specs/marketing-machine-2026-10-04.md`](marketing-machine-2026-10-04.md) §7.8 asks for this file. **Design:** [`docs/specs/command-center-design-2026-10-05.md`](command-center-design-2026-10-05.md).
- **The machine-readable twin:** `src/marketing/api-contract.mjs` exports `CONTRACT` (route key -> `{owner, requestKeys, responseKeys, example}` and more) and `assertMatchesContract(routeKey, body)`. `src/marketing/api-contract.test.mjs` fails when this file and the module stop saying the same thing.
- **Who builds to it:** every back-end unit that builds one of these routes checks its answers with `assertMatchesContract`. Lane E (the Command Center and teleprompter screens) mocks every route from the examples before the real route lands.
- **The rule (spec §7.8):** any PR that changes a route's shape updates this file and `src/marketing/api-contract.mjs` in the same PR.
- **Linked, not changed here:**
  - [`docs/specs/marketing-today-contract.md`](marketing-today-contract.md) holds every existing key of `GET marketing/today`. This file adds the M5 keys only.
  - [`docs/specs/marketing-offer-contract.md`](marketing-offer-contract.md) holds `marketing/offer/generate` (the offer writer). It is not part of the machine spec, so it is not repeated here.
- Written by plan unit U01 on 2026-10-05 (`ops/workflows/marketing-machine-2026-10-plan.json`). No route code lives here.

## 1. How to read a route

- **Route key** = `METHOD path`. The address is `/api/<path>`. One key is special: `POST campaigns/write#resume_ad` is `POST /api/campaigns/write` with `action: 'resume_ad'` in the body.
- **Owner** = the plan unit that builds the route, or `deferred`: outside this build pass. A deferred shape is drafted from the spec and the design doc. The unit that builds it may refine it, and updates this file and the module in the same PR.
- **Guard** = what a write sends back so a stale screen cannot overwrite newer work: `version` (scripts, videos) or `updated_at` (settings, funnels, the next-batch overrides).
- **Request / Response** lines are printed from the module's key lists. `key?` = may be left out. `key:[{...}]` = a list of objects. `S` = the Script object (section 4). Extra keys in an answer are always allowed.
- **Examples** are made up to show the shape. None is a real number from the live database.

## 2. Global rules

These are the rules from the U01 brief, word for word:

```text
errors are {error, message} with message in plain words; 400 {error:'invalid', field, message}; 401; 403 {error:'forbidden'}; 404 {error:'not_found'}; 409 {error:'stale', current:{...}}; 202 {queued:true, job_id|job_ids|op_id}. Every write carries request_id: a repeat from the same org and route returns the saved response; a request_id already used by another org or another route returns 400 {error:'invalid', field:'request_id'}. Script writes carry version; settings/funnel writes carry updated_at. Money keys end in _cents (integers); model-bill keys end in _usd (numeric dollars). Ratios are decimals 0..1, null when the denominator is 0. null = unknown, never 0. Every read that shows Meta numbers returns as_of (last sync time). All routes gate on ROLE_SETS.MARKETING; resume_ad also needs the switch list.
```

What they mean in practice:

- **Errors** are `{error, message}`, and `message` is a plain sentence the screen can print. `400 {error:'invalid', field, message}` names the bad field. `409 {error:'stale', current:{...}}` carries what is saved now, so the screen can show both. `202 {queued:true, job_id | job_ids | op_id}` means the work runs in the background; read the matching GET to see it finish.
- **`ok`.** The shared helpers also send `ok: true` on success and `ok: false` on errors. It is allowed and never required, except where a shape names `{ok:true}`.
- **`request_id`** is a fresh uuid the page makes for each tap (`crypto.randomUUID()`). Sent again from the same org to the same route, the answer is the saved body with the route's normal success status, and nothing runs twice. Already used by another org or another route: `400 {error:'invalid', field:'request_id'}`. Only success answers are saved, so after an error the same `request_id` can be sent again.
- **Money** keys end in `_cents` and are whole numbers. Model-bill keys end in `_usd` and are dollars with decimals (model bills only, never client money).
- **Rates** (`ctr`, `hook_rate`, `hold_25`, `thruplay_rate`, `close_rate`, `share`, `click_to_page`, `page_to_lead`) are decimals from 0 to 1, null when the bottom number is 0 or unknown. `roas` is cash divided by spend as a decimal; it can be above 1, and it is null when spend is 0 or unknown. `format_mix` holds weights, not rates. `video_play_curve` is Meta's own list of percents (0 to 100), stored as Meta sends it.
- **null means unknown,** never 0. A count we know is 0 is 0.
- **`as_of`.** On a read that shows Meta numbers it is the last Meta sync time (null if Meta never synced). On a read that shows none (`GET marketing/scripts`, `GET marketing/health`) it is when the answer was built. `GET marketing/today` keeps its old meaning (when the answer was built), because its keys never change; its sync time is `last_sync`.
- **Ad numbers are strings of digits** (`"91"`) everywhere: `ad_id`, `ad_number` and the `n` query. They are ids, not amounts, and `ad_scripts.ad_id` and `utm_content` are text.
- **Times** (`*_at`, `since`, `release_at`) are ISO 8601 UTC strings. **Dates** are `YYYY-MM-DD` Arizona days. Settings times (`batch_time`, `quiet_start`, `quiet_end`) are `HH:MM` in the settings time zone. `week_key` is the ISO week of `release_at` in the settings time zone, like `2026-W42`.
- **Gate.** Every route runs `requireAuth`, then `requireRole(res, staff, ROLE_SETS.MARKETING)` (owner and admin, `src/http/read-api.mjs`), and reads the org from the session, never from the request. `resume_ad` also needs the caller's staff id on `MARKETING_AD_SWITCH_STAFF_IDS`.

**Errors every route can answer:**

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `request_id` | a write with no request_id, or one already used by another org or another route |
| 401 | `unauthorized` | none | no session (the shared sign-in check answers this; it carries no message) |
| 403 | `forbidden` | none | signed in, but the role is not owner or admin (ROLE_SETS.MARKETING) |
| 405 | `method_not_allowed` | none | the wrong method; the Allow header names the right one |
| 503 | `db_unavailable` | none | the database is not answering (the shared dbDown shape, with db:'down') |

The 401 and 403 come from the shared `requireAuth` and `requireRole`, and the 503 from `dbDown` (`src/http/db-down.mjs`). Any other throw becomes `500 {error:'internal_error'}` in `netlify/functions/api.mjs`.

## 3. Fixed shapes (from the U01 brief, word for word)

Other units build to these. If a route section below ever seems to disagree with this list, this list wins and the route section is the bug.

```text
(1) [U03] GET marketing/settings -> {settings:{org_id, enabled, batch_weekday, batch_time, timezone, scripts_per_day, days_per_batch, size_rule, format_style, draft_expiry_days, winner_rule, ad_number_floor, next_overrides, max_batch_cost_usd, max_month_cost_usd, submagic_template, caption_position_y, magic_zooms, clean_audio, caption_dictionary, animation_mode, flip_horizontal, settle_minutes, quiet_start, quiet_end, updated_at, updated_by}}; POST {request_id, updated_at, patch:{...}} -> {settings}.

(2) [U03] GET marketing/funnels -> {funnels:[{id, key, name, landing_url, offer_key, lane, book_call, format_mix, cta_type, meta_campaign_ids, default_ad_set_external_id, weight, active, created_at, updated_at}], campaigns:[{external_id, name, status, spend_7d_cents, funnel_key}], ad_sets:[{external_id, name, status, campaign_external_id}], as_of}; POST {request_id, funnel:{key, ...fields, updated_at?}} -> {funnel}.

(3) [U25] Script object S = {id, root_script_id, version, status, ad_id, title, body, parts, script_format, style, funnel_key, angle_key, hook_key, offer_key, lane, batch_id, idea_id, source, check_results, flagged, fix_note, animation_plan, meta_copy, film_order, needs_retake, locked_at, locked_by, rejected_at, rejected_reason, filmed_at, repo_path, repo_commit, created_at, updated_at}. GET marketing/scripts?status=&batch= -> {scripts:[S], as_of}; GET marketing/script?id= -> {script:S, versions:[S]}; POST marketing/scripts/approve {request_id, id, version} -> {script:S, ad_number, registry:'queued'|'skipped', registry_note}; POST marketing/scripts/edit {request_id, id, version, body, parts?, meta_copy?} -> {script:S, warnings:[{rule, message}]}; POST marketing/scripts/reject {request_id, id, version, reason?} -> {script:S}; POST marketing/scripts/order {request_id, order:[root_script_id]} -> {ok:true}; stale -> 409 {error:'stale', current:{version, body, parts}}.

(4) [U26] POST marketing/scripts/fix {request_id, id, version, note, make_rule} -> 202 {queued:true, job_id}; POST marketing/ideas {request_id, raw_points, source?:'chris'|'suggestion' (default 'chris'), script_format?, funnel_key?, angle_key?, write_now?} -> {idea, batch_id?, job_id?}; GET marketing/ideas?status= -> {ideas:[{id, source, kind, raw_points, topic, script_format, funnel_key, angle_key, status, script_id, created_at}]}; GET marketing/batches -> {batches:[{id, kind, week_key, status, release_at, released_at, counts:{total, ready, flagged, failed}, error}], write_now_ready} (write_now_ready is true only once job kind start_batch is registered); POST marketing/batches/write-now {request_id, count?, funnel_key?, idea_ids?} -> 202 {queued:true, batch_id, job_id}; GET marketing/rules -> {rules_sha, part0:[{n, text}], banned:[string], recent:[{op_id, action, text, state, committed_sha, at}]}; POST marketing/rules {request_id, action:'add'|'edit'|'ban', n?, text} -> 202 {queued:true, op_id}; POST marketing/jobs/retry {request_id, job_id} -> {ok:true, job:{id, kind, status:'queued'}} (only a failed job of the caller's org whose kind is in JOB_KINDS; another org's job or an unknown kind -> 404 {error:'not_found'}; a job that is not failed -> 400 {error:'invalid', field:'job_id'}).

(5) [U23] GET marketing/batches/next -> {next:{release_at, week_key, enabled, total, size_rule, funnels:[{funnel_key, spend_7d_cents, share, slots}], slots:[{n, funnel_key, script_format, style, source, angle_key, idea_id, reason}], suggestions:[{angle_key, name, why, numbers}], unmapped_spend_cents, overrides}, saved:{batch_id, status}|null, as_of}; POST marketing/batches/next {request_id, updated_at, overrides} -> same body as GET.

(6) [U22] GET marketing/health -> {clock:{last_tick_at, enabled}, worker:{last_run_at, queued, running, failed_24h:[{kind, error, at}]}, outbox:{waiting, oldest_waiting_at, last_commit_sha, last_commit_at, last_error, token_present, held_reason}, sync:{last_sync_at}, model:{month_cost_usd, max_month_cost_usd, last_batch_cost_usd, max_batch_cost_usd}, as_of} (held_reason null|'no_token'|'dry_run').

(7) [U32] GET marketing/today: every existing key unchanged; ADD numbers:{today, d7, d30} each {spend_cents, leads, booked, showed, sales, roadmaps, cash_cents, reported_cash_cents, roas}, daily:[{date, spend_cents, leads}] (30 days), spend_by_funnel:[{funnel_key, name, spend_cents}], flow:{page_views, clicks, leads, booked, showed, sales}, scripts_waiting:{ready, flagged}, stuck_jobs:[{id, kind, error, since}].

(8) [U31] GET marketing/ads?from&to&funnel&format&angle -> {rows:[{ad_number, title, funnel_key, script_format, angle_key, spend_cents, impressions, ctr, hook_rate, hold_25, thruplay_rate, leads, booked, showed, sales, close_rate, roadmaps, cash_cents, reported_cash_cents, cpl_cents, cost_per_booked_cents, roas, maturing}], unmapped:[{campaign_external_id, name, spend_cents}], as_of}; GET marketing/ad?n= -> {ad:{...row, meta_ads:[{id, external_id, name, status, ad_set_external_id}], curve:[{date, video_play_curve}], watch:{alerts:[...], diagnoses:[...]}}, as_of}.

(9) [U32] GET marketing/angles -> {rows:[{angle_key, name, spend_cents, ads, leads, booked, sales, cash_cents, roas}], as_of}; GET marketing/funnels/stats -> {rows:[{funnel_key, name, spend_cents, page_views, click_to_page, page_to_lead, leads, booked, showed, sales, cash_cents, roas}], unmapped_spend_cents, as_of}.

(10) [U28] POST marketing/meta/load {request_id, ad_video_id} or {request_id, all:true} -> 202 {queued:true, jobs:[{ad_number, ad_video_id, job_id}]}; GET marketing/meta/load-status -> {loads:[{ad_number, ad_video_id, state:'waiting'|'loading'|'loaded'|'refused'|'failed', reasons:[string], meta_video_id, meta_creative_id, meta_ad_external_id, ad_row_id, ad_status, ad_set:{external_id, status}, campaign:{external_id, status}}], as_of}.

(11) [U15] POST campaigns/write {action:'resume_ad', ad_id:<ads.id uuid>, request_id} -> {ok:true, ad:{id, status:'ACTIVE'}}; 403 {error:'forbidden', message:'Only Chris can turn ads on.'}; it never accepts a Meta id and never touches a campaign or ad set.
```

## 4. The Script object (S)

Every script route answers with this object. It is spec §7.4's `ad_scripts` row as the API returns it.

| Key | What it holds |
|---|---|
| `id` | This version's row id (uuid). Every write sends the id of the version it edited. |
| `root_script_id` | The id every version of this script shares (the first version's id). |
| `version` | 1, 2, 3 ... A write sends the version it edited; an older one gets 409. |
| `status` | `draft`, `locked`, `rejected`, `filmed`, `superseded` or `expired` (spec §7.4). |
| `ad_id` | The ad number as a string of digits (`"91"`), or null until approve gives one. |
| `title` | The angle name. |
| `body` | The teleprompter text: CAPS = punch, a blank line = pause, ↑ = pitch up. The repo file holds the same bytes. |
| `parts` | `[{kind, text}]`, kind `hook`, `line2`, `body`, `cue`, `reveal` or `cta`. Marks every part of `body` for the prompter, the aligner and the anchors. |
| `script_format` | `standard`, `sorting`, `long`, `notes`, `greenscreen` or `vsl`. |
| `style` | `bullets` or `words`. |
| `funnel_key`, `angle_key`, `hook_key`, `offer_key`, `lane` | Where the ad points and what it says. `lane` is an ad lane (`funding600`, `premium`, `sorting`, `uwiq`, `wl`, `slo`). |
| `batch_id`, `idea_id` | The batch that wrote it and the idea it came from, or null. |
| `source` | `machine`, `chris`, `agent` or `import`. |
| `check_results` | The writer's check report (strict checker, judge, compliance screen). U24 owns the inner keys and adds them here when it lands. |
| `flagged` | true when the draft still failed a check after the loop and ships marked "needs a look". |
| `fix_note` | Chris's last Fix note, or null. |
| `animation_plan` | `[{anchor, template, props, seconds}]`. `anchor` is `{phrase}` in words style or `{cue, keyword}` in bullets style. U10's validator owns the inner keys. |
| `meta_copy` | `{primary_text, headline, description, cta_type}`. The headline is 40 characters or fewer. |
| `film_order`, `needs_retake` | Shoot Day order (first = 1, or null) and whether the script must be filmed again. |
| `locked_at`, `locked_by` | When and by which staff member it was approved. |
| `rejected_at`, `rejected_reason` | When it was rejected and why. |
| `filmed_at` | When M3 matched a take to it. |
| `repo_path`, `repo_commit` | Its file in `marketing/ads/scripts/machine/` (never moves) and the last commit that wrote it. |
| `created_at`, `updated_at` | ISO 8601 UTC times. |

Key order: `id, root_script_id, version, status, ad_id, title, body, parts, script_format, style, funnel_key, angle_key, hook_key, offer_key, lane, batch_id, idea_id, source, check_results, flagged, fix_note, animation_plan, meta_copy, film_order, needs_retake, locked_at, locked_by, rejected_at, rejected_reason, filmed_at, repo_path, repo_commit, created_at, updated_at`.

## 5. Route index

51 routes. "deferred" = drafted here, built after this pass. "X4" = the funnel builder (build unit X4).

| Route | Owner | Spec | Success |
|---|---|---|---|
| `GET marketing/settings` | U03 | §6 step 3, §8.3 Settings | 200 |
| `POST marketing/settings` | U03 | §6 step 3, §8.3 Settings | 200 |
| `GET marketing/funnels` | U03 | §6 step 3, §8.3 Settings | 200 |
| `POST marketing/funnels` | U03 | §6 step 3, §8.3 Settings | 200 |
| `GET marketing/scripts` | U25 | §7.8 | 200 |
| `GET marketing/script` | U25 | §7.8 | 200 |
| `POST marketing/scripts/approve` | U25 | §7.8, §7.4, §4 trap 17 | 200 |
| `POST marketing/scripts/edit` | U25 | §7.8, §7.2, §4 trap 9 | 200 |
| `POST marketing/scripts/reject` | U25 | §7.8, §4 trap 17 | 200 |
| `POST marketing/scripts/order` | U25 | §7.8, §8.2 | 200 |
| `POST marketing/scripts/fix` | U26 | §7.8 | 202 |
| `POST marketing/ideas` | U26 | §7.8, §7.5 step 7, §8.1 tab 4 | 200 |
| `GET marketing/ideas` | U26 | §7.8, §8.1 tab 4 | 200 |
| `GET marketing/batches` | U26 | §7.8, §7.4 | 200 |
| `POST marketing/batches/write-now` | U26 | §7.8, §2 item 1, §7.7 | 202 |
| `GET marketing/rules` | U26 | §7.8, §7.1, §8.1 tab 5 | 200 |
| `POST marketing/rules` | U26 | §7.8, §7.1, §8.1 tab 5 | 202 |
| `POST marketing/jobs/retry` | U26 | §8.3 (stuck work with Retry); plan critique M5 | 200 |
| `GET marketing/batches/next` | U23 | §7.5, §7.8 | 200 |
| `POST marketing/batches/next` | U23 | §7.5, §7.8 | 200 |
| `GET marketing/health` | U22 | §6 step 4, §8.3 | 200 |
| `GET marketing/today` | U32 | §8.3, §11.2; existing keys: docs/specs/marketing-today-contract.md | 200 |
| `GET marketing/angles` | U32 | §11.2, §11.3 | 200 |
| `GET marketing/funnels/stats` | U32 | §11.2, §11.1 | 200 |
| `GET marketing/ads` | U31 | §11.2, §11.1, §11.3 | 200 |
| `GET marketing/ad` | U31 | §11.2, §11.3 | 200 |
| `POST marketing/meta/load` | U28 | §10.2-10.5 | 202 |
| `GET marketing/meta/load-status` | U28 | §10.5 | 200 |
| `POST campaigns/write#resume_ad` | U15 | §10.5 Turn on, §2 item 6 | 200 |
| `POST marketing/funnels/create` | X4 | owner order 2026-10-05 (build unit X4): URL system, tag, page builder | 200 |
| `POST marketing/funnels/rename` | X4 | owner order 2026-10-05 (build unit X4): name it in the dash | 200 |
| `POST marketing/funnels/build` | X4 | owner order 2026-10-05 (build unit X4): page builder job (kind funnel) | 202 |
| `POST marketing/funnels/push-live` | X4 | owner order 2026-10-05 (build unit X4): push live to a NEW path; design §5 rules 5 and 16 | 202 |
| `GET marketing/funnel` | X4 | owner order 2026-10-05 (build unit X4): one funnel with its draft pages | 200 |
| `GET marketing/shoot` | deferred | §8.2 | 200 |
| `POST marketing/shoot` | deferred | §8.2 | 200 |
| `POST marketing/shoot/mark` | deferred | §8.2 | 200 |
| `GET marketing/videos` | deferred | §9.1, §9.6 | 200 |
| `GET marketing/video` | deferred | §9.1, §9.6 | 200 |
| `POST marketing/videos/approve` | deferred | §9.1, §9.6, §4 trap 17 | 200 |
| `POST marketing/videos/reject` | deferred | §9.1, §9.6, §4 trap 17 | 200 |
| `POST marketing/videos/edit` | deferred | §9.6 | 202 |
| `POST marketing/videos/hold-choice` | deferred | §9.1 step 7 | 200 |
| `POST marketing/videos/recut` | deferred | §9.1 step 6 | 202 |
| `POST marketing/videos/retry` | deferred | §9.1 (failed -> last_good_status) | 202 |
| `POST marketing/videos/assign` | deferred | §9.1 step 5 (unmatched takes) | 202 |
| `GET marketing/map` | deferred | §13 | 200 |
| `GET marketing/pages/suggestions` | deferred | §14 | 200 |
| `POST marketing/pages/choose` | deferred | §14 steps 2-3 | 200 |
| `POST marketing/pages/fix-it` | deferred | §14 step 3 | 200 |
| `POST marketing/pages/push-live` | deferred | §14 step 3 | 200 |

## 6. Routes built in this pass

### 6.1 Settings and funnels (U03, spec §6 step 3)

#### `GET marketing/settings`

**Owner:** U03 · **Spec:** §6 step 3, §8.3 Settings · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{settings:{org_id, enabled, batch_weekday, batch_time, timezone, scripts_per_day, days_per_batch, size_rule, format_style, draft_expiry_days, winner_rule, ad_number_floor, next_overrides, max_batch_cost_usd, max_month_cost_usd, submagic_template, caption_position_y, magic_zooms, clean_audio, caption_dictionary, animation_mode, flip_horizontal, settle_minutes, quiet_start, quiet_end, updated_at, updated_by}}`

**Errors:** only the common ones in section 2.

- The first read makes the org's row with the spec §6 step 3 defaults: enabled false, Monday (1) at 07:00 America/Phoenix, 3 a day for 7 days, size rule `total`, number floor 91, caps $40 a batch and $300 a month.
- `batch_time`, `quiet_start` and `quiet_end` are `HH:MM` in `timezone`.
- `winner_rule`, `next_overrides` and `caption_position_y` are null until someone sets them (null means not set).
- `updated_by` is null until a person saves.

**Example**

```json
{
  "request": {},
  "response": {
    "settings": {
      "org_id": "00000000-0000-4000-8000-000000000001",
      "enabled": false,
      "batch_weekday": 1,
      "batch_time": "07:00",
      "timezone": "America/Phoenix",
      "scripts_per_day": 3,
      "days_per_batch": 7,
      "size_rule": "total",
      "format_style": {
        "standard": "bullets",
        "sorting": "words",
        "long": "words",
        "notes": "bullets",
        "greenscreen": "bullets",
        "vsl": "bullets"
      },
      "draft_expiry_days": 14,
      "winner_rule": null,
      "ad_number_floor": 91,
      "next_overrides": null,
      "max_batch_cost_usd": 40,
      "max_month_cost_usd": 300,
      "submagic_template": "Hormozi 2",
      "caption_position_y": null,
      "magic_zooms": false,
      "clean_audio": true,
      "caption_dictionary": [],
      "animation_mode": "fullframe",
      "flip_horizontal": false,
      "settle_minutes": 10,
      "quiet_start": "21:00",
      "quiet_end": "07:00",
      "updated_at": "2026-10-12T15:00:00.000Z",
      "updated_by": null
    }
  }
}
```

#### `POST marketing/settings`

**Owner:** U03 · **Spec:** §6 step 3, §8.3 Settings · **Success:** 200 · **Guard:** `updated_at` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, updated_at, patch}`

**Response:** `{settings:{org_id, enabled, batch_weekday, batch_time, timezone, scripts_per_day, days_per_batch, size_rule, format_style, draft_expiry_days, winner_rule, ad_number_floor, next_overrides, max_batch_cost_usd, max_month_cost_usd, submagic_template, caption_position_y, magic_zooms, clean_audio, caption_dictionary, animation_mode, flip_horizontal, settle_minutes, quiet_start, quiet_end, updated_at, updated_by}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `updated_at` | updated_at is missing |
| 400 | `invalid` | `<the patch key>` | an unknown key, or a bad value (enum, weekday 0-6, HH:MM time, positive whole number); field names the key inside patch |
| 409 | `stale` | none | updated_at is older than the saved row; current is the saved settings object |

- `patch` holds only the keys that change: any settings key except `org_id`, `updated_at` and `updated_by`.
- Send the `updated_at` from the last read. If the saved row is newer, the answer is 409 with the saved settings object as `current`.
- `enabled` is turned on only by Chris's tap in Settings. No agent sends it.
- The answer is the whole saved settings object.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c001",
    "updated_at": "2026-10-12T15:00:00.000Z",
    "patch": { "batch_time": "06:30" }
  },
  "response": {
    "settings": {
      "org_id": "00000000-0000-4000-8000-000000000001",
      "enabled": false,
      "batch_weekday": 1,
      "batch_time": "06:30",
      "timezone": "America/Phoenix",
      "scripts_per_day": 3,
      "days_per_batch": 7,
      "size_rule": "total",
      "format_style": {
        "standard": "bullets",
        "sorting": "words",
        "long": "words",
        "notes": "bullets",
        "greenscreen": "bullets",
        "vsl": "bullets"
      },
      "draft_expiry_days": 14,
      "winner_rule": null,
      "ad_number_floor": 91,
      "next_overrides": null,
      "max_batch_cost_usd": 40,
      "max_month_cost_usd": 300,
      "submagic_template": "Hormozi 2",
      "caption_position_y": null,
      "magic_zooms": false,
      "clean_audio": true,
      "caption_dictionary": [],
      "animation_mode": "fullframe",
      "flip_horizontal": false,
      "settle_minutes": 10,
      "quiet_start": "21:00",
      "quiet_end": "07:00",
      "updated_at": "2026-10-12T15:01:00.000Z",
      "updated_by": "00000000-0000-4000-8000-000000000002"
    }
  }
}
```

#### `GET marketing/funnels`

**Owner:** U03 · **Spec:** §6 step 3, §8.3 Settings · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{funnels:[{id, key, name, landing_url, offer_key, lane, book_call, format_mix, cta_type, meta_campaign_ids, default_ad_set_external_id, weight, active, created_at, updated_at, kind, url, path, tag, utm_campaign, utm_template, campaign, status, live_at, created_by, pages:[{id, position, role, path, url, status, built_at, pushed_at, proved_at, live_url, events_seen, last_event_at}], events_seen}], campaigns:[{external_id, name, status, spend_7d_cents, funnel_key}], ad_sets:[{external_id, name, status, campaign_external_id}], as_of}`

**Errors:** only the common ones in section 2.

- `campaigns` are the synced Meta campaigns with their last 7 Arizona days of spend. `spend_7d_cents` is null when no ad-days are saved, never 0. `funnel_key` is the funnel whose `meta_campaign_ids` holds that campaign, else null.
- `ad_sets` feed the default ad set picker.
- `format_mix` holds weights (2 standard to 1 sorting), not a 0..1 ratio. `weight` is a JSON number.
- `as_of` is the last Meta sync.
- Funnels the dashboard builds (X4, migration 425) carry `kind: "book_a_call"`, their address `path`, the `tag` every event carries (it never changes), `utm_campaign` (the lane), `status` draft or live, and `pages` (landing, booking, thank-you) with each page's `status` (empty, built, pushed, live), `url` and `events_seen`. A funnel mapped by hand here has `kind`, `path` and `tag` null, `status` "live", `pages` [] and `events_seen` null (unknown). `url` is the funnel's address; `utm_template` is the url_tags every ad for it carries (`{ad_number}` filled in at load).

**Example**

```json
{
  "request": {},
  "response": {
    "funnels": [
      {
        "id": "00000000-0000-4000-8000-000000000601",
        "key": "book_call",
        "name": "Book a call",
        "landing_url": "https://apply.fundhub.ai/watch",
        "offer_key": "funding_dfy",
        "lane": "sorting",
        "book_call": true,
        "format_mix": {
          "standard": 2,
          "sorting": 1
        },
        "cta_type": "LEARN_MORE",
        "meta_campaign_ids": [],
        "default_ad_set_external_id": null,
        "weight": 1,
        "active": true,
        "created_at": "2026-10-06T18:00:00.000Z",
        "updated_at": "2026-10-06T18:00:00.000Z",
        "kind": null,
        "url": "https://apply.fundhub.ai/watch",
        "path": null,
        "tag": null,
        "utm_campaign": null,
        "utm_template": "utm_source=fb&utm_medium=paid&utm_campaign=sorting&utm_content={ad_number}",
        "campaign": null,
        "status": "live",
        "live_at": null,
        "created_by": null,
        "pages": [],
        "events_seen": null
      },
      {
        "id": "00000000-0000-4000-8000-000000000602",
        "key": "roadmap_147",
        "name": "Roadmap $147",
        "landing_url": "https://apply.fundhub.ai/roadmap",
        "offer_key": "slo_roadmap",
        "lane": "uwiq",
        "book_call": false,
        "format_mix": {
          "standard": 1
        },
        "cta_type": "LEARN_MORE",
        "meta_campaign_ids": [],
        "default_ad_set_external_id": null,
        "weight": 1,
        "active": true,
        "created_at": "2026-10-06T18:00:00.000Z",
        "updated_at": "2026-10-06T18:00:00.000Z",
        "kind": null,
        "url": "https://apply.fundhub.ai/roadmap",
        "path": null,
        "tag": null,
        "utm_campaign": null,
        "utm_template": "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content={ad_number}",
        "campaign": null,
        "status": "live",
        "live_at": null,
        "created_by": null,
        "pages": [],
        "events_seen": null
      },
      {
        "id": "00000000-0000-4000-8000-000000000603",
        "key": "blueprint",
        "name": "Capital Blueprint book a call",
        "landing_url": "https://apply.fundhub.ai/blueprint",
        "offer_key": "capital_blueprint",
        "lane": "uwiq",
        "book_call": true,
        "format_mix": {},
        "cta_type": "LEARN_MORE",
        "meta_campaign_ids": [],
        "default_ad_set_external_id": null,
        "weight": 1,
        "active": true,
        "created_at": "2026-10-12T15:10:00.000Z",
        "updated_at": "2026-10-12T16:00:21.000Z",
        "kind": "book_a_call",
        "url": "https://apply.fundhub.ai/blueprint",
        "path": "/blueprint",
        "tag": "fnl-blueprint",
        "utm_campaign": "uwiq",
        "utm_template": "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content={ad_number}",
        "campaign": null,
        "status": "live",
        "live_at": "2026-10-12T16:00:21.000Z",
        "created_by": "00000000-0000-4000-8000-000000000002",
        "pages": [
          {
            "id": "00000000-0000-4000-8000-000000000611",
            "position": 1,
            "role": "landing",
            "path": "/blueprint",
            "url": "https://apply.fundhub.ai/blueprint",
            "status": "live",
            "built_at": "2026-10-12T15:20:00.000Z",
            "pushed_at": "2026-10-12T16:00:00.000Z",
            "proved_at": "2026-10-12T16:00:20.000Z",
            "live_url": "https://apply.fundhub.ai/blueprint",
            "events_seen": 12,
            "last_event_at": "2026-10-12T18:30:00.000Z"
          },
          {
            "id": "00000000-0000-4000-8000-000000000612",
            "position": 2,
            "role": "booking",
            "path": "/blueprint-book",
            "url": "https://apply.fundhub.ai/blueprint-book",
            "status": "live",
            "built_at": "2026-10-12T15:20:00.000Z",
            "pushed_at": "2026-10-12T16:00:00.000Z",
            "proved_at": "2026-10-12T16:00:20.000Z",
            "live_url": "https://apply.fundhub.ai/blueprint-book",
            "events_seen": 4,
            "last_event_at": "2026-10-12T18:30:00.000Z"
          },
          {
            "id": "00000000-0000-4000-8000-000000000613",
            "position": 3,
            "role": "thank_you",
            "path": "/blueprint-thank-you",
            "url": "https://apply.fundhub.ai/blueprint-thank-you",
            "status": "live",
            "built_at": "2026-10-12T15:20:00.000Z",
            "pushed_at": "2026-10-12T16:00:00.000Z",
            "proved_at": "2026-10-12T16:00:20.000Z",
            "live_url": "https://apply.fundhub.ai/blueprint-thank-you",
            "events_seen": 1,
            "last_event_at": "2026-10-12T18:30:00.000Z"
          }
        ],
        "events_seen": 17
      }
    ],
    "campaigns": [
      {
        "external_id": "120210000000000001",
        "name": "Roadmap ads (example)",
        "status": "ACTIVE",
        "spend_7d_cents": 41200,
        "funnel_key": null
      },
      {
        "external_id": "120210000000000002",
        "name": "Book a call ads (example)",
        "status": "PAUSED",
        "spend_7d_cents": null,
        "funnel_key": null
      }
    ],
    "ad_sets": [
      {
        "external_id": "120210000000000101",
        "name": "Roadmap broad (example)",
        "status": "ACTIVE",
        "campaign_external_id": "120210000000000001"
      },
      {
        "external_id": "120210000000000102",
        "name": "Book a call broad (example)",
        "status": "PAUSED",
        "campaign_external_id": "120210000000000002"
      }
    ],
    "as_of": "2026-10-12T07:01:50.000Z"
  }
}
```

#### `POST marketing/funnels`

**Owner:** U03 · **Spec:** §6 step 3, §8.3 Settings · **Success:** 200 · **Guard:** `updated_at` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, funnel:{key, updated_at?}}`

**Response:** `{funnel:{id, key, name, landing_url, offer_key, lane, book_call, format_mix, cta_type, meta_campaign_ids, default_ad_set_external_id, weight, active, created_at, updated_at, kind, url, path, tag, utm_campaign, utm_template, campaign, status, live_at, created_by, pages:[{id, position, role, path, url, status, built_at, pushed_at, proved_at, live_url, events_seen, last_event_at}], events_seen}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `funnel.key` | key is missing or not lower-case letters, digits and _ |
| 400 | `invalid` | `funnel.<key>` | an unknown field, or a bad value (lane not an ad lane, a landing_url that is not https, a negative weight) |
| 409 | `stale` | none | updated_at is older than the saved funnel; current is the saved funnel |

- Saves by `key`: a new key adds a funnel, a known key changes it. Send `key` plus only the fields that change.
- When changing a funnel that exists, send its `updated_at`. An older one gets 409 with the saved funnel as `current`. A new key needs no `updated_at`.
- Mapping a campaign to a funnel means adding the campaign's external id to `meta_campaign_ids`.
- A funnel built on the dashboard (kind set) refuses a change to landing_url, lane, offer_key or book_call here (400 on that field): its pages were written for them. Rename it with POST marketing/funnels/rename.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c002",
    "funnel": {
      "key": "roadmap_147",
      "meta_campaign_ids": [
        "120210000000000001"
      ],
      "default_ad_set_external_id": "120210000000000101",
      "updated_at": "2026-10-06T18:00:00.000Z"
    }
  },
  "response": {
    "funnel": {
      "id": "00000000-0000-4000-8000-000000000602",
      "key": "roadmap_147",
      "name": "Roadmap $147",
      "landing_url": "https://apply.fundhub.ai/roadmap",
      "offer_key": "slo_roadmap",
      "lane": "uwiq",
      "book_call": false,
      "format_mix": {
        "standard": 1
      },
      "cta_type": "LEARN_MORE",
      "meta_campaign_ids": [
        "120210000000000001"
      ],
      "default_ad_set_external_id": "120210000000000101",
      "weight": 1,
      "active": true,
      "created_at": "2026-10-06T18:00:00.000Z",
      "updated_at": "2026-10-12T15:05:00.000Z",
      "kind": null,
      "url": "https://apply.fundhub.ai/roadmap",
      "path": null,
      "tag": null,
      "utm_campaign": null,
      "utm_template": "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content={ad_number}",
      "campaign": null,
      "status": "live",
      "live_at": null,
      "created_by": null,
      "pages": [],
      "events_seen": null
    }
  }
}
```

### 6.2 Script actions (U25, spec §7.8 and §7.9)

#### `GET marketing/scripts`

**Owner:** U25 · **Spec:** §7.8 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{status?, batch?}`

**Response:** `{scripts:[S], as_of}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `status` | status is not draft, locked, rejected, filmed, superseded or expired |
| 400 | `invalid` | `batch` | batch is not a uuid |

- `status` filters to one status. `batch` filters to one batch id. With neither, every live version the screens may see.
- The list hides source `import` rows and the drafts of batches that are not released yet (spec §7.4, §7.7).
- Each item is the Script object S (section 4).
- `as_of` is when the answer was built (this read shows no Meta numbers).

**Example**

```json
{
  "request": { "status": "draft" },
  "response": {
    "scripts": [
      {
        "id": "00000000-0000-4000-8000-000000000101",
        "root_script_id": "00000000-0000-4000-8000-000000000101",
        "version": 1,
        "status": "draft",
        "ad_id": null,
        "title": "Lenders read two files",
        "body": "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see what both files say today.",
        "parts": [
          { "kind": "hook", "text": "MOST lenders read TWO files before they say yes." },
          { "kind": "line2", "text": "If one is a mess, they never open the other." },
          { "kind": "cue", "text": "the personal file" },
          { "kind": "cue", "text": "the business file" },
          { "kind": "cue", "text": "which one they read first" },
          { "kind": "reveal", "text": "We check both before you apply anywhere." },
          { "kind": "cta", "text": "Tap below and see what both files say today." }
        ],
        "script_format": "standard",
        "style": "bullets",
        "funnel_key": "roadmap_147",
        "angle_key": "two-files",
        "hook_key": "two-files-lenders-read",
        "offer_key": "slo_roadmap",
        "lane": "uwiq",
        "batch_id": "00000000-0000-4000-8000-000000000301",
        "idea_id": "00000000-0000-4000-8000-000000000401",
        "source": "machine",
        "check_results": {
          "strict": { "passed": true, "rounds": 1, "failures": [] },
          "judge": { "passed": true, "notes": [] },
          "compliance": { "state": "passed", "reasons": [] }
        },
        "flagged": false,
        "fix_note": null,
        "animation_plan": [
          {
            "anchor": { "cue": 1, "keyword": "personal" },
            "template": "FileItems",
            "props": {},
            "seconds": 2.5
          },
          {
            "anchor": { "cue": 3, "keyword": "first" },
            "template": "StepPath",
            "props": {},
            "seconds": 3
          }
        ],
        "meta_copy": {
          "primary_text": "Lenders read two files before they say yes. See what both of yours say before you apply.",
          "headline": "See both files first",
          "description": "Your Funding Roadmap",
          "cta_type": "LEARN_MORE"
        },
        "film_order": null,
        "needs_retake": false,
        "locked_at": null,
        "locked_by": null,
        "rejected_at": null,
        "rejected_reason": null,
        "filmed_at": null,
        "repo_path": "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md",
        "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
        "created_at": "2026-10-12T11:12:40.000Z",
        "updated_at": "2026-10-12T11:12:40.000Z"
      },
      {
        "id": "00000000-0000-4000-8000-000000000201",
        "root_script_id": "00000000-0000-4000-8000-000000000201",
        "version": 1,
        "status": "draft",
        "ad_id": null,
        "title": "Inquiries off first",
        "body": "Every hard pull you did not need is still sitting on your file.\n\nAnd lenders count them.",
        "parts": [
          { "kind": "hook", "text": "Every hard pull you did not need is still sitting on your file." },
          { "kind": "line2", "text": "And lenders count them." }
        ],
        "script_format": "sorting",
        "style": "words",
        "funnel_key": "book_call",
        "angle_key": "inquiries-off",
        "hook_key": "inquiries-off-hard-pulls",
        "offer_key": "funding_dfy",
        "lane": "sorting",
        "batch_id": "00000000-0000-4000-8000-000000000301",
        "idea_id": null,
        "source": "machine",
        "check_results": {
          "strict": { "passed": true, "rounds": 1, "failures": [] },
          "judge": { "passed": true, "notes": [] },
          "compliance": { "state": "passed", "reasons": [] }
        },
        "flagged": false,
        "fix_note": null,
        "animation_plan": [
          {
            "anchor": { "phrase": "lenders count them" },
            "template": "InquiriesOff",
            "props": {},
            "seconds": 2.5
          }
        ],
        "meta_copy": {
          "primary_text": "Every hard pull you did not need is still on your file. Lenders count them.",
          "headline": "Lenders count your pulls",
          "description": "Book a call",
          "cta_type": "LEARN_MORE"
        },
        "film_order": null,
        "needs_retake": false,
        "locked_at": null,
        "locked_by": null,
        "rejected_at": null,
        "rejected_reason": null,
        "filmed_at": null,
        "repo_path": "marketing/ads/scripts/machine/2026-W42/04-inquiries-off-first.md",
        "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
        "created_at": "2026-10-12T11:12:40.000Z",
        "updated_at": "2026-10-12T11:12:40.000Z"
      }
    ],
    "as_of": "2026-10-12T15:04:05.000Z"
  }
}
```

#### `GET marketing/script`

**Owner:** U25 · **Spec:** §7.8 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{id}`

**Response:** `{script:S, versions:[S]}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `id` | id is missing or not a uuid |
| 404 | `not_found` | none | no script with that id in the caller's org |

- `script` is the row `id` names. `versions` is every version with the same `root_script_id`, newest first, the live one included, each with its `check_results`.

**Example**

```json
{
  "request": { "id": "00000000-0000-4000-8000-000000000102" },
  "response": {
    "script": {
      "id": "00000000-0000-4000-8000-000000000102",
      "root_script_id": "00000000-0000-4000-8000-000000000101",
      "version": 2,
      "status": "draft",
      "ad_id": null,
      "title": "Lenders read two files",
      "body": "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see your number today.",
      "parts": [
        { "kind": "hook", "text": "MOST lenders read TWO files before they say yes." },
        { "kind": "line2", "text": "If one is a mess, they never open the other." },
        { "kind": "cue", "text": "the personal file" },
        { "kind": "cue", "text": "the business file" },
        { "kind": "cue", "text": "which one they read first" },
        { "kind": "reveal", "text": "We check both before you apply anywhere." },
        { "kind": "cta", "text": "Tap below and see your number today." }
      ],
      "script_format": "standard",
      "style": "bullets",
      "funnel_key": "roadmap_147",
      "angle_key": "two-files",
      "hook_key": "two-files-lenders-read",
      "offer_key": "slo_roadmap",
      "lane": "uwiq",
      "batch_id": "00000000-0000-4000-8000-000000000301",
      "idea_id": "00000000-0000-4000-8000-000000000401",
      "source": "machine",
      "check_results": {
        "strict": { "passed": true, "rounds": 1, "failures": [] },
        "judge": { "passed": true, "notes": [] },
        "compliance": { "state": "passed", "reasons": [] }
      },
      "flagged": false,
      "fix_note": null,
      "animation_plan": [
        {
          "anchor": { "cue": 1, "keyword": "personal" },
          "template": "FileItems",
          "props": {},
          "seconds": 2.5
        },
        {
          "anchor": { "cue": 3, "keyword": "first" },
          "template": "StepPath",
          "props": {},
          "seconds": 3
        }
      ],
      "meta_copy": {
        "primary_text": "Lenders read two files before they say yes. See what both of yours say before you apply.",
        "headline": "See both files first",
        "description": "Your Funding Roadmap",
        "cta_type": "LEARN_MORE"
      },
      "film_order": null,
      "needs_retake": false,
      "locked_at": null,
      "locked_by": null,
      "rejected_at": null,
      "rejected_reason": null,
      "filmed_at": null,
      "repo_path": "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md",
      "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
      "created_at": "2026-10-12T15:07:00.000Z",
      "updated_at": "2026-10-12T15:07:00.000Z"
    },
    "versions": [
      {
        "id": "00000000-0000-4000-8000-000000000102",
        "root_script_id": "00000000-0000-4000-8000-000000000101",
        "version": 2,
        "status": "draft",
        "ad_id": null,
        "title": "Lenders read two files",
        "body": "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see your number today.",
        "parts": [
          { "kind": "hook", "text": "MOST lenders read TWO files before they say yes." },
          { "kind": "line2", "text": "If one is a mess, they never open the other." },
          { "kind": "cue", "text": "the personal file" },
          { "kind": "cue", "text": "the business file" },
          { "kind": "cue", "text": "which one they read first" },
          { "kind": "reveal", "text": "We check both before you apply anywhere." },
          { "kind": "cta", "text": "Tap below and see your number today." }
        ],
        "script_format": "standard",
        "style": "bullets",
        "funnel_key": "roadmap_147",
        "angle_key": "two-files",
        "hook_key": "two-files-lenders-read",
        "offer_key": "slo_roadmap",
        "lane": "uwiq",
        "batch_id": "00000000-0000-4000-8000-000000000301",
        "idea_id": "00000000-0000-4000-8000-000000000401",
        "source": "machine",
        "check_results": {
          "strict": { "passed": true, "rounds": 1, "failures": [] },
          "judge": { "passed": true, "notes": [] },
          "compliance": { "state": "passed", "reasons": [] }
        },
        "flagged": false,
        "fix_note": null,
        "animation_plan": [
          {
            "anchor": { "cue": 1, "keyword": "personal" },
            "template": "FileItems",
            "props": {},
            "seconds": 2.5
          },
          {
            "anchor": { "cue": 3, "keyword": "first" },
            "template": "StepPath",
            "props": {},
            "seconds": 3
          }
        ],
        "meta_copy": {
          "primary_text": "Lenders read two files before they say yes. See what both of yours say before you apply.",
          "headline": "See both files first",
          "description": "Your Funding Roadmap",
          "cta_type": "LEARN_MORE"
        },
        "film_order": null,
        "needs_retake": false,
        "locked_at": null,
        "locked_by": null,
        "rejected_at": null,
        "rejected_reason": null,
        "filmed_at": null,
        "repo_path": "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md",
        "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
        "created_at": "2026-10-12T15:07:00.000Z",
        "updated_at": "2026-10-12T15:07:00.000Z"
      },
      {
        "id": "00000000-0000-4000-8000-000000000101",
        "root_script_id": "00000000-0000-4000-8000-000000000101",
        "version": 1,
        "status": "superseded",
        "ad_id": null,
        "title": "Lenders read two files",
        "body": "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see what both files say today.",
        "parts": [
          { "kind": "hook", "text": "MOST lenders read TWO files before they say yes." },
          { "kind": "line2", "text": "If one is a mess, they never open the other." },
          { "kind": "cue", "text": "the personal file" },
          { "kind": "cue", "text": "the business file" },
          { "kind": "cue", "text": "which one they read first" },
          { "kind": "reveal", "text": "We check both before you apply anywhere." },
          { "kind": "cta", "text": "Tap below and see what both files say today." }
        ],
        "script_format": "standard",
        "style": "bullets",
        "funnel_key": "roadmap_147",
        "angle_key": "two-files",
        "hook_key": "two-files-lenders-read",
        "offer_key": "slo_roadmap",
        "lane": "uwiq",
        "batch_id": "00000000-0000-4000-8000-000000000301",
        "idea_id": "00000000-0000-4000-8000-000000000401",
        "source": "machine",
        "check_results": {
          "strict": { "passed": true, "rounds": 1, "failures": [] },
          "judge": { "passed": true, "notes": [] },
          "compliance": { "state": "passed", "reasons": [] }
        },
        "flagged": false,
        "fix_note": null,
        "animation_plan": [
          {
            "anchor": { "cue": 1, "keyword": "personal" },
            "template": "FileItems",
            "props": {},
            "seconds": 2.5
          },
          {
            "anchor": { "cue": 3, "keyword": "first" },
            "template": "StepPath",
            "props": {},
            "seconds": 3
          }
        ],
        "meta_copy": {
          "primary_text": "Lenders read two files before they say yes. See what both of yours say before you apply.",
          "headline": "See both files first",
          "description": "Your Funding Roadmap",
          "cta_type": "LEARN_MORE"
        },
        "film_order": null,
        "needs_retake": false,
        "locked_at": null,
        "locked_by": null,
        "rejected_at": null,
        "rejected_reason": null,
        "filmed_at": null,
        "repo_path": "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md",
        "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
        "created_at": "2026-10-12T11:12:40.000Z",
        "updated_at": "2026-10-12T15:07:00.000Z"
      }
    ]
  }
}
```

#### `POST marketing/scripts/approve`

**Owner:** U25 · **Spec:** §7.8, §7.4, §4 trap 17 · **Success:** 200 · **Guard:** `version` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, version}`

**Response:** `{script:S, ad_number, registry, registry_note}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `id` | id is not a uuid, or the script is rejected or expired |
| 404 | `not_found` | none | no script with that id in the caller's org |
| 409 | `stale` | none | version is not the live version; current is {version, body, parts} of the live one |

- Locks the script and gives it the next ad number (`next_ad_number`, 91 or higher), once. A script that already has a number keeps it, and a second approve answers the same number.
- `registry` is `queued` when the script's lane has a rule in `registry.json` (an outbox edit is waiting). It is `skipped`, with a plain `registry_note`, when the lane has none (lane `slo` has none). It never blocks the approve.
- Stores Chris's staff id in `locked_by`. Only a person approves.
- The script's repo file is queued through the outbox in the same transaction.
- `ad_number` is a string of digits, the same as `script.ad_id`.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c003",
    "id": "00000000-0000-4000-8000-000000000101",
    "version": 1
  },
  "response": {
    "script": {
      "id": "00000000-0000-4000-8000-000000000101",
      "root_script_id": "00000000-0000-4000-8000-000000000101",
      "version": 1,
      "status": "locked",
      "ad_id": "91",
      "title": "Lenders read two files",
      "body": "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see what both files say today.",
      "parts": [
        { "kind": "hook", "text": "MOST lenders read TWO files before they say yes." },
        { "kind": "line2", "text": "If one is a mess, they never open the other." },
        { "kind": "cue", "text": "the personal file" },
        { "kind": "cue", "text": "the business file" },
        { "kind": "cue", "text": "which one they read first" },
        { "kind": "reveal", "text": "We check both before you apply anywhere." },
        { "kind": "cta", "text": "Tap below and see what both files say today." }
      ],
      "script_format": "standard",
      "style": "bullets",
      "funnel_key": "roadmap_147",
      "angle_key": "two-files",
      "hook_key": "two-files-lenders-read",
      "offer_key": "slo_roadmap",
      "lane": "uwiq",
      "batch_id": "00000000-0000-4000-8000-000000000301",
      "idea_id": "00000000-0000-4000-8000-000000000401",
      "source": "machine",
      "check_results": {
        "strict": { "passed": true, "rounds": 1, "failures": [] },
        "judge": { "passed": true, "notes": [] },
        "compliance": { "state": "passed", "reasons": [] }
      },
      "flagged": false,
      "fix_note": null,
      "animation_plan": [
        {
          "anchor": { "cue": 1, "keyword": "personal" },
          "template": "FileItems",
          "props": {},
          "seconds": 2.5
        },
        {
          "anchor": { "cue": 3, "keyword": "first" },
          "template": "StepPath",
          "props": {},
          "seconds": 3
        }
      ],
      "meta_copy": {
        "primary_text": "Lenders read two files before they say yes. See what both of yours say before you apply.",
        "headline": "See both files first",
        "description": "Your Funding Roadmap",
        "cta_type": "LEARN_MORE"
      },
      "film_order": null,
      "needs_retake": false,
      "locked_at": "2026-10-12T15:06:00.000Z",
      "locked_by": "00000000-0000-4000-8000-000000000002",
      "rejected_at": null,
      "rejected_reason": null,
      "filmed_at": null,
      "repo_path": "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md",
      "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
      "created_at": "2026-10-12T11:12:40.000Z",
      "updated_at": "2026-10-12T15:06:00.000Z"
    },
    "ad_number": "91",
    "registry": "queued",
    "registry_note": null
  }
}
```

#### `POST marketing/scripts/edit`

**Owner:** U25 · **Spec:** §7.8, §7.2, §4 trap 9 · **Success:** 200 · **Guard:** `version` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, version, body, parts?, meta_copy?}`

**Response:** `{script:S, warnings:[{rule, message}]}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `body` | body is missing or empty |
| 400 | `invalid` | `parts` | parts is not a list of {kind, text} with kind hook, line2, body, cue, reveal or cta |
| 404 | `not_found` | none | no script with that id in the caller's org |
| 409 | `stale` | none | version is not the live version; current is {version, body, parts} of the live one |

- Saves a new version and keeps the old one (archived, status `superseded`) in one transaction. Both share `root_script_id`. A locked script keeps its number.
- `body` is required. Send `parts` and `meta_copy` when they change.
- `warnings` are checker results. They never block Chris's save.
- Saves voice pairs for the machine lines Chris changed, and queues the repo file.
- The answer's `script` has a new `id` and the next `version`.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c004",
    "id": "00000000-0000-4000-8000-000000000101",
    "version": 1,
    "body": "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see your number today.",
    "parts": [
      { "kind": "hook", "text": "MOST lenders read TWO files before they say yes." },
      { "kind": "line2", "text": "If one is a mess, they never open the other." },
      { "kind": "cue", "text": "the personal file" },
      { "kind": "cue", "text": "the business file" },
      { "kind": "cue", "text": "which one they read first" },
      { "kind": "reveal", "text": "We check both before you apply anywhere." },
      { "kind": "cta", "text": "Tap below and see your number today." }
    ]
  },
  "response": {
    "script": {
      "id": "00000000-0000-4000-8000-000000000102",
      "root_script_id": "00000000-0000-4000-8000-000000000101",
      "version": 2,
      "status": "draft",
      "ad_id": null,
      "title": "Lenders read two files",
      "body": "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see your number today.",
      "parts": [
        { "kind": "hook", "text": "MOST lenders read TWO files before they say yes." },
        { "kind": "line2", "text": "If one is a mess, they never open the other." },
        { "kind": "cue", "text": "the personal file" },
        { "kind": "cue", "text": "the business file" },
        { "kind": "cue", "text": "which one they read first" },
        { "kind": "reveal", "text": "We check both before you apply anywhere." },
        { "kind": "cta", "text": "Tap below and see your number today." }
      ],
      "script_format": "standard",
      "style": "bullets",
      "funnel_key": "roadmap_147",
      "angle_key": "two-files",
      "hook_key": "two-files-lenders-read",
      "offer_key": "slo_roadmap",
      "lane": "uwiq",
      "batch_id": "00000000-0000-4000-8000-000000000301",
      "idea_id": "00000000-0000-4000-8000-000000000401",
      "source": "machine",
      "check_results": {
        "strict": { "passed": true, "rounds": 1, "failures": [] },
        "judge": { "passed": true, "notes": [] },
        "compliance": { "state": "passed", "reasons": [] }
      },
      "flagged": false,
      "fix_note": null,
      "animation_plan": [
        {
          "anchor": { "cue": 1, "keyword": "personal" },
          "template": "FileItems",
          "props": {},
          "seconds": 2.5
        },
        {
          "anchor": { "cue": 3, "keyword": "first" },
          "template": "StepPath",
          "props": {},
          "seconds": 3
        }
      ],
      "meta_copy": {
        "primary_text": "Lenders read two files before they say yes. See what both of yours say before you apply.",
        "headline": "See both files first",
        "description": "Your Funding Roadmap",
        "cta_type": "LEARN_MORE"
      },
      "film_order": null,
      "needs_retake": false,
      "locked_at": null,
      "locked_by": null,
      "rejected_at": null,
      "rejected_reason": null,
      "filmed_at": null,
      "repo_path": "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md",
      "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
      "created_at": "2026-10-12T15:07:00.000Z",
      "updated_at": "2026-10-12T15:07:00.000Z"
    },
    "warnings": [
      {
        "rule": "your number",
        "message": "Chris's rules (Part 0) ban \"your number\". Saved anyway, because a person wrote it."
      }
    ]
  }
}
```

#### `POST marketing/scripts/reject`

**Owner:** U25 · **Spec:** §7.8, §4 trap 17 · **Success:** 200 · **Guard:** `version` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, version, reason?}`

**Response:** `{script:S}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `id` | id is not a uuid, or the script is not a draft |
| 404 | `not_found` | none | no script with that id in the caller's org |
| 409 | `stale` | none | version is not the live version; current is {version, body, parts} of the live one |

- Only a draft can be rejected (spec §7.4 status moves).
- `reason` is optional. With none, the stored reason is `rejected from the app, no reason given`.
- Stores Chris's staff id (`rejected_by`).

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c005",
    "id": "00000000-0000-4000-8000-000000000201",
    "version": 1
  },
  "response": {
    "script": {
      "id": "00000000-0000-4000-8000-000000000201",
      "root_script_id": "00000000-0000-4000-8000-000000000201",
      "version": 1,
      "status": "rejected",
      "ad_id": null,
      "title": "Inquiries off first",
      "body": "Every hard pull you did not need is still sitting on your file.\n\nAnd lenders count them.",
      "parts": [
        { "kind": "hook", "text": "Every hard pull you did not need is still sitting on your file." },
        { "kind": "line2", "text": "And lenders count them." }
      ],
      "script_format": "sorting",
      "style": "words",
      "funnel_key": "book_call",
      "angle_key": "inquiries-off",
      "hook_key": "inquiries-off-hard-pulls",
      "offer_key": "funding_dfy",
      "lane": "sorting",
      "batch_id": "00000000-0000-4000-8000-000000000301",
      "idea_id": null,
      "source": "machine",
      "check_results": {
        "strict": { "passed": true, "rounds": 1, "failures": [] },
        "judge": { "passed": true, "notes": [] },
        "compliance": { "state": "passed", "reasons": [] }
      },
      "flagged": false,
      "fix_note": null,
      "animation_plan": [
        {
          "anchor": { "phrase": "lenders count them" },
          "template": "InquiriesOff",
          "props": {},
          "seconds": 2.5
        }
      ],
      "meta_copy": {
        "primary_text": "Every hard pull you did not need is still on your file. Lenders count them.",
        "headline": "Lenders count your pulls",
        "description": "Book a call",
        "cta_type": "LEARN_MORE"
      },
      "film_order": null,
      "needs_retake": false,
      "locked_at": null,
      "locked_by": null,
      "rejected_at": "2026-10-12T15:08:00.000Z",
      "rejected_reason": "rejected from the app, no reason given",
      "filmed_at": null,
      "repo_path": "marketing/ads/scripts/machine/2026-W42/04-inquiries-off-first.md",
      "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
      "created_at": "2026-10-12T11:12:40.000Z",
      "updated_at": "2026-10-12T15:08:00.000Z"
    }
  }
}
```

#### `POST marketing/scripts/order`

**Owner:** U25 · **Spec:** §7.8, §8.2 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, order:[]}`

**Response:** `{ok}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `order` | order is not a list of uuids, or names a root_script_id the caller's org does not have |

- `order` lists `root_script_id` values in film order. `film_order` follows the list, first = 1.
- No `version`: the film order is not an edit of the script.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c006",
    "order": ["00000000-0000-4000-8000-000000000201", "00000000-0000-4000-8000-000000000101"]
  },
  "response": { "ok": true }
}
```

### 6.3 Fix, ideas, batches, rules and retry (U26, spec §7.8)

#### `POST marketing/scripts/fix`

**Owner:** U26 · **Spec:** §7.8 · **Success:** 202 · **Guard:** `version` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, version, note, make_rule}`

**Response:** `{queued, job_id}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `note` | note is missing or empty |
| 400 | `invalid` | `make_rule` | make_rule is not true or false |
| 404 | `not_found` | none | no script with that id in the caller's org |
| 409 | `stale` | none | version is not the live version; current is {version, body, parts} of the live one |

- Answers at once (202). The `fix_script` job rewrites the script from Chris's note and saves a new version. Read `GET marketing/script` to see it.
- `make_rule: true` also queues the note as a new Part 0 rule (an outbox edit).
- The note goes to the writer as Chris typed it.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c007",
    "id": "00000000-0000-4000-8000-000000000101",
    "version": 1,
    "note": "Make the hook about the business file, not the personal one.",
    "make_rule": false
  },
  "response": { "queued": true, "job_id": "00000000-0000-4000-8000-000000000505" }
}
```

#### `POST marketing/ideas`

**Owner:** U26 · **Spec:** §7.8, §7.5 step 7, §8.1 tab 4 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, raw_points, source?, script_format?, funnel_key?, angle_key?, write_now?}`

**Response:** `{idea:{id, source, kind, raw_points, topic, script_format, funnel_key, angle_key, status, script_id, created_at}, batch_id?, job_id?}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `raw_points` | raw_points is missing or empty |
| 400 | `invalid` | `source` | source is not 'chris' or 'suggestion' (the machine never posts here) |
| 400 | `invalid` | `script_format` | not standard, sorting, long, notes, greenscreen or vsl |
| 400 | `invalid` | `funnel_key` | no funnel with that key in the caller's org |

- `source` is `chris` (the default) or `suggestion` (Chris accepted a planner suggestion, spec §7.5 step 7). Never `machine`.
- Each idea also writes one file in `marketing/ads/ideas/` through the outbox.
- `write_now: true` also makes an on-command batch and queues `start_batch` for it; then `batch_id` and `job_id` come back. Left out or false, only `idea` comes back.
- If a model-bill cap is reached, the idea is still saved. `batch_id` and `job_id` are left out, and a plain `note` says why.
- 200, not 202: the idea itself is saved now.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c008",
    "raw_points": "Lenders check the business file too. Show what a clean business file looks like next to a messy one.",
    "script_format": "standard",
    "funnel_key": "roadmap_147",
    "write_now": true
  },
  "response": {
    "idea": {
      "id": "00000000-0000-4000-8000-000000000402",
      "source": "chris",
      "kind": "script",
      "raw_points": "Lenders check the business file too. Show what a clean business file looks like next to a messy one.",
      "topic": null,
      "script_format": "standard",
      "funnel_key": "roadmap_147",
      "angle_key": null,
      "status": "new",
      "script_id": null,
      "created_at": "2026-10-12T15:10:00.000Z"
    },
    "batch_id": "00000000-0000-4000-8000-000000000302",
    "job_id": "00000000-0000-4000-8000-000000000502"
  }
}
```

#### `GET marketing/ideas`

**Owner:** U26 · **Spec:** §7.8, §8.1 tab 4 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{status?}`

**Response:** `{ideas:[{id, source, kind, raw_points, topic, script_format, funnel_key, angle_key, status, script_id, created_at}]}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `status` | status is not new, writing, written, failed or dropped |

- `status` filters. Left out, every status, newest first.

**Example**

```json
{
  "request": {},
  "response": {
    "ideas": [
      {
        "id": "00000000-0000-4000-8000-000000000402",
        "source": "chris",
        "kind": "script",
        "raw_points": "Lenders check the business file too. Show what a clean business file looks like next to a messy one.",
        "topic": null,
        "script_format": "standard",
        "funnel_key": "roadmap_147",
        "angle_key": null,
        "status": "new",
        "script_id": null,
        "created_at": "2026-10-12T15:10:00.000Z"
      },
      {
        "id": "00000000-0000-4000-8000-000000000401",
        "source": "chris",
        "kind": "script",
        "raw_points": "Lenders look at two files. People only ever fix one. Say which one gets read first.",
        "topic": "Lenders read two files",
        "script_format": "standard",
        "funnel_key": "roadmap_147",
        "angle_key": "two-files",
        "status": "written",
        "script_id": "00000000-0000-4000-8000-000000000101",
        "created_at": "2026-10-06T19:30:00.000Z"
      }
    ]
  }
}
```

#### `GET marketing/batches`

**Owner:** U26 · **Spec:** §7.8, §7.4 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{batches:[{id, kind, week_key, status, release_at, released_at, counts:{total, ready, flagged, failed}, error}], write_now_ready}`

**Errors:** only the common ones in section 2.

- Batch history, newest first.
- `counts`: `total` = slots planned; `ready` = drafts saved (flagged ones included); `flagged` = ready drafts marked "needs a look"; `failed` = slots that wrote nothing. Once writing ends, total = ready + failed.
- `write_now_ready` is true only once job kind `start_batch` is registered (U35). While it is false the screens hide Write now, so no dead button ships.

**Example**

```json
{
  "request": {},
  "response": {
    "batches": [
      {
        "id": "00000000-0000-4000-8000-000000000302",
        "kind": "on_command",
        "week_key": "2026-W42",
        "status": "writing",
        "release_at": "2026-10-13T16:20:00.000Z",
        "released_at": null,
        "counts": { "total": 3, "ready": 1, "flagged": 0, "failed": 0 },
        "error": null
      },
      {
        "id": "00000000-0000-4000-8000-000000000301",
        "kind": "weekly",
        "week_key": "2026-W42",
        "status": "released",
        "release_at": "2026-10-12T14:00:00.000Z",
        "released_at": "2026-10-12T14:00:12.000Z",
        "counts": { "total": 21, "ready": 20, "flagged": 2, "failed": 1 },
        "error": null
      }
    ],
    "write_now_ready": true
  }
}
```

#### `POST marketing/batches/write-now`

**Owner:** U26 · **Spec:** §7.8, §2 item 1, §7.7 · **Success:** 202 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, count?, funnel_key?, idea_ids?}`

**Response:** `{queued, batch_id, job_id}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `count` | count is not a whole number of 1 or more |
| 400 | `invalid` | `funnel_key` | no funnel with that key in the caller's org |
| 400 | `invalid` | `idea_ids` | not a list of idea ids of the caller's org |
| 400 | `cap_reached` | none | this batch or this month's model-bill cap is reached (costStatus); nothing is queued |

- Makes an on-command batch (status `planned`, `release_at` now) and queues `start_batch` with `{batch_id, count, funnel_key, idea_ids}`. It releases as soon as it is done (spec §7.7).
- `count` left out = `settings.scripts_per_day`.
- Write now spends model money, so it runs only from Chris's tap. It works even while the weekly schedule (`enabled`) is off.
- `cap_reached`: a plain message says which cap; nothing is queued.

**Example**

```json
{
  "request": { "request_id": "00000000-0000-4000-8000-00000000c009", "count": 3 },
  "response": {
    "queued": true,
    "batch_id": "00000000-0000-4000-8000-000000000302",
    "job_id": "00000000-0000-4000-8000-000000000502"
  }
}
```

#### `GET marketing/rules`

**Owner:** U26 · **Spec:** §7.8, §7.1, §8.1 tab 5 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{rules_sha, part0:[{n, text}], banned:[], recent:[{op_id, action, text, state, committed_sha, at}]}`

**Errors:** only the common ones in section 2.

- `rules_sha` is the commit the rules were read at.
- `part0` is Part 0 of `marketing/ads/RULES.md` as numbered items.
- `banned` is `marketing/ads/banned-live.json`: plain phrases, never patterns.
- `recent` is the latest rule changes from the outbox. `state` is `waiting` (not committed yet), `committed` or `failed`.

**Example**

```json
{
  "request": {},
  "response": {
    "rules_sha": "9c1d4e2f6a8b0c3d5e7f9a1b2c4d6e8f0a1b3c5d",
    "part0": [
      {
        "n": 0,
        "text": "Chris's word beats every rule below. These rules guide the writer, and they are never read so literally that they block what Chris asked for."
      },
      {
        "n": 1,
        "text": "Never write \"credit repair.\" Say \"credit optimization\" or \"optimize your credit.\""
      },
      {
        "n": 2,
        "text": "Never say \"your number\" or \"the number.\" Spell it out, for example: \"how much we think you'll qualify for based on where you're at right now.\""
      }
    ],
    "banned": ["game changer"],
    "recent": [
      {
        "op_id": "00000000-0000-4000-8000-000000000b02",
        "action": "ban",
        "text": "game changer",
        "state": "waiting",
        "committed_sha": null,
        "at": "2026-10-12T15:12:00.000Z"
      },
      {
        "op_id": "00000000-0000-4000-8000-000000000b01",
        "action": "add",
        "text": "Say \"review your file the way a lender does.\"",
        "state": "committed",
        "committed_sha": "9c1d4e2f6a8b0c3d5e7f9a1b2c4d6e8f0a1b3c5d",
        "at": "2026-10-11T22:40:00.000Z"
      }
    ]
  }
}
```

#### `POST marketing/rules`

**Owner:** U26 · **Spec:** §7.8, §7.1, §8.1 tab 5 · **Success:** 202 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, action, n?, text}`

**Response:** `{queued, op_id}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `action` | action is not add, edit or ban |
| 400 | `invalid` | `n` | edit without n, or an n that Part 0 does not have |
| 400 | `invalid` | `text` | text is missing or empty |

- `add` adds a Part 0 rule. `edit` replaces rule `n`. `ban` adds a plain phrase to `banned-live.json`.
- Answers at once (202) with the outbox `op_id`. The change reaches the repo when the outbox drains, and shows under `recent` in `GET marketing/rules`.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c010",
    "action": "ban",
    "text": "game changer"
  },
  "response": { "queued": true, "op_id": "00000000-0000-4000-8000-000000000b02" }
}
```

#### `POST marketing/jobs/retry`

**Owner:** U26 · **Spec:** §8.3 (stuck work with Retry); plan critique M5 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, job_id}`

**Response:** `{ok, job:{id, kind, status}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `job_id` | the job is not failed |
| 404 | `not_found` | none | no such job, another org's job, or a kind not in JOB_KINDS (never 'offer') |

- Puts one failed job of the caller's org back in the queue (attempts 0, error cleared) and wakes the worker.
- Only kinds in `JOB_KINDS`. Never `offer`: the offer writer has its own path.
- Today's `stuck_jobs` carry the ids this route takes.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c011",
    "job_id": "00000000-0000-4000-8000-000000000501"
  },
  "response": {
    "ok": true,
    "job": { "id": "00000000-0000-4000-8000-000000000501", "kind": "write_slot", "status": "queued" }
  }
}
```

### 6.4 The next batch plan (U23, spec §7.5)

#### `GET marketing/batches/next`

**Owner:** U23 · **Spec:** §7.5, §7.8 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{next:{release_at, week_key, enabled, total, size_rule, funnels:[{funnel_key, spend_7d_cents, share, slots}], slots:[{n, funnel_key, script_format, style, source, angle_key, idea_id, reason}], suggestions:[{angle_key, name, why, numbers}], unmapped_spend_cents, overrides}, saved:{batch_id, status}, as_of}`

**Errors:** only the common ones in section 2.

- `next` is a live preview: the planner runs on the current numbers every time.
- `saved` is the next weekly batch once its plan is saved (3 hours before release), else null.
- `funnels`: each funnel's 7-day spend, `share` (0..1) and slot count. `slots`: one per script, each with `source` (`chris_idea`, `follow_money`, `fresh_angle` or `competitor`) and a plain `reason`. The example shows 3 of the 21 slots.
- `suggestions`: 3 angle suggestions. `numbers` is a flat object of named numbers (money keys end in `_cents`); U23 owns its keys. Accepting one is `POST marketing/ideas` with `source: 'suggestion'`.
- `unmapped_spend_cents`: spend that maps to no funnel.
- `overrides`: the one-time changes saved for the next batch, or null. Its keys (U23): `total` (1 to 100 scripts), `funnel_slots` (`{funnel_key: 0..100}`, that many for that funnel; 0 leaves it out this time; the rest is split by spend as usual), `skip_angles` (`[angle_key]`, left out this time; Chris's own ideas with that angle are still written). They apply to the next weekly batch only, never to Write now, and the weekly plan that uses them clears them.
- Two keys beyond the shape (extra keys are allowed): `funnels[].name` (the funnel's name, for "Roadmap $147: 14") and `suggestions[].last_ran_on` (the last Arizona day an ad with that angle spent, `YYYY-MM-DD`, or null).
- `numbers` keys (U23): `spend_7d_cents` and `leads` (null when the angle had no ad running last week), `cpl_cents` (null when there were no leads).
- `as_of` is the last Meta sync.

**Example**

```json
{
  "request": {},
  "response": {
    "next": {
      "release_at": "2026-10-19T14:00:00.000Z",
      "week_key": "2026-W43",
      "enabled": false,
      "total": 21,
      "size_rule": "total",
      "funnels": [
        { "funnel_key": "roadmap_147", "spend_7d_cents": 41200, "share": 0.79, "slots": 17 },
        { "funnel_key": "book_call", "spend_7d_cents": 11150, "share": 0.21, "slots": 4 }
      ],
      "slots": [
        {
          "n": 1,
          "funnel_key": "roadmap_147",
          "script_format": "standard",
          "style": "bullets",
          "source": "chris_idea",
          "angle_key": null,
          "idea_id": "00000000-0000-4000-8000-000000000402",
          "reason": "Chris's idea from Oct 12."
        },
        {
          "n": 2,
          "funnel_key": "roadmap_147",
          "script_format": "standard",
          "style": "bullets",
          "source": "follow_money",
          "angle_key": "two-files",
          "idea_id": null,
          "reason": "Lenders read two files spent the most last week ($412.00). New hook and new body."
        },
        {
          "n": 3,
          "funnel_key": "book_call",
          "script_format": "sorting",
          "style": "words",
          "source": "fresh_angle",
          "angle_key": "rates-rising",
          "idea_id": null,
          "reason": "Rates rising has not run in 30 days."
        }
      ],
      "suggestions": [
        {
          "angle_key": "two-files",
          "name": "Lenders read two files",
          "why": "Most spend and most leads last week.",
          "numbers": { "spend_7d_cents": 41200, "leads": 9, "cpl_cents": 4578 }
        },
        {
          "angle_key": "inquiries-off",
          "name": "Inquiries off first",
          "why": "Cheapest clicks last week, no leads yet.",
          "numbers": { "spend_7d_cents": 11150, "leads": 0, "cpl_cents": null }
        },
        {
          "angle_key": "rates-rising",
          "name": "Rates rising",
          "why": "Not run in 30 days.",
          "numbers": { "spend_7d_cents": null, "leads": null, "cpl_cents": null }
        }
      ],
      "unmapped_spend_cents": 9150,
      "overrides": null
    },
    "saved": { "batch_id": "00000000-0000-4000-8000-000000000301", "status": "planned" },
    "as_of": "2026-10-12T07:01:50.000Z"
  }
}
```

#### `POST marketing/batches/next`

**Owner:** U23 · **Spec:** §7.5, §7.8 · **Success:** 200 · **Guard:** `updated_at` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, updated_at, overrides}`

**Response:** `{next:{release_at, week_key, enabled, total, size_rule, funnels:[{funnel_key, spend_7d_cents, share, slots}], slots:[{n, funnel_key, script_format, style, source, angle_key, idea_id, reason}], suggestions:[{angle_key, name, why, numbers}], unmapped_spend_cents, overrides}, saved:{batch_id, status}, as_of}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `overrides` | overrides is not an object (send {} to clear them) |
| 409 | `stale` | none | updated_at is older than marketing_settings.updated_at; current is {updated_at, overrides} |

- Saves one-time overrides into `marketing_settings.next_overrides`. `{}` clears them. A bad inner value answers 400 with its own field (`overrides.total`, `overrides.funnel_slots.<key>`, `overrides.skip_angles`); a funnel in `funnel_slots` must be an active funnel of the company.
- `updated_at` is `marketing_settings.updated_at`, because the overrides live on that row. Read it from `GET marketing/settings`.
- Answers the same body as GET, with the overrides applied.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c012",
    "updated_at": "2026-10-12T15:01:00.000Z",
    "overrides": {}
  },
  "response": {
    "next": {
      "release_at": "2026-10-19T14:00:00.000Z",
      "week_key": "2026-W43",
      "enabled": false,
      "total": 21,
      "size_rule": "total",
      "funnels": [
        { "funnel_key": "roadmap_147", "spend_7d_cents": 41200, "share": 0.79, "slots": 17 },
        { "funnel_key": "book_call", "spend_7d_cents": 11150, "share": 0.21, "slots": 4 }
      ],
      "slots": [
        {
          "n": 1,
          "funnel_key": "roadmap_147",
          "script_format": "standard",
          "style": "bullets",
          "source": "chris_idea",
          "angle_key": null,
          "idea_id": "00000000-0000-4000-8000-000000000402",
          "reason": "Chris's idea from Oct 12."
        },
        {
          "n": 2,
          "funnel_key": "roadmap_147",
          "script_format": "standard",
          "style": "bullets",
          "source": "follow_money",
          "angle_key": "two-files",
          "idea_id": null,
          "reason": "Lenders read two files spent the most last week ($412.00). New hook and new body."
        },
        {
          "n": 3,
          "funnel_key": "book_call",
          "script_format": "sorting",
          "style": "words",
          "source": "fresh_angle",
          "angle_key": "rates-rising",
          "idea_id": null,
          "reason": "Rates rising has not run in 30 days."
        }
      ],
      "suggestions": [
        {
          "angle_key": "two-files",
          "name": "Lenders read two files",
          "why": "Most spend and most leads last week.",
          "numbers": { "spend_7d_cents": 41200, "leads": 9, "cpl_cents": 4578 }
        },
        {
          "angle_key": "inquiries-off",
          "name": "Inquiries off first",
          "why": "Cheapest clicks last week, no leads yet.",
          "numbers": { "spend_7d_cents": 11150, "leads": 0, "cpl_cents": null }
        },
        {
          "angle_key": "rates-rising",
          "name": "Rates rising",
          "why": "Not run in 30 days.",
          "numbers": { "spend_7d_cents": null, "leads": null, "cpl_cents": null }
        }
      ],
      "unmapped_spend_cents": 9150,
      "overrides": null
    },
    "saved": null,
    "as_of": "2026-10-12T07:01:50.000Z"
  }
}
```

### 6.5 Health card (U22, spec §6 step 4 and §8.3)

#### `GET marketing/health`

**Owner:** U22 · **Spec:** §6 step 4, §8.3 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{clock:{last_tick_at, enabled}, worker:{last_run_at, queued, running, failed_24h:[{kind, error, at}]}, outbox:{waiting, oldest_waiting_at, last_commit_sha, last_commit_at, last_error, token_present, held_reason}, sync:{last_sync_at}, model:{month_cost_usd, max_month_cost_usd, last_batch_cost_usd, max_batch_cost_usd}, as_of}`

**Errors:** only the common ones in section 2.

- `clock` and `worker` come from heartbeats. `clock.enabled` is the weekly-batch switch.
- `worker.failed_24h`: jobs that failed in the last 24 hours, with the plain reason.
- `outbox`: rows waiting for GitHub, the oldest one's time, the last commit and the last error. `token_present` says whether `GITHUB_REPO_TOKEN` is set and is not a masked copy (the value is never shown). `held_reason` is null when saves flow, `no_token` when the token is not set, and `dry_run` when the last drain ran in dry-run mode.
- `sync.last_sync_at` is the last Meta sync.
- `model`: this month's model bill and the last batch's, next to the caps, in dollars.
- `as_of` is when the answer was built.
- Reading it records a `page_seen` heartbeat for the caller (Write now uses it to know Chris is on the page).

**Example**

```json
{
  "request": {},
  "response": {
    "clock": { "last_tick_at": "2026-10-12T15:00:03.000Z", "enabled": false },
    "worker": {
      "last_run_at": "2026-10-12T15:00:05.000Z",
      "queued": 0,
      "running": 0,
      "failed_24h": [
        {
          "kind": "write_slot",
          "error": "The writer stopped: the model took longer than 5 minutes.",
          "at": "2026-10-12T12:40:00.000Z"
        }
      ]
    },
    "outbox": {
      "waiting": 2,
      "oldest_waiting_at": "2026-10-12T15:06:00.000Z",
      "last_commit_sha": null,
      "last_commit_at": null,
      "last_error": null,
      "token_present": false,
      "held_reason": "no_token"
    },
    "sync": { "last_sync_at": "2026-10-12T07:01:50.000Z" },
    "model": {
      "month_cost_usd": 12.48,
      "max_month_cost_usd": 300,
      "last_batch_cost_usd": 9.7,
      "max_batch_cost_usd": 40
    },
    "as_of": "2026-10-12T15:04:05.000Z"
  }
}
```

### 6.6 Today, angles and funnel numbers (U32, spec §8.3 and §11.2)

#### `GET marketing/today`

**Owner:** U32 · **Spec:** §8.3, §11.2; existing keys: docs/specs/marketing-today-contract.md · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{ok, as_of, today, timezone, waiting, flywheel, copy, copy_ready, spend:{currency, through, windows:{today, last_7_days, prior_7_days, last_30_days, prior_30_days}}, last_sync:{meta_synced_at, metrics_synced_at, latest_metrics_date, clickfunnels_synced_at}, costs:{offer, copy}, numbers:{today:{spend_cents, leads, booked, showed, sales, roadmaps, cash_cents, reported_cash_cents, roas}, d7:{spend_cents, leads, booked, showed, sales, roadmaps, cash_cents, reported_cash_cents, roas}, d30:{spend_cents, leads, booked, showed, sales, roadmaps, cash_cents, reported_cash_cents, roas}}, daily:[{date, spend_cents, leads}], spend_by_funnel:[{funnel_key, name, spend_cents}], flow:{page_views, clicks, leads, booked, showed, sales}, scripts_waiting:{ready, flagged}, stuck_jobs:[{id, kind, error, since}]}`

**Errors:** only the common ones in section 2.

- Every existing key stays exactly as `docs/specs/marketing-today-contract.md` says. U32 adds keys and never renames one.
- Slice 0 of `docs/specs/command-center-design-2026-10-05.md` ("Today tells the truth") added `spend.through`, `spend.windows.prior_30_days`, `last_sync.clickfunnels_synced_at` and `costs` (`offer`, `copy`). Their full shape is in `docs/specs/marketing-today-contract.md`. The 7 and 30 day `spend.windows` end on `spend.through` (the last whole day the newest Meta pull covered), never on today; only `spend.windows.today` is today.
- `numbers.today`, `d7` and `d30` are whole Arizona-day windows ending today. The counting rules are in `docs/marketing/metrics.md` (U20). `roadmaps` = $147 roadmap sales. `cash_cents` = succeeded transactions; `reported_cash_cents` = what closers typed. `roas` = cash divided by spend.
- `daily`: the last 30 Arizona days, oldest first. The example shows 3.
- `spend_by_funnel`: the last 7 days. Spend that maps to no funnel is one row with `funnel_key: null` and `name: "Unmapped"`.
- `flow`: the last 7 days. `clicks` = link clicks on the ads (Meta). `page_views` = `funnel.page` events from people.
- `scripts_waiting`: released drafts waiting on Chris; `flagged` = how many of those need a look.
- `stuck_jobs`: failed marketing jobs, each with its `id` for Retry (`POST marketing/jobs/retry`). `error` is the plain reason; `since` is when it failed.
- `as_of` keeps its old meaning here: when the answer was built. The Meta sync time is `last_sync`.
- A part whose table is not there yet comes back empty and is named in `waiting` (the existing rule).

**Example**

```json
{
  "request": {},
  "response": {
    "ok": true,
    "as_of": "2026-10-12T15:04:05.000Z",
    "today": "2026-10-12",
    "timezone": "America/Phoenix",
    "waiting": [],
    "flywheel": { "campaigns": [] },
    "copy": { "partner_id": "00000000-0000-4000-8000-000000000003", "pieces": [], "jobs": [] },
    "copy_ready": {
      "ready": true,
      "partner_id": "00000000-0000-4000-8000-000000000003",
      "checks": [],
      "missing": []
    },
    "spend": {
      "currency": "USD",
      "through": "2026-10-11",
      "windows": {
        "today": {
          "from": "2026-10-12",
          "to": "2026-10-12",
          "days": 1,
          "spend_cents": null,
          "ad_days": 0,
          "days_with_data": 0
        },
        "last_7_days": {
          "from": "2026-10-05",
          "to": "2026-10-11",
          "days": 7,
          "spend_cents": 61500,
          "ad_days": 18,
          "days_with_data": 6
        },
        "prior_7_days": {
          "from": "2026-09-28",
          "to": "2026-10-04",
          "days": 7,
          "spend_cents": 48200,
          "ad_days": 14,
          "days_with_data": 7
        },
        "last_30_days": {
          "from": "2026-09-12",
          "to": "2026-10-11",
          "days": 30,
          "spend_cents": 203400,
          "ad_days": 61,
          "days_with_data": 27
        },
        "prior_30_days": {
          "from": "2026-08-13",
          "to": "2026-09-11",
          "days": 30,
          "spend_cents": 151900,
          "ad_days": 44,
          "days_with_data": 21
        }
      }
    },
    "last_sync": {
      "meta_synced_at": "2026-10-12T07:01:50.000Z",
      "metrics_synced_at": "2026-10-12T07:01:51.000Z",
      "latest_metrics_date": "2026-10-11",
      "clickfunnels_synced_at": "2026-10-11T22:10:00.000Z"
    },
    "costs": {
      "offer": {
        "measured": true,
        "job_id": "00000000-0000-4000-8000-000000000506",
        "finished_at": "2026-10-12T14:04:29.000Z",
        "seconds": 269,
        "input_tokens": 24551,
        "output_tokens": 28640,
        "models": ["claude-opus-5-5"],
        "cost_cents": 67,
        "under_one_cent": false,
        "unpriced_models": []
      },
      "copy": {
        "runs": 0,
        "last_at": null,
        "models": [],
        "avg_input_tokens": null,
        "avg_output_tokens": null,
        "avg_cost_cents": null,
        "under_one_cent": false,
        "unpriced_models": []
      }
    },
    "numbers": {
      "today": {
        "spend_cents": null,
        "leads": 2,
        "booked": 1,
        "showed": 0,
        "sales": 0,
        "roadmaps": 0,
        "cash_cents": 0,
        "reported_cash_cents": null,
        "roas": null
      },
      "d7": {
        "spend_cents": 61500,
        "leads": 23,
        "booked": 7,
        "showed": 5,
        "sales": 1,
        "roadmaps": 4,
        "cash_cents": 158800,
        "reported_cash_cents": 100000,
        "roas": 2.58
      },
      "d30": {
        "spend_cents": 203400,
        "leads": 61,
        "booked": 19,
        "showed": 13,
        "sales": 3,
        "roadmaps": 9,
        "cash_cents": 432300,
        "reported_cash_cents": 300000,
        "roas": 2.13
      }
    },
    "daily": [
      { "date": "2026-10-09", "spend_cents": 8800, "leads": 3 },
      { "date": "2026-10-10", "spend_cents": 9150, "leads": 4 },
      { "date": "2026-10-11", "spend_cents": 8730, "leads": 2 }
    ],
    "spend_by_funnel": [
      { "funnel_key": "roadmap_147", "name": "Roadmap $147", "spend_cents": 41200 },
      { "funnel_key": "book_call", "name": "Book a call", "spend_cents": 11150 },
      { "funnel_key": null, "name": "Unmapped", "spend_cents": 9150 }
    ],
    "flow": { "page_views": 1840, "clicks": 2210, "leads": 23, "booked": 7, "showed": 5, "sales": 1 },
    "scripts_waiting": { "ready": 18, "flagged": 2 },
    "stuck_jobs": [
      {
        "id": "00000000-0000-4000-8000-000000000501",
        "kind": "write_slot",
        "error": "The writer stopped: the model took longer than 5 minutes.",
        "since": "2026-10-12T12:40:00.000Z"
      }
    ]
  }
}
```

#### `GET marketing/angles`

**Owner:** U32 · **Spec:** §11.2, §11.3 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{rows:[{angle_key, name, spend_cents, ads, leads, booked, sales, cash_cents, roas}], as_of}`

**Errors:** only the common ones in section 2.

- One row per angle, last 30 Arizona days. `name` comes from `marketing/ads/angles.json`.
- "Make more of this" on the Angles view is `POST marketing/ideas` with that `angle_key`.
- `as_of` is the last Meta sync.

**Example**

```json
{
  "request": {},
  "response": {
    "rows": [
      {
        "angle_key": "two-files",
        "name": "Lenders read two files",
        "spend_cents": 41200,
        "ads": 1,
        "leads": 9,
        "booked": 3,
        "sales": 0,
        "cash_cents": 29400,
        "roas": 0.71
      },
      {
        "angle_key": "inquiries-off",
        "name": "Inquiries off first",
        "spend_cents": 11150,
        "ads": 1,
        "leads": 0,
        "booked": 0,
        "sales": 0,
        "cash_cents": 0,
        "roas": 0
      }
    ],
    "as_of": "2026-10-12T07:01:50.000Z"
  }
}
```

#### `GET marketing/funnels/stats`

**Owner:** U32 · **Spec:** §11.2, §11.1 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{rows:[{funnel_key, name, spend_cents, page_views, click_to_page, page_to_lead, leads, booked, showed, sales, cash_cents, roas}], unmapped_spend_cents, as_of}`

**Errors:** only the common ones in section 2.

- One row per funnel, last 30 Arizona days.
- `click_to_page` = page views divided by link clicks. `page_to_lead` = leads divided by page views. Both 0..1, null when the bottom number is 0.
- `unmapped_spend_cents`: spend that maps to no funnel.
- Counting rules: `docs/marketing/metrics.md` (U20). `as_of` is the last Meta sync.

**Example**

```json
{
  "request": {},
  "response": {
    "rows": [
      {
        "funnel_key": "roadmap_147",
        "name": "Roadmap $147",
        "spend_cents": 41200,
        "page_views": 1210,
        "click_to_page": 0.82,
        "page_to_lead": 0.0124,
        "leads": 15,
        "booked": 4,
        "showed": 3,
        "sales": 0,
        "cash_cents": 58800,
        "roas": 1.43
      },
      {
        "funnel_key": "book_call",
        "name": "Book a call",
        "spend_cents": 11150,
        "page_views": 630,
        "click_to_page": 0.79,
        "page_to_lead": 0.0127,
        "leads": 8,
        "booked": 3,
        "showed": 2,
        "sales": 1,
        "cash_cents": 100000,
        "roas": 8.97
      }
    ],
    "unmapped_spend_cents": 9150,
    "as_of": "2026-10-12T07:01:50.000Z"
  }
}
```

### 6.7 Ads (U31, spec §11.2)

#### `GET marketing/ads`

**Owner:** U31 · **Spec:** §11.2, §11.1, §11.3 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{from?, to?, funnel?, format?, angle?}`

**Response:** `{rows:[{ad_number, title, funnel_key, script_format, angle_key, spend_cents, impressions, ctr, hook_rate, hold_25, thruplay_rate, leads, booked, showed, sales, close_rate, roadmaps, cash_cents, reported_cash_cents, cpl_cents, cost_per_booked_cents, roas, maturing}], unmapped:[{campaign_external_id, name, spend_cents}], as_of}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `from` | from is not YYYY-MM-DD, or is after to |
| 400 | `invalid` | `to` | to is not YYYY-MM-DD |

- One row per ad NUMBER. Several Meta ads with one number add up; leads count once per number.
- `from` and `to` are Arizona days, both ends included. Left out: the last 30 days ending today. `funnel` = a funnel key, `format` = a script format, `angle` = an angle key. An unknown filter value returns no rows, not an error.
- `maturing` is true when the row has leads newer than 14 days (spec §11.1).
- `unmapped`: spend on Meta campaigns whose ads have no number, one row per campaign.
- Rates are null when their bottom number is 0. `as_of` is the last Meta sync.

**Example**

```json
{
  "request": { "from": "2026-09-13", "to": "2026-10-12" },
  "response": {
    "rows": [
      {
        "ad_number": "91",
        "title": "Lenders read two files",
        "funnel_key": "roadmap_147",
        "script_format": "standard",
        "angle_key": "two-files",
        "spend_cents": 41200,
        "impressions": 38150,
        "ctr": 0.0118,
        "hook_rate": 0.312,
        "hold_25": 0.184,
        "thruplay_rate": 0.071,
        "leads": 9,
        "booked": 3,
        "showed": 2,
        "sales": 0,
        "close_rate": 0,
        "roadmaps": 2,
        "cash_cents": 29400,
        "reported_cash_cents": null,
        "cpl_cents": 4578,
        "cost_per_booked_cents": 13733,
        "roas": 0.71,
        "maturing": true
      },
      {
        "ad_number": "92",
        "title": "Inquiries off first",
        "funnel_key": "book_call",
        "script_format": "sorting",
        "angle_key": "inquiries-off",
        "spend_cents": 11150,
        "impressions": 9020,
        "ctr": 0.0094,
        "hook_rate": 0.27,
        "hold_25": 0.122,
        "thruplay_rate": 0.04,
        "leads": 0,
        "booked": 0,
        "showed": 0,
        "sales": 0,
        "close_rate": null,
        "roadmaps": 0,
        "cash_cents": 0,
        "reported_cash_cents": null,
        "cpl_cents": null,
        "cost_per_booked_cents": null,
        "roas": 0,
        "maturing": true
      }
    ],
    "unmapped": [
      {
        "campaign_external_id": "120210000000000003",
        "name": "Retargeting (example)",
        "spend_cents": 9150
      }
    ],
    "as_of": "2026-10-12T07:01:50.000Z"
  }
}
```

#### `GET marketing/ad`

**Owner:** U31 · **Spec:** §11.2, §11.3 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{n}`

**Response:** `{ad:{ad_number, title, funnel_key, script_format, angle_key, spend_cents, impressions, ctr, hook_rate, hold_25, thruplay_rate, leads, booked, showed, sales, close_rate, roadmaps, cash_cents, reported_cash_cents, cpl_cents, cost_per_booked_cents, roas, maturing, meta_ads:[{id, external_id, name, status, ad_set_external_id}], curve:[{date, video_play_curve}], watch:{alerts:[], diagnoses:[]}}, as_of}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `n` | n is missing or not digits |
| 404 | `not_found` | none | the caller's org has no ad with that number |

- `n` is the ad number (digits).
- `ad` is the same row as in `GET marketing/ads` (last 30 Arizona days), plus `meta_ads` (every Meta ad carrying the number), `curve` (each day's `video_play_curve`: Meta's own list of percents, not a 0..1 ratio) and `watch` (rows from `ad_watch_curve_alerts` and `ad_watch_curve_diagnoses`; U31 owns their inner keys).
- `as_of` is the last Meta sync.

**Example**

```json
{
  "request": { "n": "91" },
  "response": {
    "ad": {
      "ad_number": "91",
      "title": "Lenders read two files",
      "funnel_key": "roadmap_147",
      "script_format": "standard",
      "angle_key": "two-files",
      "spend_cents": 41200,
      "impressions": 38150,
      "ctr": 0.0118,
      "hook_rate": 0.312,
      "hold_25": 0.184,
      "thruplay_rate": 0.071,
      "leads": 9,
      "booked": 3,
      "showed": 2,
      "sales": 0,
      "close_rate": 0,
      "roadmaps": 2,
      "cash_cents": 29400,
      "reported_cash_cents": null,
      "cpl_cents": 4578,
      "cost_per_booked_cents": 13733,
      "roas": 0.71,
      "maturing": true,
      "meta_ads": [
        {
          "id": "00000000-0000-4000-8000-000000000801",
          "external_id": "120210000000000201",
          "name": "SLO Ad 91 — Lenders read two files",
          "status": "PAUSED",
          "ad_set_external_id": "120210000000000101"
        }
      ],
      "curve": [
        {
          "date": "2026-10-10",
          "video_play_curve": [
            100,
            64,
            47,
            39,
            34,
            31,
            28,
            26,
            24,
            22,
            21,
            20,
            19,
            18,
            17,
            15,
            12,
            10,
            8,
            6,
            5,
            4
          ]
        }
      ],
      "watch": {
        "alerts": [],
        "diagnoses": [
          {
            "date": "2026-10-10",
            "diagnosis": "opening",
            "fix_type": "words",
            "film_note": "Most plays stop before the quarter mark. Film a new first line, same body.",
            "next_take_improved": null
          }
        ]
      }
    },
    "as_of": "2026-10-12T07:01:50.000Z"
  }
}
```

### 6.8 Load into Meta, paused (U28, spec §10.5)

#### `POST marketing/meta/load`

**Owner:** U28 · **Spec:** §10.2-10.5 · **Success:** 202 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, ad_video_id?, all?}` (send one of: `ad_video_id` or `all`)

**Response:** `{queued, jobs:[{ad_number, ad_video_id, job_id}]}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `ad_video_id` | neither ad_video_id nor all:true was sent, or ad_video_id is not a uuid |
| 404 | `not_found` | none | no ad video with that id in the caller's org |

- One ad: `{request_id, ad_video_id}`. Every approved video not loaded yet: `{request_id, all: true}`. Send one of the two.
- Answers at once (202). Each load is a `meta_load` job. Refusals (no person approval, no meta copy, no default ad set, an ad set guard, the compliance screen, an enhancement that reads OPT_IN, or "final video is not in storage yet") show in `GET marketing/meta/load-status`, never here.
- Every ad loads PAUSED. Nothing here turns an ad on.
- `all: true` with nothing to load answers `jobs: []`.

**Example**

```json
{
  "request": { "request_id": "00000000-0000-4000-8000-00000000c013", "all": true },
  "response": {
    "queued": true,
    "jobs": [
      {
        "ad_number": "91",
        "ad_video_id": "00000000-0000-4000-8000-000000000701",
        "job_id": "00000000-0000-4000-8000-000000000503"
      },
      {
        "ad_number": "92",
        "ad_video_id": "00000000-0000-4000-8000-000000000702",
        "job_id": "00000000-0000-4000-8000-000000000504"
      }
    ]
  }
}
```

#### `GET marketing/meta/load-status`

**Owner:** U28 · **Spec:** §10.5 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{loads:[{ad_number, ad_video_id, state, reasons:[], meta_video_id, meta_creative_id, meta_ad_external_id, ad_row_id, ad_status, ad_set:{external_id, status}, campaign:{external_id, status}}], as_of}`

**Errors:** only the common ones in section 2.

- One row per ad video that was asked to load.
- `state` is `waiting`, `loading`, `loaded`, `refused` or `failed`. `reasons` are plain sentences.
- The Meta ids fill in as Meta returns them.
- `ad_status`, `ad_set.status` and `campaign.status` come from the last sync, so the Launch tab can say when an ad set or campaign is paused. `ad_set` and `campaign` are null when the funnel has no default ad set.
- `as_of` is the last Meta sync.

**Example**

```json
{
  "request": {},
  "response": {
    "loads": [
      {
        "ad_number": "91",
        "ad_video_id": "00000000-0000-4000-8000-000000000701",
        "state": "loaded",
        "reasons": [],
        "meta_video_id": "1234567890123456",
        "meta_creative_id": "120210000000000301",
        "meta_ad_external_id": "120210000000000201",
        "ad_row_id": "00000000-0000-4000-8000-000000000801",
        "ad_status": "PAUSED",
        "ad_set": { "external_id": "120210000000000101", "status": "ACTIVE" },
        "campaign": { "external_id": "120210000000000001", "status": "ACTIVE" }
      },
      {
        "ad_number": "92",
        "ad_video_id": "00000000-0000-4000-8000-000000000702",
        "state": "refused",
        "reasons": ["The final video is not in storage yet."],
        "meta_video_id": null,
        "meta_creative_id": null,
        "meta_ad_external_id": null,
        "ad_row_id": null,
        "ad_status": null,
        "ad_set": { "external_id": "120210000000000102", "status": "PAUSED" },
        "campaign": { "external_id": "120210000000000002", "status": "PAUSED" }
      }
    ],
    "as_of": "2026-10-12T07:01:50.000Z"
  }
}
```

### 6.9 Turn one ad on (U15, spec §10.5)

#### `POST campaigns/write#resume_ad`

**Owner:** U15 · **Spec:** §10.5 Turn on, §2 item 6 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin), then staff id in MARKETING_AD_SWITCH_STAFF_IDS

**Request (JSON body):** `{action, ad_id, request_id}`

**Response:** `{ok, ad:{id, status}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 403 | `forbidden` | none | the caller is not on MARKETING_AD_SWITCH_STAFF_IDS (unset or empty = nobody); message: "Only Chris can turn ads on." |
| 404 | `not_found` | none | ad_id is not one of our ads rows (a campaign id, an ad set id or a Meta id all land here); Meta is never called |
| 400 | `platform_error` | none | Meta said no; the ad stays paused (the existing campaigns/write shape: message and reasons) |
| 400 | `blocked` | none | the guard (guardedWrite) refused; the ad stays paused (message and reasons) |

- This is `POST /api/campaigns/write` with `action: 'resume_ad'`. The key ends in `#resume_ad` only so it is unique here.
- Gate: `requireAuth`, then `ROLE_SETS.MARKETING`, then the caller's staff id must be in `MARKETING_AD_SWITCH_STAFF_IDS` (a comma list; unset or empty means nobody).
- `ad_id` is our `ads.id` (a uuid). It turns on that one ad, using the external id and connection from our ads row, through `guardedWrite` (actor human, Chris's staff id, target `ad`). It never takes a Meta id and never touches a campaign or ad set.
- `ads.status` becomes `ACTIVE` only after Meta says yes.
- The same `request_id` again returns the saved answer. A new `request_id` for an ad that is already on sends ACTIVE again, which changes nothing at Meta.
- The old campaign actions (`pause`, `resume`, `update_budget`) do not change.

**Example**

```json
{
  "request": {
    "action": "resume_ad",
    "ad_id": "00000000-0000-4000-8000-000000000801",
    "request_id": "00000000-0000-4000-8000-00000000c014"
  },
  "response": { "ok": true, "ad": { "id": "00000000-0000-4000-8000-000000000801", "status": "ACTIVE" } }
}
```

### 6.10 The funnel builder (X4, owner order 2026-10-05)

Make a book-a-call funnel with its own address and tag, write its three pages, rename it, push it live as NEW ClickFunnels pages, and read it back. Tables: `marketing_funnels` (builder columns) and `marketing_funnel_pages` (migration 425). Every page carries the funnel tag and the tracking manifest's scripts; the database refuses a page without them.

#### `POST marketing/funnels/create`

**Owner:** X4 · **Spec:** owner order 2026-10-05 (build unit X4): URL system, tag, page builder · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, offer_key, lane?, name?, campaign?, path?, build?}`

**Response:** `{funnel:{id, key, name, landing_url, offer_key, lane, book_call, format_mix, cta_type, meta_campaign_ids, default_ad_set_external_id, weight, active, created_at, updated_at, kind, url, path, tag, utm_campaign, utm_template, campaign, status, live_at, created_by, pages:[{id, position, role, path, url, status, built_at, pushed_at, proved_at, live_url, events_seen, last_event_at}], events_seen}, job:{id, kind, status, created_at}, worker:{started, reason}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `offer_key` | not an offer sold on a call (capital_blueprint or funding_dfy) |
| 400 | `invalid` | `path` | the typed address is reserved, already a live ClickFunnels page, or used by another of our funnels; or no free address is left |
| 400 | `invalid` | `lane` | a lane the database files as unknown |
| 400 | `invalid` | `campaign` | not a flywheel folder name |
| 503 | `clickfunnels_unreadable` | none | the live ClickFunnels page list could not be read, so nothing was made |

- The address is picked for Chris from the offer's word: /blueprint, then /blueprint-2, /blueprint-3 if taken. A typed `path` ("Capital VIP" becomes /capital-vip) is checked the same way. Taken means a page on the live ClickFunnels workspace (read only: GET /workspaces/{id}/pages), an address any of our funnels uses, or a reserved word (every page the live funnels use, and api, app, login, privacy, terms and the like). The three pages are `<path>`, `<path>-book` and `<path>-thank-you`; all three must be free.
- The `tag` is `fnl-` plus the funnel key. It is saved once and never changes, even on a rename.
- `lane` defaults to the offer's lane (capital_blueprint: uwiq, from marketing/ads/registry.json; funding_dfy: funding600). It becomes `utm_campaign`.
- `build` (default true) queues the page writer: job kind `funnel`, one Anthropic call (claude-opus-5-5, structured output), the copy check (the ad checker in strict mode plus outcome first, no invented numbers, no price, no testimonials, no Social Security number talk, no guarantee), one fix round, then the three pages drawn with the funnel tag and the tracking. `job` is null when build is false.
- `worker.started` false with a `reason` means the worker could not be woken; the job is then failed with that reason and Build can be pressed again.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c051",
    "offer_key": "capital_blueprint"
  },
  "response": {
    "funnel": {
      "id": "00000000-0000-4000-8000-000000000603",
      "key": "blueprint",
      "name": "Capital Blueprint book a call",
      "landing_url": "https://apply.fundhub.ai/blueprint",
      "offer_key": "capital_blueprint",
      "lane": "uwiq",
      "book_call": true,
      "format_mix": {},
      "cta_type": "LEARN_MORE",
      "meta_campaign_ids": [],
      "default_ad_set_external_id": null,
      "weight": 1,
      "active": false,
      "created_at": "2026-10-12T15:10:00.000Z",
      "updated_at": "2026-10-12T15:10:00.000Z",
      "kind": "book_a_call",
      "url": "https://apply.fundhub.ai/blueprint",
      "path": "/blueprint",
      "tag": "fnl-blueprint",
      "utm_campaign": "uwiq",
      "utm_template": "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content={ad_number}",
      "campaign": null,
      "status": "draft",
      "live_at": null,
      "created_by": "00000000-0000-4000-8000-000000000002",
      "pages": [
        {
          "id": "00000000-0000-4000-8000-000000000611",
          "position": 1,
          "role": "landing",
          "path": "/blueprint",
          "url": "https://apply.fundhub.ai/blueprint",
          "status": "empty",
          "built_at": null,
          "pushed_at": null,
          "proved_at": null,
          "live_url": null,
          "events_seen": 0,
          "last_event_at": null
        },
        {
          "id": "00000000-0000-4000-8000-000000000612",
          "position": 2,
          "role": "booking",
          "path": "/blueprint-book",
          "url": "https://apply.fundhub.ai/blueprint-book",
          "status": "empty",
          "built_at": null,
          "pushed_at": null,
          "proved_at": null,
          "live_url": null,
          "events_seen": 0,
          "last_event_at": null
        },
        {
          "id": "00000000-0000-4000-8000-000000000613",
          "position": 3,
          "role": "thank_you",
          "path": "/blueprint-thank-you",
          "url": "https://apply.fundhub.ai/blueprint-thank-you",
          "status": "empty",
          "built_at": null,
          "pushed_at": null,
          "proved_at": null,
          "live_url": null,
          "events_seen": 0,
          "last_event_at": null
        }
      ],
      "events_seen": 0
    },
    "job": {
      "id": "00000000-0000-4000-8000-000000000621",
      "kind": "funnel",
      "status": "queued",
      "created_at": "2026-10-12T15:10:00.000Z"
    },
    "worker": {
      "started": true,
      "reason": null
    }
  }
}
```

#### `POST marketing/funnels/rename`

**Owner:** X4 · **Spec:** owner order 2026-10-05 (build unit X4): name it in the dash · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, path}`

**Response:** `{funnel:{id, key, name, landing_url, offer_key, lane, book_call, format_mix, cta_type, meta_campaign_ids, default_ad_set_external_id, weight, active, created_at, updated_at, kind, url, path, tag, utm_campaign, utm_template, campaign, status, live_at, created_by, pages:[{id, position, role, path, url, status, built_at, pushed_at, proved_at, live_url, events_seen, last_event_at}], events_seen}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `path` | the address is reserved, already a live ClickFunnels page, used by another of our funnels, or the same as now |
| 400 | `invalid` | `id` | the funnel is live or a page of it is on ClickFunnels (a live address never changes), or a build or push is running |
| 404 | `not_found` | none | no such funnel in this company, or it was not built here |
| 503 | `clickfunnels_unreadable` | none | the live ClickFunnels page list could not be read, so nothing was renamed |

- Built pages are drawn again from their saved words so the links between them follow the new address. No model call.
- A live address never changes: once any page is on ClickFunnels, rename is refused.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c052",
    "id": "00000000-0000-4000-8000-000000000603",
    "path": "blueprint-vip"
  },
  "response": {
    "funnel": {
      "id": "00000000-0000-4000-8000-000000000603",
      "key": "blueprint",
      "name": "Capital Blueprint book a call",
      "landing_url": "https://apply.fundhub.ai/blueprint-vip",
      "offer_key": "capital_blueprint",
      "lane": "uwiq",
      "book_call": true,
      "format_mix": {},
      "cta_type": "LEARN_MORE",
      "meta_campaign_ids": [],
      "default_ad_set_external_id": null,
      "weight": 1,
      "active": false,
      "created_at": "2026-10-12T15:10:00.000Z",
      "updated_at": "2026-10-12T15:12:00.000Z",
      "kind": "book_a_call",
      "url": "https://apply.fundhub.ai/blueprint-vip",
      "path": "/blueprint-vip",
      "tag": "fnl-blueprint",
      "utm_campaign": "uwiq",
      "utm_template": "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content={ad_number}",
      "campaign": null,
      "status": "draft",
      "live_at": null,
      "created_by": "00000000-0000-4000-8000-000000000002",
      "pages": [
        {
          "id": "00000000-0000-4000-8000-000000000611",
          "position": 1,
          "role": "landing",
          "path": "/blueprint-vip",
          "url": "https://apply.fundhub.ai/blueprint-vip",
          "status": "empty",
          "built_at": null,
          "pushed_at": null,
          "proved_at": null,
          "live_url": null,
          "events_seen": 0,
          "last_event_at": null
        },
        {
          "id": "00000000-0000-4000-8000-000000000612",
          "position": 2,
          "role": "booking",
          "path": "/blueprint-vip-book",
          "url": "https://apply.fundhub.ai/blueprint-vip-book",
          "status": "empty",
          "built_at": null,
          "pushed_at": null,
          "proved_at": null,
          "live_url": null,
          "events_seen": 0,
          "last_event_at": null
        },
        {
          "id": "00000000-0000-4000-8000-000000000613",
          "position": 3,
          "role": "thank_you",
          "path": "/blueprint-vip-thank-you",
          "url": "https://apply.fundhub.ai/blueprint-vip-thank-you",
          "status": "empty",
          "built_at": null,
          "pushed_at": null,
          "proved_at": null,
          "live_url": null,
          "events_seen": 0,
          "last_event_at": null
        }
      ],
      "events_seen": 0
    }
  }
}
```

#### `POST marketing/funnels/build`

**Owner:** X4 · **Spec:** owner order 2026-10-05 (build unit X4): page builder job (kind funnel) · **Success:** 202 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id}`

**Response:** `{queued, job:{id, kind, status, created_at}, worker:{started, reason}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `id` | the funnel is live or a page of it is on ClickFunnels (never rewritten), or a build or push is already running |
| 404 | `not_found` | none | no such funnel in this company, or it was not built here |

- Writes (or writes again) the three pages of a draft funnel. Cost: one model call (see GET marketing/costs once it exists; until then "unknown, not measured yet"). The job stops before calling the model when this month's model spend has reached max_month_cost_usd.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c053",
    "id": "00000000-0000-4000-8000-000000000603"
  },
  "response": {
    "queued": true,
    "job": {
      "id": "00000000-0000-4000-8000-000000000621",
      "kind": "funnel",
      "status": "queued",
      "created_at": "2026-10-12T15:10:00.000Z"
    },
    "worker": {
      "started": true,
      "reason": null
    }
  }
}
```

#### `POST marketing/funnels/push-live`

**Owner:** X4 · **Spec:** owner order 2026-10-05 (build unit X4): push live to a NEW path; design §5 rules 5 and 16 · **Success:** 202 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, confirm_url}`

**Response:** `{queued, job:{id, kind, status, created_at}, url, worker:{started, reason}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `confirm_url` | missing, or not this funnel's address (the second tap names the address) |
| 400 | `invalid` | `id` | the pages are not built yet, the funnel is already live, or a build or push is running |
| 404 | `not_found` | none | no such funnel in this company, or it was not built here |

- The second tap names the address; `confirm_url` is that address and must equal the funnel's. Sent online only, never from the offline queue (design §5 rules 5 and 16).
- The push (job kind `funnel_push`) re-reads the live page list, stops before making anything when one of the three addresses is a page this machine did not make, then makes three NEW custom HTML pages (POST /workspaces/{id}/pages/custom_html; thank-you, booking, then the landing page last), saves each page id and the address ClickFunnels answers the moment it answers, stops (the funnel stays a draft, no more pages are made) when that address is not `https://apply.fundhub.ai` + the page's path or when there is no address at all (never guessed), puts each page's token into that same page (the only PUT, and only on an id this push made), and proves each page at its own address with a cache-busted read that shows the funnel tag and the tracking. A 429 or no answer from ClickFunnels is tried again later; 401, 403, 404 and 422 fail the job with the reason. Only then is the funnel `live` (and active), and in the same transaction its three pages are queued for the repo outbox at `marketing/landing-pages/funnels/<key>/<page>.html`. It never changes, moves or deletes a page it did not make.
- Costs $0. No ad is made or changed.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c054",
    "id": "00000000-0000-4000-8000-000000000603",
    "confirm_url": "https://apply.fundhub.ai/blueprint"
  },
  "response": {
    "queued": true,
    "job": {
      "id": "00000000-0000-4000-8000-000000000622",
      "kind": "funnel_push",
      "status": "queued",
      "created_at": "2026-10-12T15:59:00.000Z"
    },
    "url": "https://apply.fundhub.ai/blueprint",
    "worker": {
      "started": true,
      "reason": null
    }
  }
}
```

#### `GET marketing/funnel`

**Owner:** X4 · **Spec:** owner order 2026-10-05 (build unit X4): one funnel with its draft pages · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{id}`

**Response:** `{funnel:{id, key, name, landing_url, offer_key, lane, book_call, format_mix, cta_type, meta_campaign_ids, default_ad_set_external_id, weight, active, created_at, updated_at, kind, url, path, tag, utm_campaign, utm_template, campaign, status, live_at, created_by, pages:[{id, position, role, path, url, status, built_at, pushed_at, proved_at, live_url, events_seen, last_event_at}], events_seen}, pages:[{id, position, role, path, url, status, built_at, pushed_at, proved_at, live_url, events_seen, last_event_at, copy, html}], jobs:[{id, kind, status, attempts, error, result, created_at, claimed_at, finished_at, run_after}], as_of}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `id` | id is not a uuid |
| 404 | `not_found` | none | no such funnel in this company |

- `pages[].copy` is the checked words the page was drawn from; `pages[].html` is the whole page as saved (before the ClickFunnels page token is added). A funnel mapped by hand answers with `pages` [] and `jobs` [].

**Example**

```json
{
  "request": {
    "id": "00000000-0000-4000-8000-000000000603"
  },
  "response": {
    "funnel": {
      "id": "00000000-0000-4000-8000-000000000603",
      "key": "blueprint",
      "name": "Capital Blueprint book a call",
      "landing_url": "https://apply.fundhub.ai/blueprint",
      "offer_key": "capital_blueprint",
      "lane": "uwiq",
      "book_call": true,
      "format_mix": {},
      "cta_type": "LEARN_MORE",
      "meta_campaign_ids": [],
      "default_ad_set_external_id": null,
      "weight": 1,
      "active": true,
      "created_at": "2026-10-12T15:10:00.000Z",
      "updated_at": "2026-10-12T16:00:21.000Z",
      "kind": "book_a_call",
      "url": "https://apply.fundhub.ai/blueprint",
      "path": "/blueprint",
      "tag": "fnl-blueprint",
      "utm_campaign": "uwiq",
      "utm_template": "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content={ad_number}",
      "campaign": null,
      "status": "live",
      "live_at": "2026-10-12T16:00:21.000Z",
      "created_by": "00000000-0000-4000-8000-000000000002",
      "pages": [
        {
          "id": "00000000-0000-4000-8000-000000000611",
          "position": 1,
          "role": "landing",
          "path": "/blueprint",
          "url": "https://apply.fundhub.ai/blueprint",
          "status": "live",
          "built_at": "2026-10-12T15:20:00.000Z",
          "pushed_at": "2026-10-12T16:00:00.000Z",
          "proved_at": "2026-10-12T16:00:20.000Z",
          "live_url": "https://apply.fundhub.ai/blueprint",
          "events_seen": 12,
          "last_event_at": "2026-10-12T18:30:00.000Z"
        },
        {
          "id": "00000000-0000-4000-8000-000000000612",
          "position": 2,
          "role": "booking",
          "path": "/blueprint-book",
          "url": "https://apply.fundhub.ai/blueprint-book",
          "status": "live",
          "built_at": "2026-10-12T15:20:00.000Z",
          "pushed_at": "2026-10-12T16:00:00.000Z",
          "proved_at": "2026-10-12T16:00:20.000Z",
          "live_url": "https://apply.fundhub.ai/blueprint-book",
          "events_seen": 4,
          "last_event_at": "2026-10-12T18:30:00.000Z"
        },
        {
          "id": "00000000-0000-4000-8000-000000000613",
          "position": 3,
          "role": "thank_you",
          "path": "/blueprint-thank-you",
          "url": "https://apply.fundhub.ai/blueprint-thank-you",
          "status": "live",
          "built_at": "2026-10-12T15:20:00.000Z",
          "pushed_at": "2026-10-12T16:00:00.000Z",
          "proved_at": "2026-10-12T16:00:20.000Z",
          "live_url": "https://apply.fundhub.ai/blueprint-thank-you",
          "events_seen": 1,
          "last_event_at": "2026-10-12T18:30:00.000Z"
        }
      ],
      "events_seen": 17
    },
    "pages": [
      {
        "id": "00000000-0000-4000-8000-000000000611",
        "position": 1,
        "role": "landing",
        "path": "/blueprint",
        "url": "https://apply.fundhub.ai/blueprint",
        "status": "live",
        "built_at": "2026-10-12T15:20:00.000Z",
        "pushed_at": "2026-10-12T16:00:00.000Z",
        "proved_at": "2026-10-12T16:00:20.000Z",
        "live_url": "https://apply.fundhub.ai/blueprint",
        "events_seen": 12,
        "last_event_at": "2026-10-12T18:30:00.000Z",
        "copy": {
          "headline": "Know exactly what stands between you and funding"
        },
        "html": "<!doctype html>..."
      },
      {
        "id": "00000000-0000-4000-8000-000000000612",
        "position": 2,
        "role": "booking",
        "path": "/blueprint-book",
        "url": "https://apply.fundhub.ai/blueprint-book",
        "status": "live",
        "built_at": "2026-10-12T15:20:00.000Z",
        "pushed_at": "2026-10-12T16:00:00.000Z",
        "proved_at": "2026-10-12T16:00:20.000Z",
        "live_url": "https://apply.fundhub.ai/blueprint-book",
        "events_seen": 4,
        "last_event_at": "2026-10-12T18:30:00.000Z",
        "copy": {
          "headline": "Pick the time that works for you"
        },
        "html": "<!doctype html>..."
      },
      {
        "id": "00000000-0000-4000-8000-000000000613",
        "position": 3,
        "role": "thank_you",
        "path": "/blueprint-thank-you",
        "url": "https://apply.fundhub.ai/blueprint-thank-you",
        "status": "live",
        "built_at": "2026-10-12T15:20:00.000Z",
        "pushed_at": "2026-10-12T16:00:00.000Z",
        "proved_at": "2026-10-12T16:00:20.000Z",
        "live_url": "https://apply.fundhub.ai/blueprint-thank-you",
        "events_seen": 1,
        "last_event_at": "2026-10-12T18:30:00.000Z",
        "copy": {
          "headline": "Your call is on the calendar"
        },
        "html": "<!doctype html>..."
      }
    ],
    "jobs": [
      {
        "id": "00000000-0000-4000-8000-000000000622",
        "kind": "funnel_push",
        "status": "done",
        "attempts": 0,
        "error": null,
        "result": {
          "url": "https://apply.fundhub.ai/blueprint",
          "created": 3,
          "adopted": 0
        },
        "created_at": "2026-10-12T15:59:00.000Z",
        "claimed_at": "2026-10-12T15:59:01.000Z",
        "finished_at": "2026-10-12T16:00:21.000Z",
        "run_after": "2026-10-12T15:59:00.000Z"
      },
      {
        "id": "00000000-0000-4000-8000-000000000621",
        "kind": "funnel",
        "status": "done",
        "attempts": 0,
        "error": null,
        "result": {
          "checks": "passed",
          "rounds": 1,
          "cost_usd": 0.046
        },
        "created_at": "2026-10-12T15:10:00.000Z",
        "claimed_at": "2026-10-12T15:10:01.000Z",
        "finished_at": "2026-10-12T15:11:30.000Z",
        "run_after": "2026-10-12T15:10:00.000Z"
      }
    ],
    "as_of": "2026-10-12T18:31:00.000Z"
  }
}
```

## 7. Deferred routes (drafted, not built in this pass)

The plan defers these (`final.deferred` in the plan file): Shoot Day waits on M2 and the 9.1a states, videos wait on the video worker and R2, and the map and page suggestions are outside this pass. Their shapes are drafted from the spec text and the design doc so lane E can mock them. The unit that builds one may change it, and updates this file and the module in the same PR.

### 7.1 Shoot Day (spec §8.2)

#### `GET marketing/shoot`

**Owner:** deferred · **Spec:** §8.2 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{shoot:{id, shoot_date, status, root_script_ids, marks, estimated_minutes, board:[{ad_id, angle, step, step_word, since, reason, can_retry, needs_you}], landed_unmatched}, plan_candidates:[S]}`

**Errors:** only the common ones in section 2.

- `shoot` is the open shoot (any status but `done`), or null.
- `plan_candidates`: every locked script with no Got it mark on an open shoot, in film order; retakes (`needs_retake`) and new openings first.
- `marks` is `{<root_script_id>: {takes, got_it}}` (spec §6 step 3).
- `board`: one row per ad. `step` is `filmed`, `matched`, `cutting`, `captions`, `animations`, `ready_to_approve`, `approved`, `loaded` or `failed` (the spec §8.2 table). `step_word` is the word the screen prints. `needs_you` rows go on top.
- `estimated_minutes`: each script's read time at the set speed, plus 2 minutes per ad.
- `landed_unmatched`: clips that landed and are not matched yet ("N clips landed, matching").

**Example**

```json
{
  "request": {},
  "response": {
    "shoot": {
      "id": "00000000-0000-4000-8000-000000000901",
      "shoot_date": "2026-10-13",
      "status": "filming",
      "root_script_ids": [
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000201"
      ],
      "marks": { "00000000-0000-4000-8000-000000000101": { "takes": 2, "got_it": true } },
      "estimated_minutes": 6,
      "board": [
        {
          "ad_id": "91",
          "angle": "Lenders read two files",
          "step": "filmed",
          "step_word": "Filmed",
          "since": "2026-10-13T16:05:00.000Z",
          "reason": null,
          "can_retry": false,
          "needs_you": false
        }
      ],
      "landed_unmatched": 0
    },
    "plan_candidates": [
      {
        "id": "00000000-0000-4000-8000-000000000101",
        "root_script_id": "00000000-0000-4000-8000-000000000101",
        "version": 1,
        "status": "locked",
        "ad_id": "91",
        "title": "Lenders read two files",
        "body": "MOST lenders read TWO files before they say yes.\n\nIf one is a mess, they never open the other.\n\nthe personal file\nthe business file\nwhich one they read first\n\nWe check both before you apply anywhere.\n\nTap below and see what both files say today.",
        "parts": [
          { "kind": "hook", "text": "MOST lenders read TWO files before they say yes." },
          { "kind": "line2", "text": "If one is a mess, they never open the other." },
          { "kind": "cue", "text": "the personal file" },
          { "kind": "cue", "text": "the business file" },
          { "kind": "cue", "text": "which one they read first" },
          { "kind": "reveal", "text": "We check both before you apply anywhere." },
          { "kind": "cta", "text": "Tap below and see what both files say today." }
        ],
        "script_format": "standard",
        "style": "bullets",
        "funnel_key": "roadmap_147",
        "angle_key": "two-files",
        "hook_key": "two-files-lenders-read",
        "offer_key": "slo_roadmap",
        "lane": "uwiq",
        "batch_id": "00000000-0000-4000-8000-000000000301",
        "idea_id": "00000000-0000-4000-8000-000000000401",
        "source": "machine",
        "check_results": {
          "strict": { "passed": true, "rounds": 1, "failures": [] },
          "judge": { "passed": true, "notes": [] },
          "compliance": { "state": "passed", "reasons": [] }
        },
        "flagged": false,
        "fix_note": null,
        "animation_plan": [
          {
            "anchor": { "cue": 1, "keyword": "personal" },
            "template": "FileItems",
            "props": {},
            "seconds": 2.5
          },
          {
            "anchor": { "cue": 3, "keyword": "first" },
            "template": "StepPath",
            "props": {},
            "seconds": 3
          }
        ],
        "meta_copy": {
          "primary_text": "Lenders read two files before they say yes. See what both of yours say before you apply.",
          "headline": "See both files first",
          "description": "Your Funding Roadmap",
          "cta_type": "LEARN_MORE"
        },
        "film_order": null,
        "needs_retake": false,
        "locked_at": "2026-10-12T15:06:00.000Z",
        "locked_by": "00000000-0000-4000-8000-000000000002",
        "rejected_at": null,
        "rejected_reason": null,
        "filmed_at": null,
        "repo_path": "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md",
        "repo_commit": "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d",
        "created_at": "2026-10-12T11:12:40.000Z",
        "updated_at": "2026-10-12T15:06:00.000Z"
      }
    ]
  }
}
```

#### `POST marketing/shoot`

**Owner:** deferred · **Spec:** §8.2 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id?, shoot_date?, root_script_ids?, status?}`

**Response:** `{shoot:{id, shoot_date, status, root_script_ids, marks, estimated_minutes, board:[], landed_unmatched}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `root_script_ids` | not a list of root ids of locked scripts in the caller's org |
| 400 | `invalid` | `status` | status is not planned, filming, uploaded or done |
| 404 | `not_found` | none | id names no shoot in the caller's org |

- Create: `{request_id, shoot_date, root_script_ids}`. Reorder: `{request_id, id, root_script_ids}`. Close: `{request_id, id, status: 'done'}`.
- Answers 200 with the shoot.
- If the builder finds a stale guard is needed, it uses `updated_at` and 409 the way settings does, and updates this file.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c015",
    "shoot_date": "2026-10-13",
    "root_script_ids": ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000201"]
  },
  "response": {
    "shoot": {
      "id": "00000000-0000-4000-8000-000000000901",
      "shoot_date": "2026-10-13",
      "status": "planned",
      "root_script_ids": [
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000201"
      ],
      "marks": {},
      "estimated_minutes": 6,
      "board": [],
      "landed_unmatched": 0
    }
  }
}
```

#### `POST marketing/shoot/mark`

**Owner:** deferred · **Spec:** §8.2 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, shoot_id, root_script_id, mark}`

**Response:** `{marks}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `mark` | mark is not got_it or another_take |
| 404 | `not_found` | none | no such shoot, or the script is not on it |

- `mark` is `got_it` or `another_take`. Got it marks the shoot only; the script becomes `filmed` when M3 matches its take (spec §7.4).
- Answers the shoot's `marks`.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c016",
    "shoot_id": "00000000-0000-4000-8000-000000000901",
    "root_script_id": "00000000-0000-4000-8000-000000000201",
    "mark": "got_it"
  },
  "response": {
    "marks": {
      "00000000-0000-4000-8000-000000000101": { "takes": 2, "got_it": true },
      "00000000-0000-4000-8000-000000000201": { "takes": 1, "got_it": true }
    }
  }
}
```

### 7.2 Videos (spec §9.1 route table and §9.6)

**One writer.** These staff routes call the same `store.approve()` and `store.reject()` in `src/ad-videos/store.mjs` that the public token page (`api/public/ad-video-approve.mjs`) uses. The token page becomes a thin wrapper over the same functions, or is retired for new rounds. There are never two writers.

Every video write sends the video's `id`. The design doc names it `video_id` on some routes; this contract uses `id` on all of them, the same as the script routes.

#### `GET marketing/videos`

**Owner:** deferred · **Spec:** §9.1, §9.6 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{videos:[{id, version, ad_id, angle, funnel_key, state, state_word, since, master_duration_seconds, submagic_minutes, can_approve}], counts:{to_approve, on_hold, being_cut}}`

**Errors:** only the common ones in section 2.

- `state` is the `ad_videos` status. `state_word` is the screen word (`STATE_MEANING`).
- `version` is the row's edit round. Every video write sends it back.
- `submagic_minutes`: what Submagic billed for this video, null until logged.
- `counts`: `to_approve`, `on_hold` (held cuts) and `being_cut`.

**Example**

```json
{
  "request": {},
  "response": {
    "videos": [
      {
        "id": "00000000-0000-4000-8000-000000000701",
        "version": 1,
        "ad_id": "91",
        "angle": "Lenders read two files",
        "funnel_key": "roadmap_147",
        "state": "awaiting_approval",
        "state_word": "Ready to approve",
        "since": "2026-10-13T19:40:00.000Z",
        "master_duration_seconds": 58.4,
        "submagic_minutes": 1.2,
        "can_approve": true
      }
    ],
    "counts": { "to_approve": 1, "on_hold": 0, "being_cut": 0 }
  }
}
```

#### `GET marketing/video`

**Owner:** deferred · **Spec:** §9.1, §9.6 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{id}`

**Response:** `{video:{id, version, ad_id, angle, funnel_key, state, state_word, since, master_duration_seconds, submagic_minutes, can_approve}, signed_url, lines:[{text, state, heard}], caption_mismatches:[{heard, script}], animations:[], takes:[], edits:[]}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `id` | id is missing or not a uuid |
| 404 | `not_found` | none | no video with that id in the caller's org |

- `signed_url`: a link to our own final file that plays for 24 hours, or null when it is not linkable yet.
- `lines`: each script line; `state` is `kept`, `missing` or `said_differently`; `heard` is the transcript's words when they differ.
- `caption_mismatches`: what Submagic heard next to what the script says.
- `animations`: the overlay list. `takes`: every take of this ad (the master and merged ones). `edits`: `ad_video_edits` rows.

**Example**

```json
{
  "request": { "id": "00000000-0000-4000-8000-000000000701" },
  "response": {
    "video": {
      "id": "00000000-0000-4000-8000-000000000701",
      "version": 1,
      "ad_id": "91",
      "angle": "Lenders read two files",
      "funnel_key": "roadmap_147",
      "state": "awaiting_approval",
      "state_word": "Ready to approve",
      "since": "2026-10-13T19:40:00.000Z",
      "master_duration_seconds": 58.4,
      "submagic_minutes": 1.2,
      "can_approve": true
    },
    "signed_url": "https://media.example.invalid/partners/house/ad-video/final/91-r1.mp4?signature=example",
    "lines": [
      { "text": "MOST lenders read TWO files before they say yes.", "state": "kept", "heard": null },
      {
        "text": "If one is a mess, they never open the other.",
        "state": "said_differently",
        "heard": "If one is a mess they never even open the other."
      }
    ],
    "caption_mismatches": [{ "heard": "fundable", "script": "fundability" }],
    "animations": [
      { "anchor": { "cue": 1, "keyword": "personal" }, "template": "FileItems", "seconds": 2.5 }
    ],
    "takes": [
      {
        "id": "00000000-0000-4000-8000-000000000701",
        "take_no": 1,
        "recorded_at": "2026-10-13T16:02:00.000Z",
        "state": "awaiting_approval"
      },
      {
        "id": "00000000-0000-4000-8000-000000000703",
        "take_no": 2,
        "recorded_at": "2026-10-13T16:04:00.000Z",
        "state": "merged"
      }
    ],
    "edits": []
  }
}
```

#### `POST marketing/videos/approve`

**Owner:** deferred · **Spec:** §9.1, §9.6, §4 trap 17 · **Success:** 200 · **Guard:** `version` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, version}`

**Response:** `{video:{id, version, ad_id, angle, funnel_key, state, state_word, since, master_duration_seconds, submagic_minutes, can_approve}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `id` | the video is not waiting for approval |
| 404 | `not_found` | none | no video with that id in the caller's org |
| 409 | `stale` | none | version is not the current edit round; current is {version, state} |

- Moves the video to `approved` and stores Chris's staff id. Only a person approves.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c017",
    "id": "00000000-0000-4000-8000-000000000701",
    "version": 1
  },
  "response": {
    "video": {
      "id": "00000000-0000-4000-8000-000000000701",
      "version": 1,
      "ad_id": "91",
      "angle": "Lenders read two files",
      "funnel_key": "roadmap_147",
      "state": "approved",
      "state_word": "Approved",
      "since": "2026-10-13T20:01:00.000Z",
      "master_duration_seconds": 58.4,
      "submagic_minutes": 1.2,
      "can_approve": false
    }
  }
}
```

#### `POST marketing/videos/reject`

**Owner:** deferred · **Spec:** §9.1, §9.6, §4 trap 17 · **Success:** 200 · **Guard:** `version` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, version, reason?}`

**Response:** `{video:{id, version, ad_id, angle, funnel_key, state, state_word, since, master_duration_seconds, submagic_minutes, can_approve}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 404 | `not_found` | none | no video with that id in the caller's org |
| 409 | `stale` | none | version is not the current edit round; current is {version, state} |

- `reason` is optional. The script goes back to Shoot Day with `needs_retake` and keeps its number.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c018",
    "id": "00000000-0000-4000-8000-000000000701",
    "version": 1,
    "reason": "The hook was rushed."
  },
  "response": {
    "video": {
      "id": "00000000-0000-4000-8000-000000000701",
      "version": 1,
      "ad_id": "91",
      "angle": "Lenders read two files",
      "funnel_key": "roadmap_147",
      "state": "rejected",
      "state_word": "Rejected",
      "since": "2026-10-13T20:01:00.000Z",
      "master_duration_seconds": 58.4,
      "submagic_minutes": 1.2,
      "can_approve": false
    }
  }
}
```

#### `POST marketing/videos/edit`

**Owner:** deferred · **Spec:** §9.6 · **Success:** 202 · **Guard:** `version` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, version, kind, lines?, word_from?, word_to?, animation?, text?}`

**Response:** `{queued, job_id, video:{id, version, ad_id, angle, funnel_key, state, state_word, since, master_duration_seconds, submagic_minutes, can_approve}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `kind` | kind is not strike, restore, caption, animation or note |
| 404 | `not_found` | none | no video with that id in the caller's org |
| 409 | `stale` | none | version is not the current edit round; current is {version, state} |

- `kind` `strike` or `restore`: send `lines` (line numbers). `caption`: send `word_from` and `word_to` (the word also joins `caption_dictionary`). `animation`: send `animation` (add, change or remove one overlay). `note`: send `text` (one small model call turns it into an edit when it can; otherwise an agent gets it).
- 202: a recut or re-render job runs. The video moves back as spec §9.1 says (strike to `cut`, caption to `editing`, animation to `rendered`) and `version` goes up by one.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c019",
    "id": "00000000-0000-4000-8000-000000000701",
    "version": 1,
    "kind": "strike",
    "lines": [2]
  },
  "response": {
    "queued": true,
    "job_id": "00000000-0000-4000-8000-000000000503",
    "video": {
      "id": "00000000-0000-4000-8000-000000000701",
      "version": 2,
      "ad_id": "91",
      "angle": "Lenders read two files",
      "funnel_key": "roadmap_147",
      "state": "cut",
      "state_word": "Being cut",
      "since": "2026-10-13T20:01:00.000Z",
      "master_duration_seconds": 58.4,
      "submagic_minutes": 1.2,
      "can_approve": false
    }
  }
}
```

#### `POST marketing/videos/hold-choice`

**Owner:** deferred · **Spec:** §9.1 step 7 · **Success:** 200 · **Guard:** `version` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, version, choice}`

**Response:** `{video:{id, version, ad_id, angle, funnel_key, state, state_word, since, master_duration_seconds, submagic_minutes, can_approve}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `choice` | choice is not use_cut or refilm |
| 404 | `not_found` | none | no held video with that id in the caller's org |
| 409 | `stale` | none | version is not the current edit round; current is {version, state} |

- `use_cut` keeps going with this cut. `refilm` rejects the take, and the script goes back to Shoot Day with `needs_retake`.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c020",
    "id": "00000000-0000-4000-8000-000000000701",
    "version": 1,
    "choice": "use_cut"
  },
  "response": {
    "video": {
      "id": "00000000-0000-4000-8000-000000000701",
      "version": 1,
      "ad_id": "91",
      "angle": "Lenders read two files",
      "funnel_key": "roadmap_147",
      "state": "cut",
      "state_word": "Being cut",
      "since": "2026-10-13T20:01:00.000Z",
      "master_duration_seconds": 58.4,
      "submagic_minutes": 1.2,
      "can_approve": false
    }
  }
}
```

#### `POST marketing/videos/recut`

**Owner:** deferred · **Spec:** §9.1 step 6 · **Success:** 202 · **Guard:** `version` (an older one gets 409 `stale`)

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, version, take_id}`

**Response:** `{queued, job_id, video:{id, version, ad_id, angle, funnel_key, state, state_word, since, master_duration_seconds, submagic_minutes, can_approve}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `take_id` | take_id is not a late take of the same ad |
| 404 | `not_found` | none | no video with that id in the caller's org |
| 409 | `stale` | none | version is not the current edit round; current is {version, state} |

- `take_id` is the late take to recut with. Approving the new master supersedes the old one (spec §9.1 step 6).

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c021",
    "id": "00000000-0000-4000-8000-000000000701",
    "version": 1,
    "take_id": "00000000-0000-4000-8000-000000000703"
  },
  "response": {
    "queued": true,
    "job_id": "00000000-0000-4000-8000-000000000503",
    "video": {
      "id": "00000000-0000-4000-8000-000000000701",
      "version": 2,
      "ad_id": "91",
      "angle": "Lenders read two files",
      "funnel_key": "roadmap_147",
      "state": "cut",
      "state_word": "Being cut",
      "since": "2026-10-13T20:01:00.000Z",
      "master_duration_seconds": 58.4,
      "submagic_minutes": 1.2,
      "can_approve": false
    }
  }
}
```

#### `POST marketing/videos/retry`

**Owner:** deferred · **Spec:** §9.1 (failed -> last_good_status) · **Success:** 202 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id}`

**Response:** `{queued, job_id, video:{id, version, ad_id, angle, funnel_key, state, state_word, since, master_duration_seconds, submagic_minutes, can_approve}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `id` | the video is not failed |
| 404 | `not_found` | none | no video with that id in the caller's org |

- A failed video goes back to its last good step (`last_good_status`).

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c022",
    "id": "00000000-0000-4000-8000-000000000702"
  },
  "response": {
    "queued": true,
    "job_id": "00000000-0000-4000-8000-000000000504",
    "video": {
      "id": "00000000-0000-4000-8000-000000000702",
      "version": 1,
      "ad_id": "92",
      "angle": "Inquiries off first",
      "funnel_key": "book_call",
      "state": "editing",
      "state_word": "Captions",
      "since": "2026-10-13T20:01:00.000Z",
      "master_duration_seconds": 58.4,
      "submagic_minutes": null,
      "can_approve": false
    }
  }
}
```

#### `POST marketing/videos/assign`

**Owner:** deferred · **Spec:** §9.1 step 5 (unmatched takes) · **Success:** 202 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, script_id}`

**Response:** `{queued, job_id, video:{id, version, ad_id, angle, funnel_key, state, state_word, since, master_duration_seconds, submagic_minutes, can_approve}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `script_id` | script_id is not a locked or filmed script of the caller's org |
| 404 | `not_found` | none | no unmatched take with that id in the caller's org |

- Gives an unmatched take its script. The match step carries on from there.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c023",
    "id": "00000000-0000-4000-8000-000000000704",
    "script_id": "00000000-0000-4000-8000-000000000201"
  },
  "response": {
    "queued": true,
    "job_id": "00000000-0000-4000-8000-000000000504",
    "video": {
      "id": "00000000-0000-4000-8000-000000000704",
      "version": 1,
      "ad_id": "92",
      "angle": "Inquiries off first",
      "funnel_key": "book_call",
      "state": "matched",
      "state_word": "Matched",
      "since": "2026-10-13T20:01:00.000Z",
      "master_duration_seconds": null,
      "submagic_minutes": null,
      "can_approve": false
    }
  }
}
```

### 7.3 Brain map (spec §13)

#### `GET marketing/map`

**Owner:** deferred · **Spec:** §13 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{nodes:[{id, type, label, spend_cents, links}], edges:[{from, to, kind}], as_of}`

**Errors:** only the common ones in section 2.

- Node `type`: offer, funnel, angle, ad, script, video, page or batch (Drive docs are optional). Node `id` is `<type>:<key>`.
- `spend_cents` sets the node size. `type` sets the color, always with a word label.
- Edge `kind` is `<from type>_<to type>`: `offer_funnel`, `funnel_page`, `ad_angle`, `ad_funnel`, `ad_page`, `ad_script`, `video_ad`, `script_idea`, `script_batch`.
- `links`: `drive`, `meta` and `repo`, each null when there is none.
- `as_of` is the last Meta sync.

**Example**

```json
{
  "request": {},
  "response": {
    "nodes": [
      {
        "id": "funnel:roadmap_147",
        "type": "funnel",
        "label": "Roadmap $147",
        "spend_cents": 41200,
        "links": { "drive": null, "meta": null, "repo": null }
      },
      {
        "id": "angle:two-files",
        "type": "angle",
        "label": "Lenders read two files",
        "spend_cents": 41200,
        "links": { "drive": null, "meta": null, "repo": "marketing/ads/angles.json" }
      },
      {
        "id": "ad:91",
        "type": "ad",
        "label": "Ad 91",
        "spend_cents": 41200,
        "links": {
          "drive": null,
          "meta": null,
          "repo": "marketing/ads/scripts/machine/2026-W42/03-lenders-read-two-files.md"
        }
      }
    ],
    "edges": [
      { "from": "ad:91", "to": "funnel:roadmap_147", "kind": "ad_funnel" },
      { "from": "ad:91", "to": "angle:two-files", "kind": "ad_angle" }
    ],
    "as_of": "2026-10-12T07:01:50.000Z"
  }
}
```

### 7.4 Page suggestions (spec §14)

#### `GET marketing/pages/suggestions`

**Owner:** deferred · **Spec:** §14 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (query):** `{}`

**Response:** `{suggestions:[{id, batch_id, page, problem, numbers, new_words, status, change:{id, request_path, draft_url, status, error}, created_at, updated_at}]}`

**Errors:** only the common ones in section 2.

- `status` is `new`, `drafted`, `skipped`, `fixed` or `live` (spec §14 step 5).
- `change` is the `page_change_requests` row, or null. Its `status` is `requested`, `drafted`, `fixing`, `fixed`, `pushing`, `live` or `failed`.
- `numbers`: the named numbers behind the problem (rates 0..1).

**Example**

```json
{
  "request": {},
  "response": {
    "suggestions": [
      {
        "id": "00000000-0000-4000-8000-000000000a01",
        "batch_id": "00000000-0000-4000-8000-000000000301",
        "page": "/roadmap",
        "problem": "3 in 4 visitors leave before the video starts.",
        "numbers": { "page_views": 1210, "played_video": 302, "play_rate": 0.25 },
        "new_words": "See what a lender sees in your two files. Press play.",
        "status": "new",
        "change": null,
        "created_at": "2026-10-12T14:00:20.000Z",
        "updated_at": "2026-10-12T14:00:20.000Z"
      }
    ]
  }
}
```

#### `POST marketing/pages/choose`

**Owner:** deferred · **Spec:** §14 steps 2-3 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id, choice}`

**Response:** `{suggestion:{id, batch_id, page, problem, numbers, new_words, status, change:{id, request_path, draft_url, status, error}, created_at, updated_at}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `choice` | choice is not draft or skip |
| 404 | `not_found` | none | no suggestion with that id in the caller's org |

- `draft` writes `ops/page-requests/<date>-<page>.md` through the outbox and a `page_change_requests` row (`requested`). `skip` sets the suggestion to `skipped`.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c024",
    "id": "00000000-0000-4000-8000-000000000a01",
    "choice": "draft"
  },
  "response": {
    "suggestion": {
      "id": "00000000-0000-4000-8000-000000000a01",
      "batch_id": "00000000-0000-4000-8000-000000000301",
      "page": "/roadmap",
      "problem": "3 in 4 visitors leave before the video starts.",
      "numbers": { "page_views": 1210, "played_video": 302, "play_rate": 0.25 },
      "new_words": "See what a lender sees in your two files. Press play.",
      "status": "drafted",
      "change": {
        "id": "00000000-0000-4000-8000-000000000a02",
        "request_path": "ops/page-requests/2026-10-12-roadmap.md",
        "draft_url": null,
        "status": "requested",
        "error": null
      },
      "created_at": "2026-10-12T14:00:20.000Z",
      "updated_at": "2026-10-12T15:20:00.000Z"
    }
  }
}
```

#### `POST marketing/pages/fix-it`

**Owner:** deferred · **Spec:** §14 step 3 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id}`

**Response:** `{suggestion:{id, batch_id, page, problem, numbers, new_words, status, change:{id, request_path, draft_url, status, error}, created_at, updated_at}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `id` | the change is not drafted yet |
| 404 | `not_found` | none | no suggestion with that id in the caller's org |

- Only sets the change to `fixing`. An agent session builds the green version by the marked-draft law and moves the row on (spec §14).

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c025",
    "id": "00000000-0000-4000-8000-000000000a01"
  },
  "response": {
    "suggestion": {
      "id": "00000000-0000-4000-8000-000000000a01",
      "batch_id": "00000000-0000-4000-8000-000000000301",
      "page": "/roadmap",
      "problem": "3 in 4 visitors leave before the video starts.",
      "numbers": { "page_views": 1210, "played_video": 302, "play_rate": 0.25 },
      "new_words": "See what a lender sees in your two files. Press play.",
      "status": "drafted",
      "change": {
        "id": "00000000-0000-4000-8000-000000000a02",
        "request_path": "ops/page-requests/2026-10-12-roadmap.md",
        "draft_url": "https://claude.ai/artifact/example",
        "status": "fixing",
        "error": null
      },
      "created_at": "2026-10-12T14:00:20.000Z",
      "updated_at": "2026-10-13T15:00:00.000Z"
    }
  }
}
```

#### `POST marketing/pages/push-live`

**Owner:** deferred · **Spec:** §14 step 3 · **Success:** 200 · **Guard:** none

**Gate:** ROLE_SETS.MARKETING (owner, admin)

**Request (JSON body):** `{request_id, id}`

**Response:** `{suggestion:{id, batch_id, page, problem, numbers, new_words, status, change:{id, request_path, draft_url, status, error}, created_at, updated_at}}`

**Errors** (besides the common ones in section 2):

| Status | error | field | When |
|---|---|---|---|
| 400 | `invalid` | `id` | the change is not fixed yet |
| 404 | `not_found` | none | no suggestion with that id in the caller's org |

- Only sets the change to `pushing`. An agent pushes with the ClickFunnels push script, proves the live page, and moves the row to `live`.

**Example**

```json
{
  "request": {
    "request_id": "00000000-0000-4000-8000-00000000c026",
    "id": "00000000-0000-4000-8000-000000000a01"
  },
  "response": {
    "suggestion": {
      "id": "00000000-0000-4000-8000-000000000a01",
      "batch_id": "00000000-0000-4000-8000-000000000301",
      "page": "/roadmap",
      "problem": "3 in 4 visitors leave before the video starts.",
      "numbers": { "page_views": 1210, "played_video": 302, "play_rate": 0.25 },
      "new_words": "See what a lender sees in your two files. Press play.",
      "status": "fixed",
      "change": {
        "id": "00000000-0000-4000-8000-000000000a02",
        "request_path": "ops/page-requests/2026-10-12-roadmap.md",
        "draft_url": "https://claude.ai/artifact/example",
        "status": "pushing",
        "error": null
      },
      "created_at": "2026-10-12T14:00:20.000Z",
      "updated_at": "2026-10-13T16:00:00.000Z"
    }
  }
}
```

## 8. Gaps found while writing this contract

These are findings, not fixes. Nothing here changes a route.

1. **Routes the design doc names that spec v3 does not.** `GET marketing/costs`, `GET marketing/flywheel`, `GET marketing/report`, `POST marketing/clarity/pull`, `GET marketing/submagic/templates` and `POST marketing/buzz/test` appear only in `docs/specs/command-center-design-2026-10-05.md`. They are not in this contract. A unit that builds one asks first (the spec is the yardstick for this pass) and then adds it here and to the module.
2. **Design shapes that differ from the fixed shapes.** Where they differ, this contract wins (section 3). The main ones:
   - The design's Today body (`alerts`, `needs_you`, `pipeline`, `next_drop`, `money`, `by_funnel`, `machine`) is not fixed shape 7. Today here keeps every existing key and adds `numbers`, `daily`, `spend_by_funnel`, `flow`, `scripts_waiting` and `stuck_jobs`.
   - The design's health body (`outbox{pending, ...}`, `last_syncs`, `model_spend`) is not fixed shape 6.
   - The design's scripts list adds `slot_reason`, `cost_usd` and a `batch` object, and its approve answers `outbox_id`. Fixed shape 3 has none of them.
   - The design's `POST marketing/meta/load {all? | script_id}` is fixed shape 10's `{ad_video_id}` or `{all:true}`, and its load-status `rows` and `counts` are fixed shape 10's `loads`.
   - The design's turn-on body `{action:'resume_ad', target:'ad', id}` is fixed shape 11's `{action:'resume_ad', ad_id, request_id}`.
   - The design's ads rows (`ad_id`, `angle`, `link_clicks`, `plays`, `hold_2s`, `sales_ours`, `sales_meta`, `cpb_cents`, `last_day`, `unknown_ad`) are not fixed shape 8's rows.
   - The design's "New opening" sends `POST marketing/ideas {kind:'opening'}`. Fixed shape 4 has no `kind` in the ideas request, and spec §11.3 "New opening" is deferred in the plan.
   - The design names the video id `video_id` on retry, assign and hold-choice. This contract uses `id` on every video write.
3. **`GET marketing/today` and `as_of`.** The global rule says a read with Meta numbers returns `as_of` = the last sync time. Today's existing `as_of` is when the answer was built, and today's keys may not change, so it stays. Its sync time is `last_sync.metrics_synced_at`.
4. **`stuck_jobs` wording.** U32's acceptance says each stuck job carries a "reason". The fixed key is `error` (the plain reason).
5. **`resume_ad` repeats.** U15's brief says a repeat re-sends ACTIVE. The global rule says the same `request_id` returns the saved answer. Both hold: same `request_id` gets the saved answer, and a new `request_id` sends ACTIVE again, which is harmless at Meta.
6. **The next-batch guard.** `POST marketing/batches/next` guards on `marketing_settings.updated_at`, which `GET marketing/batches/next` does not return. The screen reads it from `GET marketing/settings`.
7. **Types the database does not hand over as-is.** `next_ad_number()` returns a whole number and `marketing_funnels.weight` is `numeric` (the driver returns a string). The routes send the ad number as a string of digits and the weight as a JSON number.
8. **Write-now cost refusals.** No document fixed the status for "a cost cap is reached". This contract uses `400 {error:'cap_reached', message}` on write-now, and on `POST marketing/ideas` with `write_now: true` it still saves the idea and leaves out `batch_id` and `job_id`, with a plain `note`.

## 9. Changing this contract

1. Change the route section here and the entry in `src/marketing/api-contract.mjs` in the same PR (spec §7.8).
2. A route section's **Request** and **Response** lines are `describeShape()` of the module's key lists, and its **Errors** rows and **Example** are the module's. The test checks all of them, plus the owner.
3. Run `node --test src/marketing/api-contract.test.mjs`.

**In a back-end test** (for example `src/http/marketing-settings.pg.test.mjs`):

```js
import { assertMatchesContract } from "../marketing/api-contract.mjs";
assertMatchesContract("GET marketing/settings", body); // throws and lists every missing key
```

**In a lane E mock** (a Playwright stub under `e2e/`; the browser cannot load `src/`):

```js
import { exampleResponse } from "../src/marketing/api-contract.mjs";
await page.route("**/api/marketing/batches", (route) =>
  route.fulfill({ json: exampleResponse("GET marketing/batches") }) // a fresh copy, safe to change
);
```
