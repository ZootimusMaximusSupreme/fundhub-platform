# `GET /api/marketing/today` — the contract

The Today tab of the Marketing Command Center (`public/app/marketing-command-center.*`)
reads this one endpoint. This file is the shape the page codes against.

- Handler: `api/marketing/today.mjs`. Route key `marketing/today` in `netlify/functions/api.mjs`.
- Tests: `src/http/marketing-today.test.mjs` (no database) and `src/http/marketing-today.pg.test.mjs` (real Postgres).
- Plan: `docs/specs/marketing-dashboard-plan-2026-10-05.md` §4 Step B and §5.
- Slice 0 of `docs/specs/command-center-design-2026-10-05.md` §6 ("Today tells the truth",
  2026-10-05) added `spend.through`, `prior_30_days`, whole-day windows,
  `last_sync.clickfunnels_synced_at`, `costs`, and a review card and counts on every
  flywheel stage.

## Who can call it

| Caller | Answer |
|---|---|
| No session | `401 {ok:false, error:"unauthorized"}` |
| Staff whose role is not owner or admin | `403 {ok:false, error:"forbidden", message}` (`ROLE_SETS.MARKETING`) |
| Owner or admin | `200`, the body below |
| Any method but GET | `405`, header `Allow: GET` |
| Database not answering | `503 {ok:false, error:"db_unavailable", db:"down", message}` |

Read only. It writes nothing, calls no model and calls no ad platform.

## Rules every field follows

- **`null` means unknown.** It is never turned into `0`. A spend window with no saved ad-days is `null`.
- **Money is integer cents** (`spend_cents`). Divide by 100 only to print it.
- **"Today" is Arizona's day** (`America/Phoenix`, no daylight saving). Every window is whole Arizona days, both ends included.
- **The 7 and 30 day windows are whole days.** They end on `spend.through`, never on today
  or later. `spend.through` is the LATER of two days: the newest day with saved ad numbers,
  and the last whole day the newest Meta pull covered (the day before the pull's own
  Arizona day: the midnight pull on Oct 5 covers Oct 4). So `last_7_days` is 7 full days and
  `prior_7_days` is the 7 full days before it, and the same for 30. Only `today` is today.
  With nothing saved at all the windows end yesterday and `through` is `null`.
- **The windows keep moving when ads stop.** Meta sends no row for a day no ad ran, so the
  newest saved day freezes the moment ads stop. Because the pull's own day counts too,
  `last_7_days` on Oct 12 is Oct 5 to Oct 11 even when the last ad ran Oct 4. A window the
  pull covered that holds no rows is still `null` (not `0`), and the page says "No ad spend
  saved for Oct 5 to Oct 11." `last_sync.latest_metrics_date` still names the last day with
  any ad numbers.
- **A cost is measured or it is `null`.** Dollars come only from a model price with a
  source (`src/marketing/model-prices.mjs`). No row, or a model with no price on file, is
  `null`, and the page prints "unknown".
- **A part that cannot be read yet is empty, not an error.** It is named in `waiting` with a plain sentence. "Cannot be read yet" means its table or column is not in the database yet, or its source data is not there (no Meta numbers, no flywheel files on the server, no house partner). An empty list of copy is not "waiting": it just means nothing has been written yet.
- Times (`*_at`) are ISO 8601 UTC strings. Dates (`today`, `from`, `to`, `latest_metrics_date`) are `YYYY-MM-DD`.
- No key value is ever in the answer. Keys are named, never shown.

## The body

