# Social and YouTube gaps

Fundhub YouTube and social stats only. Read only. Recon (AG-07) is the one tripwire. No second watchdog. Do not call YouTube. Do not refresh OAuth. Do not edit the Social Studio page.

## Already watched (this lane does not repeat it)

The morning registry pings these with a GET. A sign-in refusal (401) counts as up.

- `reg:read/video-stats` (the YouTube stats read)
- `reg:social/posts`, `reg:social/channels`, `reg:social/settings`
- `reg:social-studio.html` (the page)

A ping cannot see inside the read. That is what the three checks below do.

## Checks (3)

| id | Break | FAIL when |
|---|---|---|
| `social:youtube-last-error` | YouTube connection is broken | A YouTube row in `analytics_connections` has `last_error` filled in, or its state is `error` or `expired`. |
| `social:video-stats-stale` | Video stats sync has gone quiet | An active YouTube connection last synced more than 3 days ago. A connection that never synced is judged from the day it was connected. No active connection is a skip. |
| `social:studio-read` | Social Studio read would answer 500 | The same SELECTs the screen runs (posts queue, channels, settings) throw. |

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. A FAIL names Recon (AG-07) and does not add another watcher.

No database in the run: all three are `skip`. A read that throws is a `FAIL`, never a `PASS`.

## Honest limits

- Nothing runs the YouTube sync on a clock. It only runs when someone presses Sync now on Creative Factory. So "3 days" means "the trend line has a hole", not "a job is late".
- Today there is no YouTube connection (the only row in `analytics_connections` is ClickFunnels). So `social:video-stats-stale` is a skip right now. That is true, not a bug.
- The YouTube connect and sync routes are POST only and spend a Google call. They are never called here.

## Files

- `src/pulse/coverage/gap-social.mjs`
- `src/pulse/coverage/gap-social.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-social.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:

- The YouTube checks read the connection table on the plain database role. That table is staff-only. The plain role sees zero rows. A broken YouTube connection would still have said PASS. Proof: on `analytics_connections` the plain role sees 0 rows and the staff role sees 1 (the ClickFunnels row).
- The Social Studio check sent GET to three routes and called a 401 "up". The registry already does that. A 401 never reaches the read.
- A new connection that had not synced yet was judged "never ran" and went red at once.
- A connection in `error` or `expired` with no message text was missed.

What changed:

- All reads go through the staff scope now.
- The Social Studio check runs the real read code (`fetchRows` and `readSettings`, plus the posts SELECT). A missing column or table throws, and that throw is the 500 the screen would show.
- A new connection is judged from the day it was connected.
- State `error` or `expired` counts as broken.

Proof:

- Live, read only, as the app role: prod 2 pass, 0 fail, 1 skip. The bare run is the same. The same run from inside the built server bundle is the same.
- Break tests on the live database (a table or column renamed in the query only): a missing `social_channels` made `social:studio-read` FAIL. A missing `blocked_reasons` made it FAIL. A missing `analytics_connections` made both YouTube rows FAIL. Each put back to PASS after.
- The SQL was also run on made-up rows (read only): broken, expired, blank text, other platform, other company, never synced. All came out right.
- Tests: 19 pass, 0 fail, 0 skipped. 18 deliberate breaks of the code (a flipped limit, a dropped read, a PASS where a FAIL belongs) were each caught by a test.
- Run in the built server bundle (one packed file, no source tree): same result, prod 2 pass, 0 fail, 1 skip.
