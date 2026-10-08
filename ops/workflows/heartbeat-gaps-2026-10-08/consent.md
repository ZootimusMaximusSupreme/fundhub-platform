# Consent capture gap

Lane: consent capture only. Read only. One tripwire. No second monitor.

The check is `gapChecks(ctx)` in `src/pulse/coverage/gap-consent.mjs`. It returns four readings. Each one is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

It does not record consent for a real person. It does not write a row. It does not edit the consent page. It does not start another monitor.

The morning pulse already pings the consent page and the consent API (`reg:consent-capture`, `reg:consent/capture`). This file does not ping the API again. It reads the page body once, and it reads the database.

It does not look at files on disk. The pulse runs inside the deployed function. `public/` and `api/` are not there to read.

## Breaks

| id | What fails |
|---|---|
| `consent:page` | The consent page does not load, or it loads and no longer calls `/api/consent/capture`. The plain up/down ping is `reg:consent-capture`. The API ping is `reg:consent/capture` |
| `consent:required` | A client paid for a credit report more than 24 hours ago, the credit is not in, and there is no live soft-pull consent. Same people as the desk count `needs_consent`, less the ones who paid in the last 24 hours |
| `consent:store` | A signed soft-pull paper, more than 1 hour old, has no consent row. A later withdrawal is not a failed store |
| `consent:slo-store` | A roadmap order saved the buyer's identity (1 hour to 7 days ago) and no soft-pull consent row exists for that client. The pull form saves the identity, then the consent, in one request |

Test clients are left out of all three database rows: the demo flag, the synthetic flag, the `+walk-N` and `+sim-N` tags, and reserved test domains.

## Run

`node --test src/pulse/coverage/gap-consent.test.mjs`

Fakes only. The SQL was also run read-only on the live database with the real tables swapped for made-up rows, to prove each row can fail and can pass.
