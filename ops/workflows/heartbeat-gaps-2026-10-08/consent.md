# Consent capture gap

Lane: consent capture only. Read only. One tripwire. No second monitor.

The check is `gapChecks(ctx)` in `src/pulse/coverage/gap-consent.mjs`. It returns three readings. Each one is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

It does not record consent for a real person. It does not write a row. It does not edit the consent page. It does not start another monitor. The morning pulse already pings the consent page and the consent API. This check reads that ping when it is passed in. It calls the site only when the caller hands in `fetch`. That call is a GET with no client id.

## Breaks

| id | What fails |
|---|---|
| `consent:doors` | Consent page or API is missing, or a live ping says it is down. A bare GET that answers 401, 400, 403, or 405 means the API is up. |
| `consent:required` | A client paid for a credit report, the credit is not in, and there is no live soft-pull consent. Same people as the desk count `needs_consent`. |
| `consent:store` | A signed soft-pull paper has no consent row. A later withdrawal is not a failed store. |

## Run

`node --test src/pulse/coverage/gap-consent.test.mjs`
