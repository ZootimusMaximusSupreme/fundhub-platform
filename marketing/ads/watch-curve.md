# Watch curve — Meta video ad drop-off

Owner-set 2026-09-27. Definitions below are from Meta's own help and Marketing API docs, not a marketing blog. The standing rule is `.ai/rules/ad-watch-curve.md`.

## Meta definitions (quoted)

### Video plays (starts)

From Meta Business Help Center — [Video plays](https://www.facebook.com/business/help/592054664510127) and Marketing API Insights (`video_play_actions`):

> The number of times your video starts to play. This is counted for each impression of a video, and excludes replays.

### Video plays at 25% (and 50 / 75 / 100)

From Meta Business Help Center — [Video plays at 25%](https://www.facebook.com/business/help/279891745529019):

> The number of times your video was played at 25% of its length, including plays that skipped to this point.

Marketing API: `video_p25_watched_actions`, `video_p50_watched_actions`, `video_p75_watched_actions`, `video_p95_watched_actions`, `video_p100_watched_actions` — same wording at each fraction.

### ThruPlay

From Meta Business Help Center — [15-second ThruPlays](https://www.facebook.com/business/help/471190536725647):

> The number of times your video was played to completion, or for at least 15 seconds.

> Each 15-second ThruPlay counts when your video was played for at least its set duration or, for videos shorter than that duration, after at least 97% of the video was played.

### Second-by-second curve

From Meta Marketing API — Ad Account Insights field `video_play_curve_actions` (confirmed 2026-09-27 on developers.facebook.com):

> A video-play based curve graph that illustrates the percentage of video plays that reached a given second. Entries 0 to 14 represent seconds 0 thru 14. Entries 15 to 17 represent second ranges [15 to 20), [20 to 25), and [25 to 30). Entries 18 to 20 represent second ranges [30 to 40), [40 to 50), and [50 to 60). Entry 21 represents plays over 60 seconds.

There is **no 3-second insights field**. Do not invent one. Closest opening hold we store is `video_continuous_2_sec_watched_actions`. Meta also lists 3-second video plays in Ads Manager; that UI metric is not on our insights pull, so do not treat a 3-second rate as something we store.

## Where the numbers live

| What | Meta field | Our column | Table |
|---|---|---|---|
| 2-second continuous | `video_continuous_2_sec_watched_actions` | `video_continuous_2s_watched` | `ad_metrics_daily` |
| Plays (started) | `video_play_actions` | `video_plays` | `ad_metrics_daily` |
| Reached 25% | `video_p25_watched_actions` | `video_p25_watched` | `ad_metrics_daily` |
| Reached 50% | `video_p50_watched_actions` | `video_p50_watched` | `ad_metrics_daily` |
| Reached 75% | `video_p75_watched_actions` | `video_p75_watched` | `ad_metrics_daily` |
| Reached 95% | `video_p95_watched_actions` | `video_p95_watched` | `ad_metrics_daily` |
| Reached 100% | `video_p100_watched_actions` | `video_p100_watched` | `ad_metrics_daily` |
| ThruPlay | `video_thruplay_watched_actions` | `video_thruplay_watched` | `ad_metrics_daily` |
| Second-by-second curve | `video_play_curve_actions` | `video_play_curve` (jsonb) | `ad_metrics_daily` |

Request + parse: `src/adplatforms/meta.mjs` (`VIDEO_INSIGHT_REQUEST_FIELDS`, `videoMetrics`, `playCurveActions`).

Write path: `api/campaigns/sync.mjs` → `storeInsights()` after each Meta sync (button or daily sweeper).

NULL means Meta did not report that number (for example a photo ad). NULL is not zero.

Law: curve-optimization (marketing/ads/curve-optimization.md) - where the curve dies and the fix for each: opening, middle, ask; a tap-through is a hop, not a failure; the purchase is the score.

## Dying ping

`src/ops/watch-curve.mjs` runs after sync. If a running (`ACTIVE`) ad has enough plays and `p25 / plays < 0.5`, Chris gets a buzz on the same path as finished ad-video approvals: `src/ad-videos/notify-fanout.mjs` (SMS via `AD_VIDEO_SMS_TO` / `PULSE_SMS_TO`, plus ntfy). At most once per ad per calendar day (`ad_watch_curve_alerts`). Does not pause campaigns or change budgets. The buzz goes out only inside the texting window (`texting-hours`, 6 a.m. to 10 p.m. Arizona). The text is one or two sentences: which ad, and that people are leaving before the quarter mark, so the opening has to change. If taps (link clicks or landing-page views) are at least as common as the people who reached 25%, that is a hop: do not buzz (`curve-optimization.md`, "A short watch is not always a failure").

## Later screen

A dashboard can read these columns from `ad_metrics_daily`. Do not invent rates in two places — use `watchRate()` in `src/ops/meta-marketing.mjs` for hook/hold style fractions, and the quartile + curve columns for drop-off shape.