```jsonc
{
  "ok": true,
  "as_of": "2026-10-06T01:10:00.000Z",   // when this answer was built (server clock)
  "today": "2026-10-05",                 // Arizona's day the windows are built from
  "timezone": "America/Phoenix",

  // Parts that could not be read yet. Empty when everything answered.
  // part is one of: "flywheel", "copy", "copy_ready", "spend", "last_sync",
  // "clickfunnels", "costs"
  "waiting": [
    { "part": "spend", "reason": "No ad numbers are saved yet." }
  ],

  // null when the flywheel files are not on this server (then "flywheel" is in waiting).
  "flywheel": {
    "campaigns": [                        // one per folder under marketing/flywheel/
      {
        "campaign": "partner",
        "stages": [
          {
            "n": 3,
            "key": "offer",               // avatar | ad-research | offer | copy | ad-strategy | spend
            "label": "offer",
            "file": "03-offer.md",
            "state": "FAILED",            // READY | STALE | BLOCKED | FAILED | MISSING
            "approved": false,            // true only when READY and its file says status: approved
            "status": "FAILED",           // the middle column of `npm run flywheel:status`: "ready approved", "ready not reviewed", or the state
            "why": "did not report guarantees",   // the last column of that same line; null if blank
            "reasons": ["did not report guarantees"],
            "line": "3 offer          FAILED                 did not report guarantees",  // the command's line, word for word
            "counts": { "priceSet": 1, "bonuses": 3, "valueEquationScores": 4 },  // the file's own front-matter counts; {} when no file
            "review_card": "**What this decided:** …"   // the text under "## Review card" (markdown, max 4,000 characters); null when no file or no card
          }
        ],
        "advice": "2 stages need re-running. Do them in order: 3, then 4."  // the command's closing line, or null
      }
    ]
  },

  // The house partner's ad copy (slug fundhub-house). Empty lists (and "copy" in waiting)
  // when there is no house partner or its copy tables are missing; null only if the
  // house partner could not be looked up at all.
  "copy": {
    "partner_id": "55272246-…",           // pass this as partner_id to POST /api/creative/generate and /api/creative/run
    "pieces": [                           // newest first, at most 10, archived left out
      {
        "id": "…",
        "created_at": "2026-09-17T19:46:37.140Z",
        "compliance_state": "passed",     // pending | passed | blocked | approved (approved is a person only)
        "blocked_reasons": [],            // why the screen blocked it, when blocked
        "copy_text": "The words…",
        "provider": "copy",
        "script_id": null,
        "job_id": "…"                     // the job that wrote it, or null
      }
    ],
    "jobs": [                             // newest first, at most 5, copy jobs only
      {
        "id": "…",
        "status": "failed",               // queued | running | succeeded | failed
        "provider": "copy",
        "error": "…",                     // the engineer's sentence when it failed; translate on the page
        "attempt": 1,
        "cost_cents": 0,
        "prompt": "the angle Chris typed",
        "offer_type": "funding",
        "created_at": "…", "started_at": "…", "finished_at": "…"
      }
    ]
  },

  // Can "Write ad copy" run right now? Show `missing` before the button is pressed.
  "copy_ready": {
    "ready": true,                        // true | false | null (null = could not be checked; see waiting)
    "partner_id": "55272246-…",
    "checks": [
      { "key": "marketing_switch", "ok": true, "label": "The marketing switch is on for the house partner.", "missing": null },
      { "key": "copy_provider",    "ok": true, "label": "A copy writer is set up for this company.", "missing": null },
      { "key": "anthropic_key",    "ok": true, "label": "The Anthropic key (ANTHROPIC_API_KEY) is set.", "missing": null },
      { "key": "writing_budget",   "ok": true, "label": "This month's writing budget has room.", "missing": null, "used": 0, "cap": 250000 }
    ],
    "missing": []                         // the plain sentence of every failed check, in order
  },
  // When there is no house partner, checks is one row with key "house_partner".

  // Ad spend for the whole company (every partner; Chris's Meta account is synced under fundhub-direct).
  // null only when its table is missing.
  "spend": {
    "currency": "USD",
    "through": "2026-10-04",               // the last day the 7 and 30 day windows include (see the rules above); null when nothing is saved
    "windows": {
      "today":         { "from": "2026-10-05", "to": "2026-10-05", "days": 1,  "spend_cents": null,  "ad_days": 0,  "days_with_data": 0 },
      "last_7_days":   { "from": "2026-09-28", "to": "2026-10-04", "days": 7,  "spend_cents": 70727, "ad_days": 28, "days_with_data": 7 },
      "prior_7_days":  { "from": "2026-09-21", "to": "2026-09-27", "days": 7,  "spend_cents": 20822, "ad_days": 8,  "days_with_data": 2 },
      "last_30_days":  { "from": "2026-09-05", "to": "2026-10-04", "days": 30, "spend_cents": 91549, "ad_days": 36, "days_with_data": 9 },
      "prior_30_days": { "from": "2026-08-06", "to": "2026-09-04", "days": 30, "spend_cents": 62807, "ad_days": 28, "days_with_data": 11 }
    }
  },
  // ad_days = saved ad-day rows in the window; days_with_data = distinct days that have any.
  // "today" is usually null: the Meta sync saves through yesterday. The page says
  // "Today's numbers come in tomorrow morning" while the pull is fresh.

  // null only when the Meta part's table is missing.
  "last_sync": {
    "meta_synced_at": "2026-10-05T07:01:50.324Z",     // the Meta connection's last pull
    "metrics_synced_at": "2026-10-05T07:01:51.559Z",  // newest saved ad-day row
    "latest_metrics_date": "2026-10-04",               // newest day with numbers
    "clickfunnels_synced_at": "2026-10-04T22:10:00.872Z" // analytics_connections.last_synced_at (platform clickfunnels); null = never pulled
  },

  // What the last measured runs cost. Each side is null only when its table is missing
  // (then "costs" is in waiting).
  "costs": {
    // The newest finished Write offer run that saved its token counts (marketing_jobs, kind offer).
    "offer": {
      "measured": true,                     // false when no run has finished; every number below is then null
      "job_id": "…",
      "finished_at": "2026-10-05T18:04:29.000Z",
      "seconds": 269,                       // claimed_at → finished_at; null if either is missing
      "input_tokens": 24551,
      "output_tokens": 28640,
      "models": ["claude-opus-5-5"],
      "cost_cents": 67,                     // null when any call used a model with no price on file
      "under_one_cent": false,              // true when a priced run rounds to 0 cents but was not free
      "unpriced_models": []                 // the models that made cost_cents null
    },
    // The copy writer's last 5 model calls (partner_ai_usage, purpose 'creative', the house partner).
    "copy": {
      "runs": 0,                            // 0 = nothing measured yet; every number below is then null
      "last_at": null,
      "models": [],
      "avg_input_tokens": null,
      "avg_output_tokens": null,
      "avg_cost_cents": null,               // null when no runs, or when a run's model has no price on file
      "under_one_cent": false,
      "unpriced_models": []
    }
  }
}
```

