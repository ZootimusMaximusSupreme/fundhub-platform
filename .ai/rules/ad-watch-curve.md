---
description: How to read Meta video watch numbers and what to fix when an ad dies
alwaysApply: true
---

# Ad watch curve

**Owner law (2026-09-27):** Video ad drop-off uses Meta's own definitions. Not a blog opinion. Book: `marketing/ads/watch-curve.md`.

## What the numbers mean (Meta)

- A **play** means the video started. Replays do not count.
- **25% / 50% / 75% / 100%** means they reached that fraction of the length (including people who skipped to that point).
- **ThruPlay** means they watched 15 seconds, or they finished a video shorter than that.
- There is **no 3-second field**. Do not invent one. Closest opening signal we store is 2-second continuous plays.
- The second-by-second curve is Meta field `video_play_curve_actions`, stored as `ad_metrics_daily.video_play_curve`.

## What to fix when it dies

- If **most plays never reach 25%**, and they are **not** tapping through, the opening is the problem: new first line, same body. Do **not** recut the ending first.
- If they leave early **and** they tap through to the page, that is a hop. The ad already did its job. Do not recut it for watch time.
- If they **pass halfway** and still do not tap, the offer or the last line is the problem.
- If they **watch** and do not tap, the ask is the problem. A full watch is not a sale. People space out.
- The purchase is the score. Watch time and clicks are how you find where to film next.

## Notify Chris

When a running ad dies before 25% **and** people are not tapping through, buzz him on the same phone/ntfy path the ad-video pipeline already uses (`src/ad-videos/notify-fanout.mjs`), only inside the texting window (`texting-hours`, 6 a.m. to 10 p.m. Arizona). One or two sentences: which ad, and that people are leaving before the quarter mark, so the opening has to change. If they are already tapping through, do not buzz. Do not pause the campaign or change budgets from this rule.

## Never

- Invent a 3-second Meta field
- Recut the ending first when people leave before 25%
- Build a new notify vendor for this buzz
