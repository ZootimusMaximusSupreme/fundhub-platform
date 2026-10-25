# Removed from `marketing/ads/watch-curve.md` on 2026-10-24

Reason: D233 and D235. The rule path is .ai/rules/ad-watch-curve.md. The what-to-fix list lives in marketing/ads/curve-optimization.md.

These lines were cut from the live file. The meaning named in the reason stays in force.

```
Owner-set 2026-09-27. Definitions below are from Meta's own help and Marketing API docs, not a marketing blog. The standing rule is `.cursor/rules/ad-watch-curve.mdc` / `.claude/rules/ad-watch-curve.md`.
There is **no 3-second insights field**. Do not invent one. Closest opening hold we store is `video_continuous_2_sec_watched_actions`.
## What to fix (plain language)

- Most plays never reach 25% → opening is wrong. New first line, same body. Do not recut the ending first.
- They pass halfway and still do not tap → offer or last line.
- They watch and do not tap → the ask.
`src/ops/watch-curve.mjs` runs after sync. If a running (`ACTIVE`) ad has enough plays and `p25 / plays < 0.5`, Chris gets a buzz on the same path as finished ad-video approvals: `src/ad-videos/notify-fanout.mjs` (SMS via `AD_VIDEO_SMS_TO` / `PULSE_SMS_TO`, plus ntfy). At most once per ad per calendar day (`ad_watch_curve_alerts`). Does not pause campaigns or change budgets.
```
