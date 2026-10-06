# Offer generator — endpoint contract

Written 2026-10-05 by workflow M12 of `ops/workflows/perfect-machine-2026-10-05.md`.
For the dashboard (M11) to wire the **Write offer** button and the Offer card.

## Words used here

- **Run** — one press of Write offer. It is one row in `marketing_jobs` with `kind = 'offer'`.
- **Poll** — ask again every few seconds until the run is finished.
- **Review card** — the flywheel's four-line block: what this decided, three things to check, what I wasn't sure about, say one of.

## The address

`/api/marketing/offer/generate` — one address, two methods.

- **Who:** owner and admin only. Anyone else gets `403`. No session gets `401`.
- **Sign-in:** the normal staff session (`Authorization: Bearer <fh_token>`, or the `fundhub_session` cookie).
- **Code:** `api/marketing/offer/generate.mjs`. The route key is `marketing/offer/generate` in `netlify/functions/api.mjs`.

## How a run works

1. The page sends `POST`. The server saves the run as `queued` and answers **at once** with `202`.
2. A background writer (`netlify/functions/marketing-offer-background.mjs`, 15-minute limit) writes the offer. It takes a few minutes: six offers, four judges, one winner, then a write-up.
3. The page polls `GET ?id=<run id>` every 5–10 seconds until `job.status` is `done` or `failed`.
4. On `done`, the response holds the offer. On `failed`, `job.error` says why in plain words.

Only **one run at a time** per company. A second press while one is running gets that same run back (`already_running: true`), not a second paid one.

## POST — start a run

Request body (JSON). Every field is optional.

```json
{
  "campaign": "partner",
  "avatar_summary": "text",
  "ad_research_summary": "text",
  "owner_notes": "text"
}
```

| Field | If left out | Limit |
|---|---|---|
| `campaign` | `"partner"`. Lower-case letters, numbers and dashes only. | 41 characters |
| `avatar_summary` | The body of `marketing/flywheel/<campaign>/01-avatar.md` | cut to 8,000 characters |
| `ad_research_summary` | The body of `marketing/flywheel/<campaign>/02-ad-research.md`. May be empty: the offer is then built from the avatar, and the review card says so. | cut to 8,000 characters |
| `owner_notes` | The `## Notes` section of `marketing/flywheel/<campaign>/00-OWNER-NOTES.md` | cut to 2,000 characters |

Answers:

| Status | Body | Meaning |
|---|---|---|
| `202` | `{ "ok": true, "started": true, "already_running": false, "job": Job, "poll": "/api/marketing/offer/generate?id=<id>", "message": "…" }` | Started. Poll it. |
| `202` | `{ "ok": true, "started": false, "already_running": true, "job": Job, "poll": "…", "message": "An offer is already being written. This is that run." }` | One was already running. Poll that one. |
| `400` | `{ "ok": false, "error": "bad_campaign" \| "bad_input" \| "avatar_required", "message": "…" }` | Nothing saved. Show `message`. |
| `401` / `403` | `{ "ok": false, "error": "unauthorized" \| "forbidden" }` | Not signed in / not owner or admin. |
| `502` | `{ "ok": false, "error": "worker_unreachable", "message": "…", "job": Job }` | The writer could not be started. The run is saved as `failed` with that reason. Pressing again starts fresh. |
| `503` | `{ "ok": false, "error": "no_model", "message": "…" }` | No Anthropic key on the site. Nothing saved. |
| `503` | `{ "ok": false, "error": "not_ready", "message": "…" }` | The database table is not live yet (before the ship). Nothing saved. |
| `503` | `{ "ok": false, "error": "db_unavailable", … }` | The database is down (the shared `dbDown` shape). |

## GET — read back

- `GET /api/marketing/offer/generate?id=<run id>` → that run.
- `GET /api/marketing/offer/generate` → the newest run (any state) and the newest **finished** offer. This is the Offer card.

| Status | Body |
|---|---|
| `200` | `{ "ok": true, "ready": true, "job": Job \| null, "offer": Offer \| null }` |
| `200` | `{ "ok": true, "ready": false, "job": null, "offer": null, "message": "…not live yet…" }` — before the ship |
| `400` | `{ "ok": false, "error": "bad_id" }` — `id` is not a run id |
| `404` | `{ "ok": false, "error": "not_found" }` — no such run in this company |

With `?id=`, `offer` is filled only when that run is `done`. Without `id`, `job` and `offer` can be different runs: for example the newest run failed, and `offer` is the last good one.

## Job

