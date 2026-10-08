# Social and YouTube gaps

Fundhub YouTube and social stats only. Read only. Recon (AG-07) is the one tripwire. No second watchdog. Do not call YouTube. Do not refresh OAuth. Do not edit the Social Studio page.

This lane does not repeat the morning ping of `read/video-stats` or `social-studio.html`.

## Checks

| id | Break | FAIL when |
|---|---|---|
| social:youtube-last-error | YouTube connection last_error set | A YouTube row in `analytics_connections` has `last_error` filled in. |
| social:video-stats-stale | Video stats sync stale past its schedule | A YouTube connection is active, error, or expired, and `last_synced_at` is missing or older than 3 days. The sync stores one snapshot a day. Red after 3 times that. A pending or revoked row is skip. |
| social:studio-read | Social Studio read API 500 | GET `/api/social/posts`, `/api/social/channels`, or `/api/social/settings` answers 500. A sign-in refusal (401) is up. This check does not open YouTube or OAuth. |

No database in the run: the two YouTube checks are `skip`. No fetch: the Social Studio check is `skip`.

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. A FAIL names Recon (AG-07) and does not add another watcher.

## Files

- `src/pulse/coverage/gap-social.mjs`
- `src/pulse/coverage/gap-social.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-social.test.mjs`
