# `GET /api/marketing/today` — the contract

The Today tab of the Marketing Command Center (`public/app/marketing-command-center.*`)
reads this one endpoint. This file is the shape the page codes against.

- Handler: `api/marketing/today.mjs`. Route key `marketing/today` in `netlify/functions/api.mjs`.
- Tests: `src/http/marketing-today.test.mjs` (no database) and `src/http/marketing-today.pg.test.mjs` (real Postgres). The M5 keys (U32): also `src/marketing/metrics-rollups.test.mjs`.
- Plan: `docs/specs/marketing-dashboard-plan-2026-10-05.md` §4 Step B and §5.

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
  // and since U32: "numbers", "spend_by_funnel", "scripts_waiting", "stuck_jobs"
  "waiting": [
    { "part": "spend", "reason": "No ad numbers are saved for the last 30 days." }
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
            "line": "3 offer          FAILED                 did not report guarantees"  // the command's line, word for word
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
    "windows": {
      "today":        { "from": "2026-10-05", "to": "2026-10-05", "days": 1,  "spend_cents": null,  "ad_days": 0,  "days_with_data": 0 },
      "last_7_days":  { "from": "2026-09-29", "to": "2026-10-05", "days": 7,  "spend_cents": 60653, "ad_days": 24, "days_with_data": 6 },
      "prior_7_days": { "from": "2026-09-22", "to": "2026-09-28", "days": 7,  "spend_cents": 30893, "ad_days": 12, "days_with_data": 3 },
      "last_30_days": { "from": "2026-09-06", "to": "2026-10-05", "days": 30, "spend_cents": 91546, "ad_days": 36, "days_with_data": 9 }
    }
  },
  // ad_days = saved ad-day rows in the window; days_with_data = distinct days that have any.
  // "today" is usually null: the Meta sync saves through yesterday.

  // null only when its table is missing.
  "last_sync": {
    "meta_synced_at": "2026-10-05T07:01:50.324Z",     // the Meta connection's last pull
    "metrics_synced_at": "2026-10-05T07:01:51.559Z",  // newest saved ad-day row
    "latest_metrics_date": "2026-10-04"                // newest day with numbers
  }
}
```

The spend numbers in the example are the real ones the endpoint's SQL returned against the
live database on 2026-10-05 (read only), and they match a plain `SUM(spend_cents)` over the
same days.

## Added by U32: the M5 numbers (2026-10-06)

Six keys come AFTER `last_sync`. Every key above keeps its name, its place and its value
(the M11 board rule: never rename a today key). The fixed shape is
`docs/specs/marketing-machine-api.md` shape 7; `src/marketing/api-contract.mjs`
`assertMatchesContract("GET marketing/today", body)` checks it.

- Code: `api/marketing/today.mjs` (part 5) and `src/marketing/metrics-rollups.mjs`. The
  counting rules are U20's: `src/marketing/metrics.mjs`, in words in
  `docs/marketing/metrics.md` (spend by Meta's Arizona spend day; everything else by the
  Arizona lead day; a lead's results count for 14 days; first touch; demo rows out).
- The four parts read side by side, each in its own short transaction. A part whose table
  is not there yet comes back empty (`null` for an object, `[]` for a list) and is named
  in `waiting`, in this order: `numbers`, `spend_by_funnel`, `scripts_waiting`,
  `stuck_jobs`.
- Same windows as `spend`: whole Arizona days ending `today`.

```jsonc
{
  // … every key above, unchanged …

  // today / d7 / d30 = spend.windows today / last_7_days / last_30_days.
  // spend_cents is the same number spend.windows prints (null = no ad-day saved).
  // leads, booked, showed, sales, roadmaps are people (a real 0 is 0).
  // cash_cents = succeeded transactions (null only when every payment had no amount);
  // reported_cash_cents = what closers typed (call_outcomes.cash_collected_cents).
  // roas = cash ÷ spend as a decimal; null when spend is unknown or 0.
  "numbers": {
    "today": { "spend_cents": null,  "leads": 1, "booked": 0, "showed": 0, "sales": 0, "roadmaps": 0, "cash_cents": 0,     "reported_cash_cents": 0,     "roas": null },
    "d7":    { "spend_cents": 1700,  "leads": 2, "booked": 1, "showed": 1, "sales": 1, "roadmaps": 0, "cash_cents": 50000, "reported_cash_cents": 30000, "roas": 29.4118 },
    "d30":   { "spend_cents": 2450,  "leads": 3, "booked": 1, "showed": 1, "sales": 1, "roadmaps": 0, "cash_cents": 50000, "reported_cash_cents": 30000, "roas": 20.4082 }
  },

  // The sparklines: the last 30 Arizona days, oldest first, every day present.
  // spend_cents null on a day with no saved ad-day. leads sit on the lead's own day.
  "daily": [ { "date": "2026-09-07", "spend_cents": null, "leads": 0 }, "… 30 rows …" ],

  // Last 7 days. Which funnel: the ad number's live script names one (ad_scripts.funnel_key)
  // → that funnel; else the ad's Meta campaign is on a funnel's meta_campaign_ids (Chris maps
  // these in Settings) → that funnel; else Unmapped. Every active funnel is listed, biggest
  // spend first. A funnel with nothing placed on it is null (unknown) while some spend is
  // unmapped, and a known 0 when all saved spend is placed. The one row with funnel_key null
  // is the Unmapped spend; it is there only when some saved spend belongs to no funnel.
  // Both live funnels start with no campaigns mapped, so most spend reads Unmapped until then.
  "spend_by_funnel": [
    { "funnel_key": "roadmap_147", "name": "Roadmap",     "spend_cents": 1200 },
    { "funnel_key": "book_call",   "name": "Book a call", "spend_cents": null },
    { "funnel_key": null,          "name": "Unmapped",    "spend_cents": 500 }
  ],

  // Last 7 days: ad -> page -> lead -> call -> sale.
  // page_views = funnel.page events from people (payload actor 'person', demo out) on a
  //   funnel's landing page (each landing page once); null when no funnel lands on a page the
  //   tracker runs on (src/funnel/pages.mjs) or the funnel list could not be read.
  // clicks = link clicks on the ads (Meta's link_clicks); null when Meta reported none.
  // leads, booked, showed, sales = numbers.d7.
  "flow": { "page_views": 3, "clicks": null, "leads": 2, "booked": 1, "showed": 1, "sales": 1 },

  // Scripts waiting on Chris: drafts he can see and has not decided — status draft, not
  // archived, not an import, and in no batch or in a batch released with release_at passed
  // (spec §7.7). flagged = those of them the machine wrote that still failed a check
  // ("needs a look": check_results.flagged true, or a check section with passed false).
  "scripts_waiting": { "ready": 4, "flagged": 2 },

  // Failed marketing jobs, newest failure first, at most 20. id is what Retry posts
  // (POST marketing/jobs/retry {request_id, job_id}). error is the plain reason the worker
  // saved; since is when it failed (finished_at). Jobs of kind "offer" are left out: they
  // run on the Write offer button's own path and Retry refuses them.
  "stuck_jobs": [
    { "id": "00000000-0000-4000-8000-000000000501", "kind": "write_slot",
      "error": "The writer stopped: the model took longer than 5 minutes.", "since": "2026-10-06T12:40:00.000Z" }
  ]
}
```

The numbers in this example are the fixture in `src/http/marketing-today.pg.test.mjs`, not
live ones.

## Pressing "Write ad copy"

The page uses the endpoints that already exist. Nothing new.

1. `POST /api/creative/generate` with
   `{partner_id: copy.partner_id, asset_kind: "copy", offer_type: "funding" | "credit_cards" | "credit_repair", prompt, idempotency_key}`.
   Its answer carries `provider_ready` and a plain `note`.
2. `POST /api/creative/run` with `{partner_id: copy.partner_id}`. Its answer carries `succeeded`, `failed`, `requeued`, `jobs` and a plain `note`.
3. Read `GET /api/marketing/today` again. The new piece is first in `copy.pieces`.

If step 2 times out, its claim and its run are one database transaction, so the database
undoes them and the job is back in the queue. The creative runner
(`creative-job-runner`, `*/2 * * * *` in `netlify.toml`) picks up queued jobs every
2 minutes. Read Today again after that.

The writer tries OpenAI first. When OpenAI says it has no credit, it asks Anthropic
once (`src/creative/providers/copy.mjs`).