```json
{
  "id": "uuid",
  "status": "queued | running | done | failed",
  "campaign": "partner",
  "created_at": "2026-10-05T18:00:00.000Z",
  "claimed_at": "… or null",
  "finished_at": "… or null",
  "attempts": 1,
  "requested_by": "staff uuid or null",
  "error": "plain sentence when failed, else null"
}
```

## Offer

```json
{
  "job_id": "uuid",
  "campaign": "partner",
  "as_of": "2026-10-05",
  "finished_at": "…",
  "offer": {
    "oneSentence": "…",
    "name": "…",
    "price": "$10,000 once, can be financed",
    "whyThisPrice": "…",
    "whatTheyGet": ["…"],
    "guarantees": [
      { "name": "…", "promise": "…", "shape": "result-tied-with-make-good | conditional-satisfaction | win-your-money-back | trial-with-penalty | priced-add-on | paid-tier | tied-to-continued-purchase | null",
        "conditions": "… or none", "whatItCostsUsIfItFires": "…", "needsOwnerDecision": "… or none" }
    ],
    "bonuses": ["…"],
    "tookFromLosers": [{ "from": "E-effort", "what": "…", "why": "…" }],
    "killShotsAnswered": [{ "killShot": "…", "whatWeDid": "…" }],
    "thirtyDayMath": "…",
    "claimsRemoved": ["…"]
  },
  "review_card": {
    "whatThisDecided": "one sentence",
    "threeThingsToCheck": ["The price is $10,000 … — yes or no?", "Can we deliver this every time?", "Can we afford the guarantee if three people claim it?"],
    "notSureAbout": ["…"],
    "sayOneOf": "approve · tweak: <what to change> · redo",
    "markdown": "## Review card\n\n**What this decided:** …"
  },
  "document": "the whole offer as markdown: nine sections, then the review card",
  "synthesized": true,
  "winner": { "blindId": "Offer B", "archetype": "C-risk", "name": "…", "weighted": 7.4, "maxSpread": 6, "judgeCount": 4 },
  "runner_up": { "…same shape…" },
  "runoff_advised": false,
  "scores": [{ "blindId": "…", "archetype": "…", "name": "…", "weighted": 7.4, "maxSpread": 6, "judgeCount": 4, "seats": ["buyer", "operator", "accountant", "competitor"], "dims": { "perceivedLikelihood": { "mean": 8.5, "spread": 2 } } }],
  "unjudged": [],
  "candidates": ["all six candidates as written, each with its blindId and archetype"],
  "counts": { "priceSet": 1, "bonuses": 3, "guarantees": 2, "valueEquationScores": 4 },
  "checks": {
    "priceIssues": ["plain sentence per price not on src/config/offers.mjs"],
    "gate": { "passes": false, "misses": ["The flywheel's stage 3 check wants at least 3 bonuses; this offer has 0."] }
  },
  "inputs": { "sources": { "avatar": "supplied | marketing/flywheel/partner/01-avatar.md | null", "adResearch": "…", "ownerNotes": "…" }, "cut": { "avatar": true, "adResearch": true, "ownerNotes": false } },
  "model": "claude-opus-5-5",
  "usage": { "calls": [{ "step": "candidates", "model": "…", "input_tokens": 0, "output_tokens": 0, "stop_reason": "end_turn" }], "input_tokens": 0, "output_tokens": 0 }
}
```

`checks.gate` is the same minimum `npm run flywheel:status` holds stage 3 to (one price, 3+ bonuses, 2+ guarantees, all four value scores). A miss is also the first lines of `review_card.notSureAbout`. Nothing is padded to pass it.

**What the Offer card should show first:** `review_card` (the four lines), then `offer.name` and `offer.price`. `document` is the long read. `synthesized: false` means the write-up step failed and the card shows the winning offer as first written; the first line of `notSureAbout` says so.

## How long and how much

Measured on one real run, 2026-10-05, model `claude-opus-5-5`, the partner flywheel files as inputs: **4 minutes 29 seconds** (six offers 118 s, judges 97 s, write-up 54 s), **24,551 input and 28,640 output tokens** — about **$0.67** at $4 / $20 per million tokens. Poll for at least 10 minutes before calling a run stuck; the server closes a run with no word for 16 minutes as `failed`.

## What the generator may read

Only these. Nothing else about Fundhub reaches the prompt.

- The three summaries above.
- The price list built from `src/config/offers.mjs` on every run.
- The cost to get a customer, the close rate and the ad budget are **not on file**. The prompt says so, and the 30-day arithmetic names the missing number instead of guessing it.

## Example: wire the button

```js
const start = await fetch("/api/marketing/offer/generate", {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
  body: JSON.stringify({ campaign: "partner" })
}).then((r) => r.json());
// start.job.id → poll GET ?id=… until job.status is "done" or "failed".
```