The spend numbers in the example are the real ones a read-only `SUM(spend_cents)` over
those exact days returned against the live database, read on 2026-10-05 at 11:32 PM
Arizona, after the U21 Meta backfill (824054e55) re-saved the rows: Sep 28 to Oct 4:
$707.27; Sep 21 to 27: $208.22; Sep 5 to Oct 4: $915.49; Aug 6 to Sep 4: $628.07. (An
earlier read the same day, before the backfill, gave $707.24, $915.46 and $86.86; those are
dead.) The ClickFunnels time is the live row. The `costs.offer` example is the shape of the offer
contract's one measured run (`docs/specs/marketing-offer-contract.md`); on 2026-10-05 the
live `marketing_jobs` table had no rows and `partner_ai_usage` had no `creative` rows, so
the live page reads both costs as "unknown, not measured yet".

The time printed under Write ad copy is not in `costs`. The page reads it off `copy.jobs`:
the newest `succeeded` copy job's `started_at` to `finished_at`. With no finished copy job
(the case on 2026-10-05: a read-only count found no copy jobs at all in the live
database; the one job on file is a failed `static` job) it prints "Time: unknown, not
measured yet."

## Model prices

`src/marketing/model-prices.mjs` holds the only prices the page may use, each with its
source. Today that is one row: `claude-opus-5-5` at $4 per million input tokens and $20
per million output tokens (Anthropic's published list price, and the rate the offer
contract measured with). The copy writer's default, `claude-sonnet-4-5-20250929`, and
`gpt-4o-mini` have no price written down anywhere in this repo, so a run on either prints
"unknown". A row is added only with its source beside it.

## Pressing "Write ad copy"

The page uses the endpoints that already exist. Nothing new.

1. `POST /api/creative/generate` with
   `{partner_id: copy.partner_id, asset_kind: "copy", offer_type: "funding" | "credit_cards" | "credit_repair", prompt, idempotency_key}`.
   Its answer carries `provider_ready` and a plain `note`.
2. `POST /api/creative/run` with `{partner_id: copy.partner_id, max_jobs: 1}`. One press runs at
   most one job, so it pays for at most one (`maxJobsFrom` in `api/creative/run.mjs`: a whole
   number 1 to 10 is used exactly; anything else is 3). Its answer carries `succeeded`,
   `failed`, `requeued`, `jobs` and a plain `note`.
3. Read `GET /api/marketing/today` again. The new piece is first in `copy.pieces`.

If step 2 times out, its claim and its run are one database transaction, so the database
undoes them and the job is back in the queue. The creative runner
(`creative-job-runner`, `*/2 * * * *` in `netlify.toml`) picks up queued jobs every
2 minutes. Read Today again after that.

The writer tries OpenAI first. When OpenAI says it has no credit, it asks Anthropic
once (`src/creative/providers/copy.mjs`).
