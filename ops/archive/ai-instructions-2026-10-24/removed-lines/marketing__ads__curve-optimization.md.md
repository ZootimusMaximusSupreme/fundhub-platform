# Removed from `marketing/ads/curve-optimization.md` on 2026-10-24

Reason: D230. Definitions live in marketing/ads/watch-curve.md. The Ads Manager 3-second note was folded into that book first (D234).

These lines were cut from the live file. The meaning named in the reason stays in force.

```
From [About Video Ad Metrics](https://www.facebook.com/business/help/1792720544284355) (Ads Manager → Columns → Video engagement):

- **Video plays (starts):** the video starts to play for an impression; replays are excluded (same idea as Marketing API `video_play_actions`).
- **2-second continuous video play:** played for at least 2 continuous seconds (Marketing API: `video_continuous_2_sec_watched_actions`). Meta also lists **3-second video plays** in Ads Manager; that UI metric is **not** on our insights pull — do not treat a “3-second rate” as something we store.
- **[Video plays at 25%](https://www.facebook.com/business/help/279891745529019):** “The number of times your video was played at 25% of its length, **including plays that skipped to this point**.”
- Same pattern for 50%, 75%, 100% (Marketing API `video_p25_watched_actions`, etc.).
- **[15-second ThruPlays](https://www.facebook.com/business/help/471190536725647):** played to completion **or** for at least 15 seconds; for shorter videos, after at least **97%** of length. Replays on one impression do not count.
- **Second-by-second curve:** Marketing API `video_play_curve_actions` — percent of plays still watching at each second bucket (stored in `ad_metrics_daily.video_play_curve`).

**Play** means the video started. **25% / 50% / …** means they reached that fraction of length (including skip-ahead). **ThruPlay** is long watch or finish, not “time on screen while paused.”
```
